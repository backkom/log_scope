import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
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

const ROW_HEIGHT = 24;
const OVERSCAN_ROWS = 80;
const MAX_CACHED_LINES = 2_000;

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
  const viewportRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    invoke<HealthCheck>("health_check")
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
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
      setScrollTop(0);
      setJumpLine("1");
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
  };

  const jumpToInputLine = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number.parseInt(jumpLine, 10);
    if (Number.isFinite(parsed)) {
      scrollToLine(parsed);
    }
  };

  const totalHeight = logFile ? logFile.lineCount * ROW_HEIGHT : 0;
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
    ? `${formatBytes(logFile.fileSize)} · ${logFile.lineCount.toLocaleString()} 行 · 虚拟化只读`
    : placeholder?.message ?? "阶段 1：输入路径打开文件并按可见范围读取";

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
        </section>
      </aside>

      <section className="viewer-area">
        <header className="viewer-toolbar">
          <div>
            <strong>{activePath}</strong>
            <span>{activeStatus}</span>
          </div>
        </header>

        <div
          className="viewer-layout"
          ref={viewportRef}
          aria-label="log viewer"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {logFile ? (
            <div className="viewer-scroll-space" style={{ height: totalHeight }}>
              <div className="log-viewport" style={{ height: viewportHeight || undefined }}>
                <div className="visible-lines" style={{ transform: `translateY(${visibleOffset}px)` }}>
                  {renderedLines.map((line) => (
                    <div
                      className={`log-row${line.text === undefined ? " is-loading" : ""}`}
                      key={line.lineNumber}
                    >
                      <span className="line-number">{line.lineNumber}</span>
                      <code title={line.text ?? ""}>{line.text ?? " "}</code>
                    </div>
                  ))}
                </div>
              </div>

              <canvas className="minimap-placeholder" width="72" height="640" aria-label="minimap placeholder" />
            </div>
          ) : (
            <div className="viewer-scroll-space empty-scroll-space">
              <div className="log-viewport">
                <div className="empty-state">
                  <strong>等待文件</strong>
                  <span>输入本机 log 路径后打开；viewer 只渲染当前可见行。</span>
                </div>
              </div>

              <canvas className="minimap-placeholder" width="72" height="640" aria-label="minimap placeholder" />
            </div>
          )}
        </div>

        {error ? <p className="error-message">{error}</p> : null}
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
