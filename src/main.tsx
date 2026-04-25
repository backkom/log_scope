import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";
import "react18-json-view/src/dark.css";
import "./styles.css";

type HealthCheck = {
  status: string;
  appName: string;
  version: string;
};

type FileOpenPlaceholder = {
  path: string;
  message: string;
};

type LogFileMetadata = {
  sessionId: number;
  path: string;
  fileSize: number;
  lineCount: number;
  indexDurationMs: number;
};

type FixtureMetadata = {
  path: string;
  fileSize: number;
  lineCount: number;
  generationDurationMs: number;
};

type LogLine = {
  lineNumber: number;
  text: string;
};

type LogLineRange = {
  sessionId: number;
  startLine: number;
  lineCount: number;
  totalLines: number;
  lines: LogLine[];
};

type LogRefreshMetadata = {
  sessionId: number;
  path: string;
  fileSize: number;
  lineCount: number;
  markerCount: number;
  appendedBytes: number;
  appendedLines: number;
  wasTruncated: boolean;
};

type LogMarker = {
  id: string;
  kind: string;
  title: string;
  color: string;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
  lineTime: string;
  direction: string;
  messageId: number;
  messageName: string;
  laneRatio: number;
  parseStatus: string;
};

type LogMarkerRange = {
  sessionId: number;
  totalMarkers: number;
  markers: LogMarker[];
};

type MarkerPayload = {
  markerId: string;
  rawText: string;
  parseStatus: string;
  parsedJson: unknown | null;
  parseError: string | null;
};

const ROW_HEIGHT = 24;
const BOTTOM_PADDING_ROWS = 1;
const OVERSCAN_ROWS = 80;
const MAX_CACHED_LINES = 2_000;
const TAIL_REFRESH_INTERVAL_MS = 1_000;
const MINIMAP_WIDTH = 72;
const GLOBAL_MINIMAP_HEIGHT = 44;
const RIGHT_MINIMAP_FRAME_RATIO = 1 / 8;

function App() {
  const [health, setHealth] = React.useState<HealthCheck | null>(null);
  const [placeholder, setPlaceholder] = React.useState<FileOpenPlaceholder | null>(null);
  const [filePath, setFilePath] = React.useState("");
  const [logFile, setLogFile] = React.useState<LogFileMetadata | null>(null);
  const [lineCache, setLineCache] = React.useState<Map<number, string>>(() => new Map());
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [jumpLine, setJumpLine] = React.useState("1");
  const [isOpening, setIsOpening] = React.useState(false);
  const [isGeneratingFixture, setIsGeneratingFixture] = React.useState(false);
  const [lastFixture, setLastFixture] = React.useState<FixtureMetadata | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [followTail, setFollowTail] = React.useState(true);
  const [pendingTailLines, setPendingTailLines] = React.useState(0);
  const [tailNotice, setTailNotice] = React.useState<string | null>(null);
  const [markers, setMarkers] = React.useState<LogMarker[]>([]);
  const [selectedMarker, setSelectedMarker] = React.useState<LogMarker | null>(null);
  const [selectedPayload, setSelectedPayload] = React.useState<MarkerPayload | null>(null);
  const [globalMinimapWidth, setGlobalMinimapWidth] = React.useState(1);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const globalMinimapRef = React.useRef<HTMLCanvasElement | null>(null);
  const localMinimapRef = React.useRef<HTMLCanvasElement | null>(null);
  const localMinimapDragRef = React.useRef<{
    pointerId: number;
    pointerOffsetY: number;
    minStartLine: number;
    maxStartLine: number;
    canvasHeight: number;
    frameHeight: number;
  } | null>(null);

  React.useEffect(() => {
    invoke<HealthCheck>("health_check")
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  const loadMarkers = React.useCallback(async (sessionId: number) => {
    const range = await invoke<LogMarkerRange>("get_log_markers", { sessionId });
    setMarkers(range.markers);
  }, []);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateHeight = () => setViewportHeight(viewport.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = globalMinimapRef.current;
    if (!canvas) {
      return;
    }

    const updateWidth = () => setGlobalMinimapWidth(Math.max(1, canvas.clientWidth));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const firstVisibleLine = logFile
    ? Math.min(Math.floor(scrollTop / ROW_HEIGHT) + 1, Math.max(logFile.lineCount, 1))
    : 1;
  const requestedStartLine = Math.max(1, firstVisibleLine - OVERSCAN_ROWS);
  const requestedLineCount =
    Math.ceil(Math.max(viewportHeight, ROW_HEIGHT) / ROW_HEIGHT) + OVERSCAN_ROWS * 2;

  React.useEffect(() => {
    if (!logFile) {
      setLineCache(new Map());
      return;
    }

    let cancelled = false;
    invoke<LogLineRange>("get_log_lines", {
      sessionId: logFile.sessionId,
      startLine: requestedStartLine,
      lineCount: requestedLineCount,
    })
      .then((range) => {
        if (!cancelled) {
          setLineCache((currentCache) => {
            const nextCache = new Map(currentCache);
            for (const line of range.lines) {
              nextCache.set(line.lineNumber, line.text);
            }

            if (nextCache.size > MAX_CACHED_LINES) {
              const minLine = Math.max(1, firstVisibleLine - MAX_CACHED_LINES / 2);
              const maxLine = firstVisibleLine + MAX_CACHED_LINES / 2;
              for (const lineNumber of nextCache.keys()) {
                if (lineNumber < minLine || lineNumber > maxLine) {
                  nextCache.delete(lineNumber);
                }
              }
            }

            return nextCache;
          });
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [firstVisibleLine, logFile, requestedStartLine, requestedLineCount]);

  React.useEffect(() => {
    if (!logFile) {
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      try {
        const metadata = await invoke<LogRefreshMetadata>("refresh_log_file", {
          sessionId: logFile.sessionId,
        });
        if (cancelled) {
          return;
        }

        if (metadata.wasTruncated) {
          setLineCache(new Map());
          setPendingTailLines(0);
          setTailNotice("文件已截断或轮转，已按当前文件重新建立索引");
          if (viewportRef.current) {
            viewportRef.current.scrollTop = 0;
          }
        } else if (metadata.appendedLines > 0) {
          setTailNotice(null);
          if (followTail) {
            requestAnimationFrame(() => {
              if (viewportRef.current) {
                viewportRef.current.scrollTop = metadata.lineCount * ROW_HEIGHT;
              }
            });
          } else {
            setPendingTailLines((current) => current + metadata.appendedLines);
          }
        }

        setLogFile((current) =>
          current && current.sessionId === metadata.sessionId
            ? {
                ...current,
                path: metadata.path,
                fileSize: metadata.fileSize,
                lineCount: metadata.lineCount,
              }
            : current,
        );
        if (metadata.appendedBytes > 0 || metadata.wasTruncated) {
          await loadMarkers(metadata.sessionId);
        }
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      }
    };

    const intervalId = window.setInterval(refresh, TAIL_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [followTail, loadMarkers, logFile?.sessionId]);

  const runPlaceholder = async () => {
    setError(null);
    try {
      const result = await invoke<FileOpenPlaceholder>("open_file_placeholder", {
        path: "/path/to/example.log",
      });
      setPlaceholder(result);
    } catch (err) {
      setError(String(err));
    }
  };

  const openPath = async (targetPath: string) => {
    const normalizedPath = targetPath.trim();
    if (!normalizedPath) {
      setError("请输入 log 文件路径");
      return;
    }

    setIsOpening(true);
    setError(null);
    try {
      const metadata = await invoke<LogFileMetadata>("open_log_file", { path: normalizedPath });
      setLogFile(metadata);
      setPlaceholder(null);
      setLineCache(new Map());
      setMarkers([]);
      setSelectedMarker(null);
      setSelectedPayload(null);
      setPendingTailLines(0);
      setTailNotice(null);
      setScrollTop(0);
      setJumpLine("1");
      await loadMarkers(metadata.sessionId);
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0;
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsOpening(false);
    }
  };

  const openLogFile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await openPath(filePath.trim());
  };

  const generateAndOpenFixture = async () => {
    setIsGeneratingFixture(true);
    setError(null);
    try {
      const fixture = await invoke<FixtureMetadata>("generate_log_fixture", { sizeMb: 50 });
      setLastFixture(fixture);
      setFilePath(fixture.path);
      await openPath(fixture.path);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsGeneratingFixture(false);
    }
  };

  const scrollToLine = (line: number) => {
    if (!logFile || !viewportRef.current) {
      return;
    }
    const safeLine = Math.min(Math.max(1, line), Math.max(logFile.lineCount, 1));
    viewportRef.current.scrollTop = (safeLine - 1) * ROW_HEIGHT;
    setPendingTailLines(0);
  };

  const selectMarker = React.useCallback(
    async (marker: LogMarker) => {
      if (!logFile) {
        return;
      }
      setSelectedMarker(marker);
      setSelectedPayload(null);
      scrollToLine(marker.startLine);
      try {
        const payload = await invoke<MarkerPayload>("get_marker_payload", {
          sessionId: logFile.sessionId,
          markerId: marker.id,
        });
        setSelectedPayload(payload);
        setError(null);
      } catch (err) {
        setError(String(err));
      }
    },
    [logFile],
  );

  const jumpToInputLine = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number.parseInt(jumpLine, 10);
    if (Number.isFinite(parsed)) {
      scrollToLine(parsed);
    }
  };

  const totalHeight = logFile ? logFile.lineCount * ROW_HEIGHT : 0;
  const scrollSpaceHeight = logFile
    ? Math.max(totalHeight + BOTTOM_PADDING_ROWS * ROW_HEIGHT, viewportHeight)
    : 0;
  const isNearBottom = logFile
    ? scrollTop + viewportHeight >= Math.max(0, totalHeight - ROW_HEIGHT * 2)
    : false;
  const visibleOffset = (requestedStartLine - 1) * ROW_HEIGHT - scrollTop;
  const renderedLineCount = logFile
    ? Math.min(requestedLineCount, Math.max(logFile.lineCount - requestedStartLine + 1, 0))
    : 0;
  const renderedLines = React.useMemo(
    () =>
      Array.from({ length: renderedLineCount }, (_, index) => {
        const lineNumber = requestedStartLine + index;
        return {
          lineNumber,
          text: lineCache.get(lineNumber),
        };
      }),
    [lineCache, renderedLineCount, requestedStartLine],
  );
  const activePath = logFile?.path ?? placeholder?.path ?? "尚未打开文件";
  const activeStatus = logFile
    ? `${formatBytes(logFile.fileSize)} · ${logFile.lineCount.toLocaleString()} 行 · ${followTail ? "跟随 tail" : "阅读锁定"}`
    : placeholder?.message ?? "阶段 2：输入路径打开文件，支持追加刷新和 follow tail";
  const visibleMarkerLines = React.useMemo(
    () => new Set(markers.map((marker) => marker.startLine)),
    [markers],
  );
  const viewportLineCount = Math.max(1, Math.ceil(Math.max(viewportHeight, ROW_HEIGHT) / ROW_HEIGHT));
  const rightMinimapRange = React.useMemo(
    () => getRightMinimapRange(firstVisibleLine, viewportLineCount, Math.max(1, logFile?.lineCount ?? 1)),
    [firstVisibleLine, logFile?.lineCount, viewportLineCount],
  );

  React.useEffect(() => {
    if (isNearBottom) {
      setPendingTailLines(0);
    }
  }, [isNearBottom]);

  React.useEffect(() => {
    const canvas = globalMinimapRef.current;
    if (!canvas || !logFile) {
      return;
    }

    const width = Math.max(globalMinimapWidth, 1);
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = width * pixelRatio;
    canvas.height = GLOBAL_MINIMAP_HEIGHT * pixelRatio;
    canvas.style.height = `${GLOBAL_MINIMAP_HEIGHT}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, GLOBAL_MINIMAP_HEIGHT);
    context.fillStyle = "rgb(40, 41, 35)";
    context.fillRect(0, 0, width, GLOBAL_MINIMAP_HEIGHT);
    context.strokeStyle = "#4c5046";
    context.lineWidth = 1;
    for (let x = 0; x < width; x += 48) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, GLOBAL_MINIMAP_HEIGHT);
      context.stroke();
    }

    for (const marker of markers) {
      const point = markerGlobalMinimapPoint(marker, logFile.lineCount, width, GLOBAL_MINIMAP_HEIGHT);
      context.fillStyle = marker.color;
      if (marker.kind === "message") {
        drawMessageTriangle(context, point.x, point.y, selectedMarker?.id === marker.id ? 5 : 4, marker.direction);
      } else {
        context.beginPath();
        context.arc(point.x, point.y, selectedMarker?.id === marker.id ? 4 : 3, 0, Math.PI * 2);
        context.fill();
      }
    }
  }, [globalMinimapWidth, logFile, markers, selectedMarker?.id]);

  React.useEffect(() => {
    const canvas = localMinimapRef.current;
    if (!canvas || !logFile) {
      return;
    }

    const height = Math.max(viewportHeight, 1);
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = MINIMAP_WIDTH * pixelRatio;
    canvas.height = height * pixelRatio;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, MINIMAP_WIDTH, height);
    context.fillStyle = "rgb(40, 41, 35)";
    context.fillRect(0, 0, MINIMAP_WIDTH, height);
    context.strokeStyle = "#4c5046";
    context.lineWidth = 1;
    for (let y = 0; y < height; y += 12) {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(MINIMAP_WIDTH, y + 0.5);
      context.stroke();
    }

    for (const marker of markers) {
      if (marker.startLine < rightMinimapRange.startLine || marker.startLine > rightMinimapRange.endLine) {
        continue;
      }

      const point = markerRightMinimapPoint(marker, rightMinimapRange.startLine, rightMinimapRange.lineCount, height);
      context.fillStyle = marker.color;
      if (marker.kind === "message") {
        drawMessageTriangle(context, point.x, point.y, selectedMarker?.id === marker.id ? 6 : 5, marker.direction);
      } else {
        context.beginPath();
        context.arc(point.x, point.y, selectedMarker?.id === marker.id ? 4 : 3, 0, Math.PI * 2);
        context.fill();
      }
    }

    const frame = getRightMinimapFrame(firstVisibleLine, viewportLineCount, logFile.lineCount, height);
    drawViewportFrame(context, frame.top, frame.height);
  }, [firstVisibleLine, logFile, markers, rightMinimapRange, selectedMarker?.id, viewportHeight, viewportLineCount]);

  const handleGlobalMinimapClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!logFile) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = markers
      .map((marker) => ({
        marker,
        distance: distanceToGlobalMarker(marker, logFile.lineCount, rect.width, rect.height, x, y),
      }))
      .sort((left, right) => left.distance - right.distance)[0];

    if (nearest && nearest.distance <= 12) {
      void selectMarker(nearest.marker);
      return;
    }

    scrollToLine(Math.round((x / Math.max(rect.width, 1)) * logFile.lineCount));
  };

  const handleLocalMinimapPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!logFile) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const frame = getRightMinimapFrame(firstVisibleLine, viewportLineCount, logFile.lineCount, rect.height);
    if (y >= frame.top && y <= frame.top + frame.height) {
      event.currentTarget.setPointerCapture(event.pointerId);
      localMinimapDragRef.current = {
        pointerId: event.pointerId,
        pointerOffsetY: y - frame.top,
        minStartLine: 1,
        maxStartLine: getMaxStartLine(logFile.lineCount, viewportLineCount),
        canvasHeight: Math.max(rect.height, 1),
        frameHeight: frame.height,
      };
      return;
    }

    const direction = y < frame.top ? -1 : 1;
    scrollToLine(firstVisibleLine + direction * viewportLineCount);
  };

  const handleLocalMinimapPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = localMinimapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const maxFrameTop = Math.max(0, drag.canvasHeight - drag.frameHeight);
    const nextFrameTop = Math.max(0, Math.min(maxFrameTop, y - drag.pointerOffsetY));
    const topRatio = maxFrameTop > 0 ? nextFrameTop / maxFrameTop : 0;
    const nextLine = Math.round(drag.minStartLine + topRatio * Math.max(0, drag.maxStartLine - drag.minStartLine));
    scrollToLine(nextLine);
  };

  const stopLocalMinimapDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = localMinimapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    localMinimapDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <main className="app-shell">
      <aside className="source-panel">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>log_scope</h1>
            <p>只读 log viewer</p>
          </div>
        </div>

        <section className="panel-section">
          <h2>数据源</h2>
          <form className="open-form" onSubmit={openLogFile}>
            <input
              value={filePath}
              onChange={(event) => setFilePath(event.target.value)}
              placeholder="/path/to/app.log"
              aria-label="log 文件路径"
            />
            <button type="submit" className="primary-button" disabled={isOpening}>
              {isOpening ? "索引中" : "打开文件"}
            </button>
          </form>
          <button type="button" className="secondary-button" disabled>
            Socket 连接
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={generateAndOpenFixture}
            disabled={isOpening || isGeneratingFixture}
          >
            {isGeneratingFixture ? "生成中" : "生成 50MB Fixture"}
          </button>
          <button type="button" className="secondary-button" onClick={runPlaceholder}>
            Command 自检
          </button>
        </section>

        <section className="panel-section">
          <h2>状态</h2>
          <dl className="status-list">
            <div>
              <dt>Core</dt>
              <dd>{health ? health.status : "连接中"}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{health ? health.version : "-"}</dd>
            </div>
            <div>
              <dt>索引</dt>
              <dd>{logFile ? `${logFile.indexDurationMs} ms` : "-"}</dd>
            </div>
            <div>
              <dt>Marker</dt>
              <dd>{logFile ? markers.length.toLocaleString() : "-"}</dd>
            </div>
            <div>
              <dt>Fixture</dt>
              <dd>{lastFixture ? `${formatBytes(lastFixture.fileSize)} / ${lastFixture.generationDurationMs} ms` : "-"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel-section">
          <h2>定位</h2>
          <form className="jump-form" onSubmit={jumpToInputLine}>
            <input
              value={jumpLine}
              onChange={(event) => setJumpLine(event.target.value)}
              inputMode="numeric"
              aria-label="跳转行号"
            />
            <button type="submit" className="secondary-button" disabled={!logFile}>
              跳转
            </button>
          </form>
          <div className="toolbar-buttons">
            <button type="button" className="secondary-button" onClick={() => scrollToLine(1)} disabled={!logFile}>
              顶部
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => scrollToLine(logFile?.lineCount ?? 1)}
              disabled={!logFile}
            >
              底部
            </button>
          </div>
          <label className="follow-toggle">
            <input
              type="checkbox"
              checked={followTail}
              onChange={(event) => {
                const enabled = event.target.checked;
                setFollowTail(enabled);
                if (enabled && logFile) {
                  setPendingTailLines(0);
                  requestAnimationFrame(() => scrollToLine(logFile.lineCount));
                }
              }}
            />
            <span>Follow tail</span>
          </label>
          {pendingTailLines > 0 ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setPendingTailLines(0);
                scrollToLine(logFile?.lineCount ?? 1);
              }}
            >
              查看 {pendingTailLines.toLocaleString()} 行新增
            </button>
          ) : null}
        </section>

        <section className="panel-section marker-panel">
          <h2>Marker</h2>
          {selectedMarker ? (
            <>
              <button type="button" className="marker-summary" onClick={() => scrollToLine(selectedMarker.startLine)}>
                <span className="marker-dot" style={{ background: selectedMarker.color }} />
                <strong>{selectedMarker.title}</strong>
                <small>
                  {selectedMarker.kind} {selectedMarker.direction ? `· ${selectedMarker.direction}` : ""} · L
                  {selectedMarker.startLine} · {selectedMarker.parseStatus}
                </small>
              </button>
              {!selectedPayload ? <pre className="payload-preview">载入中...</pre> : null}
              {selectedPayload?.parsedJson ? (
                <div className="json-tree-viewer">
                  <JsonView
                    src={selectedPayload.parsedJson}
                    collapsed={2}
                    collapseStringsAfterLength={240}
                    collapseObjectsAfterLength={80}
                    enableClipboard
                  />
                </div>
              ) : selectedPayload ? (
                <pre className="payload-preview">{selectedPayload.rawText || "(empty payload)"}</pre>
              ) : null}
              {selectedPayload?.parseError ? <p className="payload-note">{selectedPayload.parseError}</p> : null}
            </>
          ) : (
            <p className="panel-hint">{markers.length > 0 ? "点击右侧 marker 查看消息内容" : "当前文件未识别到消息 marker"}</p>
          )}
        </section>
      </aside>

      <section className="viewer-area">
        <header className="viewer-toolbar">
          <div>
            <strong>{activePath}</strong>
            <span>{activeStatus}</span>
          </div>
        </header>

        <div className="global-minimap-bar">
          <canvas
            className="global-minimap"
            ref={globalMinimapRef}
            width="1024"
            height={GLOBAL_MINIMAP_HEIGHT}
            aria-label="global marker minimap"
            onClick={handleGlobalMinimapClick}
          />
        </div>

        <div
          className="viewer-layout"
          ref={viewportRef}
          aria-label="log viewer"
          onScroll={(event) => {
            const nextScrollTop = event.currentTarget.scrollTop;
            setScrollTop(nextScrollTop);
            if (
              logFile &&
              nextScrollTop + event.currentTarget.clientHeight >=
                Math.max(0, logFile.lineCount * ROW_HEIGHT - ROW_HEIGHT * 2)
            ) {
              setPendingTailLines(0);
            }
          }}
        >
          {logFile ? (
            <div className="viewer-scroll-space" style={{ height: scrollSpaceHeight }}>
              <div className="log-viewport" style={{ height: viewportHeight || undefined }}>
                <div className="visible-lines" style={{ transform: `translateY(${visibleOffset}px)` }}>
                  {renderedLines.map((line) => (
                    <div
                      className={`log-row${line.text === undefined ? " is-loading" : ""}${
                        visibleMarkerLines.has(line.lineNumber) ? " has-marker" : ""
                      }`}
                      key={line.lineNumber}
                    >
                      <span className="line-number">{line.lineNumber}</span>
                      <code title={line.text ?? ""}>{line.text ?? " "}</code>
                    </div>
                  ))}
                </div>
              </div>

              <canvas
                className="minimap-placeholder local-minimap"
                ref={localMinimapRef}
                width={MINIMAP_WIDTH}
                height="640"
                aria-label="local marker minimap"
                onPointerDown={handleLocalMinimapPointerDown}
                onPointerMove={handleLocalMinimapPointerMove}
                onPointerUp={stopLocalMinimapDrag}
                onPointerCancel={stopLocalMinimapDrag}
              />
            </div>
          ) : (
            <div className="viewer-scroll-space empty-scroll-space">
              <div className="log-viewport">
                <div className="empty-state">
                  <strong>等待文件</strong>
                  <span>输入本机 log 路径后打开；viewer 只渲染当前可见行。</span>
                </div>
              </div>

              <canvas className="minimap-placeholder" width={MINIMAP_WIDTH} height="640" aria-label="minimap placeholder" />
            </div>
          )}
        </div>

        {error ? <p className="error-message">{error}</p> : null}
        {tailNotice ? <p className="tail-notice">{tailNotice}</p> : null}
      </section>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getRightMinimapRange(firstVisibleLine: number, viewportLineCount: number, totalLines: number) {
  const requestedLineCount = Math.max(viewportLineCount, Math.round(viewportLineCount / RIGHT_MINIMAP_FRAME_RATIO));
  const lineCount = Math.min(Math.max(totalLines, 1), requestedLineCount);
  const maxRangeStartLine = Math.max(1, totalLines - lineCount + 1);
  const maxViewportStartLine = getMaxStartLine(totalLines, viewportLineCount);
  const scrollRatio = maxViewportStartLine > 1 ? (firstVisibleLine - 1) / (maxViewportStartLine - 1) : 0;
  const localScrollableLines = Math.max(0, lineCount - viewportLineCount);
  const continuousStartLine = firstVisibleLine - scrollRatio * localScrollableLines;
  const startLine = Math.max(1, Math.min(maxRangeStartLine, Math.round(continuousStartLine)));
  const endLine = Math.min(totalLines, startLine + lineCount - 1);
  return { startLine, endLine, lineCount: Math.max(1, endLine - startLine + 1) };
}

function getMaxStartLine(totalLines: number, viewportLineCount: number) {
  return Math.max(1, totalLines - viewportLineCount + 1);
}

function getRightMinimapFrame(
  firstVisibleLine: number,
  viewportLineCount: number,
  totalLines: number,
  height: number,
) {
  const frameHeight = Math.max(1, height * RIGHT_MINIMAP_FRAME_RATIO);
  const maxFrameTop = Math.max(0, height - frameHeight);
  const maxStartLine = getMaxStartLine(totalLines, viewportLineCount);
  const topRatio = maxStartLine > 1 ? (firstVisibleLine - 1) / (maxStartLine - 1) : 0;
  const top = Math.max(0, Math.min(maxFrameTop, topRatio * maxFrameTop));
  return { top, height: frameHeight };
}

function markerGlobalMinimapPoint(marker: LogMarker, totalLines: number, width: number, height: number) {
  const margin = 7;
  const usableHeight = height - margin * 2;
  const x = Math.max(5, Math.min(width - 5, ((marker.startLine - 1) / Math.max(totalLines, 1)) * width));
  const y =
    marker.kind === "message"
      ? margin + Math.max(0, Math.min(1, marker.laneRatio)) * usableHeight
      : height / 2;
  return { x, y };
}

function markerRightMinimapPoint(marker: LogMarker, rangeStartLine: number, rangeLineCount: number, height: number) {
  const margin = 7;
  const usableWidth = MINIMAP_WIDTH - margin * 2;
  const x =
    marker.kind === "message"
      ? margin + Math.max(0, Math.min(1, marker.laneRatio)) * usableWidth
      : MINIMAP_WIDTH / 2;
  const y = Math.max(
    5,
    Math.min(height - 5, ((marker.startLine - rangeStartLine) / Math.max(rangeLineCount, 1)) * height),
  );
  return { x, y };
}

function distanceToGlobalMarker(
  marker: LogMarker,
  totalLines: number,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const point = markerGlobalMinimapPoint(marker, totalLines, width, height);
  return Math.hypot(point.x - x, point.y - y);
}

function drawViewportFrame(context: CanvasRenderingContext2D, top: number, height: number) {
  context.save();
  context.fillStyle = "rgba(219, 235, 224, 0.08)";
  context.strokeStyle = "#dbeee5";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(5, top + 0.75, MINIMAP_WIDTH - 10, Math.max(1, height - 1.5), 4);
  context.fill();
  context.stroke();
  context.restore();
}

function drawMessageTriangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  direction: string,
) {
  const receive = direction === "Receive";
  context.beginPath();
  if (receive) {
    context.moveTo(x, y + size);
    context.lineTo(x - size, y - size);
    context.lineTo(x + size, y - size);
  } else {
    context.moveTo(x, y - size);
    context.lineTo(x - size, y + size);
    context.lineTo(x + size, y + size);
  }
  context.closePath();
  context.fill();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
