import React from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
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
  profile: FixtureProfile;
  generationDurationMs: number;
};

type CoreBenchmarkReport = {
  fixture: FixtureMetadata;
  indexDurationMs: number;
  markerCount: number;
  searchDurationMs: number;
  searchTotalMatches: number;
  readVisibleDurationMs: number;
  readVisibleLineCount: number;
};

type SocketConnectMetadata = {
  sessionId: number;
  host: string;
  port: number;
  path: string;
  lineCount: number;
  protocol: string;
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

type LogSearchMatch = {
  lineNumber: number;
  startColumn: number;
  endColumn: number;
  linePreview: string;
};

type LogSearchResult = {
  sessionId: number;
  query: string;
  direction: "next" | "previous";
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
  startLine: number;
  scannedLines: number;
  totalLines: number;
  totalMatches: number;
  activeMatchIndex: number;
  durationMs: number;
  truncated: boolean;
  wrapped: boolean;
  matches: LogSearchMatch[];
};

type SearchCache = {
  sessionId: number;
  fileSize: number;
  lineCount: number;
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  wholeWord: boolean;
  result: LogSearchResult;
};

type LogTokenKind = "plain" | "bracket" | "number" | "identifier";

type LogToken = {
  kind: LogTokenKind;
  text: string;
};

type SelectedWordRange = {
  lineNumber: number;
  start: number;
  end: number;
};

type PersistedFileSource = {
  path: string;
  displayName: string;
  lastOpenedAt: number;
};

type PersistedSocketSource = {
  host: string;
  port: number;
  displayName: string;
  lastOpenedAt: number;
};

type PersistedDataSource = {
  kind: "file" | "socket" | string;
  path: string | null;
  host: string | null;
  port: number | null;
};

type PersistedUiState = {
  followTail: boolean;
  showGlobalMinimap: boolean;
  showLocalMinimap: boolean;
  logColorMode: "full" | "severity" | "off" | string;
  searchQuery: string;
  searchCaseSensitive: boolean;
  searchRegex: boolean;
  searchWholeWord: boolean;
  searchWrapAround: boolean;
  searchFindAll: boolean;
};

type PersistedStore = {
  schemaVersion: number;
  recentFiles: PersistedFileSource[];
  recentSockets: PersistedSocketSource[];
  lastSource: PersistedDataSource | null;
  uiState: PersistedUiState;
};

type FixtureProfile = "mixed" | "short-lines" | "long-lines" | "dense-markers" | "append-stream";

type FrontendPerfSnapshot = {
  renderedRows: number;
  cachedLines: number;
  globalMinimapMs: number;
  localMinimapMs: number;
};

const ROW_HEIGHT = 24;
const BOTTOM_PADDING_ROWS = 1;
const OVERSCAN_ROWS = 80;
const MAX_CACHED_LINES = 2_000;
const TAIL_REFRESH_INTERVAL_MS = 1_000;
const MINIMAP_WIDTH = 72;
const GLOBAL_MINIMAP_HEIGHT = 44;
const RIGHT_MINIMAP_FRAME_RATIO = 1 / 8;
const MAX_TOKENIZED_CHARS = 4_096;
const LARGE_FILE_DEGRADE_BYTES = 100 * 1024 * 1024;
const HUGE_FILE_DEGRADE_BYTES = 300 * 1024 * 1024;


function App() {
  const [health, setHealth] = React.useState<HealthCheck | null>(null);
  const [placeholder, setPlaceholder] = React.useState<FileOpenPlaceholder | null>(null);
  const [filePath, setFilePath] = React.useState("");
  const [socketHost, setSocketHost] = React.useState("127.0.0.1");
  const [socketPort, setSocketPort] = React.useState("8765");
  const [logFile, setLogFile] = React.useState<LogFileMetadata | null>(null);
  const [lineCache, setLineCache] = React.useState<Map<number, string>>(() => new Map());
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [jumpLine, setJumpLine] = React.useState("1");
  const [gotoBarOpen, setGotoBarOpen] = React.useState(false);
  const [selectedLine, setSelectedLine] = React.useState<number | null>(null);
  const [isOpening, setIsOpening] = React.useState(false);
  const [isConnectingSocket, setIsConnectingSocket] = React.useState(false);
  const [showSocketModal, setShowSocketModal] = React.useState(false);

  const [lastFixture, setLastFixture] = React.useState<FixtureMetadata | null>(null);
  const [lastBenchmark, setLastBenchmark] = React.useState<CoreBenchmarkReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [followTail, setFollowTail] = React.useState(true);
  const [pendingTailLines, setPendingTailLines] = React.useState(0);
  const [tailNotice, setTailNotice] = React.useState<string | null>(null);
  const [markers, setMarkers] = React.useState<LogMarker[]>([]);
  const [selectedMarker, setSelectedMarker] = React.useState<LogMarker | null>(null);
  const [selectedPayload, setSelectedPayload] = React.useState<MarkerPayload | null>(null);
  const [showGlobalMinimap, setShowGlobalMinimap] = React.useState(true);
  const [showLocalMinimap, setShowLocalMinimap] = React.useState(true);
  const [globalMinimapWidth, setGlobalMinimapWidth] = React.useState(1);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = React.useState(false);
  const [searchRegex, setSearchRegex] = React.useState(false);
  const [searchWholeWord, setSearchWholeWord] = React.useState(false);
  const [searchWrapAround, setSearchWrapAround] = React.useState(true);
  const [searchFindAll, setSearchFindAll] = React.useState(true);
  const [searchResult, setSearchResult] = React.useState<LogSearchResult | null>(null);
  const [activeSearchMatch, setActiveSearchMatch] = React.useState<LogSearchMatch | null>(null);
  const [selectedWord, setSelectedWord] = React.useState("");
  const [selectedWordRange, setSelectedWordRange] = React.useState<SelectedWordRange | null>(null);
  const [isSearching, setIsSearching] = React.useState(false);
  const [findBarOpen, setFindBarOpen] = React.useState(false);
  const searchCacheRef = React.useRef<SearchCache | null>(null);
  const findInputRef = React.useRef<HTMLInputElement | null>(null);
  const gotoInputRef = React.useRef<HTMLInputElement | null>(null);
  const [logColorMode, setLogColorMode] = React.useState<"full" | "severity" | "off">("full");
  const [perfSnapshot, setPerfSnapshot] = React.useState<FrontendPerfSnapshot>({
    renderedRows: 0,
    cachedLines: 0,
    globalMinimapMs: 0,
    localMinimapMs: 0,
  });
  const [persistedStore, setPersistedStore] = React.useState<PersistedStore | null>(null);
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
  const persistedStateLoadedRef = React.useRef(false);
  const saveUiStateTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    invoke<HealthCheck>("health_check")
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  const refreshPersistedState = React.useCallback(async () => {
    const store = await invoke<PersistedStore>("get_persisted_state");
    setPersistedStore(store);
    return store;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    refreshPersistedState()
      .then((store) => {
        if (cancelled) {
          return;
        }

        const uiState = store.uiState;
        setFollowTail(uiState.followTail);
        setShowGlobalMinimap(uiState.showGlobalMinimap);
        setShowLocalMinimap(uiState.showLocalMinimap);
        setLogColorMode(isLogColorMode(uiState.logColorMode) ? uiState.logColorMode : "full");
        setSearchQuery(uiState.searchQuery ?? "");
        setSearchCaseSensitive(uiState.searchCaseSensitive);
        setSearchRegex(uiState.searchRegex);
        setSearchWholeWord(uiState.searchWholeWord);
        setSearchWrapAround(uiState.searchWrapAround);
        setSearchFindAll(uiState.searchFindAll);

        if (store.lastSource?.kind === "file" && store.lastSource.path) {
          setFilePath(store.lastSource.path);
        }
        if (store.lastSource?.kind === "socket" && store.lastSource.host && store.lastSource.port) {
          setSocketHost(store.lastSource.host);
          setSocketPort(String(store.lastSource.port));
        }

        persistedStateLoadedRef.current = true;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          persistedStateLoadedRef.current = true;
          setError(String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshPersistedState]);

  React.useEffect(() => {
    if (!persistedStateLoadedRef.current) {
      return;
    }

    if (saveUiStateTimerRef.current !== null) {
      window.clearTimeout(saveUiStateTimerRef.current);
    }
    saveUiStateTimerRef.current = window.setTimeout(() => {
      const uiState: PersistedUiState = {
        followTail,
        showGlobalMinimap,
        showLocalMinimap,
        logColorMode,
        searchQuery,
        searchCaseSensitive,
        searchRegex,
        searchWholeWord,
        searchWrapAround,
        searchFindAll,
      };
      invoke<PersistedStore>("save_ui_state", { uiState })
        .then(setPersistedStore)
        .catch((err: unknown) => console.warn("Unable to persist UI state", err));
    }, 400);

    return () => {
      if (saveUiStateTimerRef.current !== null) {
        window.clearTimeout(saveUiStateTimerRef.current);
      }
    };
  }, [
    followTail,
    showGlobalMinimap,
    showLocalMinimap,
    logColorMode,
    searchQuery,
    searchCaseSensitive,
    searchRegex,
    searchWholeWord,
    searchWrapAround,
    searchFindAll,
  ]);

  React.useEffect(() => {
    const title = logFile?.path ? `${logFile.path} - log_scope` : "log_scope";
    document.title = title;
    void getCurrentWindow().setTitle(title).catch((err: unknown) => {
      console.warn("Unable to set Tauri window title", err);
    });
  }, [logFile?.path]);

  React.useEffect(() => {
    if (!gotoBarOpen) {
      return;
    }

    const focusInput = () => {
      if (gotoInputRef.current) {
        gotoInputRef.current.focus();
        gotoInputRef.current.select();
      }
    };

    focusInput();
    const animationFrameId = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(animationFrameId);
  }, [gotoBarOpen]);

  React.useEffect(() => {
    if (!findBarOpen) {
      return;
    }

    const focusInput = () => {
      if (findInputRef.current) {
        findInputRef.current.focus();
        findInputRef.current.select();
      }
    };

    focusInput();
    const animationFrameId = requestAnimationFrame(focusInput);
    return () => cancelAnimationFrame(animationFrameId);
  }, [findBarOpen]);

  const closeFindBar = React.useCallback(() => {
    setFindBarOpen(false);
  }, []);

  const loadMarkers = React.useCallback(async (sessionId: number) => {
    const range = await invoke<LogMarkerRange>("get_log_markers", { sessionId });
    setMarkers(range.markers);
  }, []);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    listen<any>("menu-event", (event) => {
      const payload = event.payload;
      if (payload.action === "open_file") {
        open({
          multiple: false,
          directory: false,
        }).then((selected) => {
          if (typeof selected === "string") {
            setFilePath(selected);
            openPath(selected);
          }
        }).catch(console.error);
      } else if (payload.action === "connect_socket") {
        setShowSocketModal(true);
      } else if (payload.action === "health_check") {
        runPlaceholder();
      } else if (payload.action === "open_recent_file") {
        setFilePath(payload.path);
        openPath(payload.path);
      } else if (payload.action === "open_recent_socket") {
        setSocketHost(payload.host);
        setSocketPort(String(payload.port));
        connectSocketSource(payload.host, payload.port);
      } else if (payload.action === "gen_fixture") {
        invoke<FixtureMetadata>("generate_log_fixture", { sizeMb: 50, profile: payload.profile })
          .then((fixture) => {
            setLastFixture(fixture);
            setFilePath(fixture.path);
            openPath(fixture.path);
          })
          .catch((err) => setError(String(err)));
      } else if (payload.action === "benchmark") {
        invoke<CoreBenchmarkReport>("run_core_benchmark", { sizeMb: 50, profile: payload.profile })
          .then((report) => {
            setLastBenchmark(report);
            setLastFixture(report.fixture);
            setFilePath(report.fixture.path);
          })
          .catch((err) => setError(String(err)));
      }
    }).then((unlistenFn) => {
      unlisten = unlistenFn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  React.useEffect(() => {
    const preventDefault = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", preventDefault);
    window.addEventListener("drop", preventDefault);

    let unlisten: (() => void) | undefined;
    getCurrentWindow().onDragDropEvent((event: any) => {
      if (event.payload.type === "drop" && event.payload.paths.length > 0) {
        const path = event.payload.paths[0];
        setFilePath(path);
        openPath(path);
      }
    }).then((unlistenFn: any) => {
      unlisten = unlistenFn;
    });
    
    return () => {
      window.removeEventListener("dragover", preventDefault);
      window.removeEventListener("drop", preventDefault);
      if (unlisten) {
        unlisten();
      }
    };
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
                path: current.path.startsWith("logscope-frame-v1://") ? current.path : metadata.path,
                fileSize: metadata.fileSize,
                lineCount: metadata.lineCount,
              }
            : current,
        );
        if (metadata.appendedBytes > 0 || metadata.wasTruncated) {
          searchCacheRef.current = null;
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
      setSearchResult(null);
      setActiveSearchMatch(null);
      searchCacheRef.current = null;
      setPendingTailLines(0);
      setTailNotice(null);
      setScrollTop(0);
      setJumpLine("1");
      await loadMarkers(metadata.sessionId);
      await refreshPersistedState();
      applyLargeFileDegradation(metadata);
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0;
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsOpening(false);
    }
  };

  const connectSocket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedHost = socketHost.trim();
    const parsedPort = Number.parseInt(socketPort, 10);
    if (!normalizedHost || !Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setError("请输入有效的 socket host 和端口");
      return;
    }

    await connectSocketSource(normalizedHost, parsedPort);
  };

  const connectSocketSource = async (normalizedHost: string, parsedPort: number) => {
    setIsConnectingSocket(true);
    setError(null);
    try {
      const metadata = await invoke<SocketConnectMetadata>("connect_log_socket", {
        host: normalizedHost,
        port: parsedPort,
      });
      setLogFile({
        sessionId: metadata.sessionId,
        path: `${metadata.protocol}://${metadata.host}:${metadata.port}`,
        fileSize: 0,
        lineCount: metadata.lineCount,
        indexDurationMs: 0,
      });
      setPlaceholder(null);
      setLineCache(new Map());
      setMarkers([]);
      setSelectedMarker(null);
      setSelectedPayload(null);
      setSearchResult(null);
      setActiveSearchMatch(null);
      searchCacheRef.current = null;
      setPendingTailLines(0);
      setTailNotice("Socket 已连接，正在等待 frame 数据");
      setScrollTop(0);
      setJumpLine("1");
      await refreshPersistedState();
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0;
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsConnectingSocket(false);
    }
  };

  const applyLargeFileDegradation = (metadata: LogFileMetadata) => {
    if (metadata.fileSize >= HUGE_FILE_DEGRADE_BYTES) {
      setLogColorMode("severity");
      setShowLocalMinimap(false);
      setTailNotice("已启用 300MB+ 降级：仅 severity 着色，并隐藏右侧 minimap；可在状态栏手动恢复。");
      return;
    }
    if (metadata.fileSize >= LARGE_FILE_DEGRADE_BYTES) {
      setLogColorMode("severity");
      setTailNotice("已启用 100MB+ 降级：仅 severity 着色，避免可见行 tokenization 成本过高。");
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

  const scrollToLineCentered = React.useCallback(
    (line: number, options?: { markLine?: boolean }) => {
      if (!logFile || !viewportRef.current) {
        return;
      }
      const safeLine = Math.min(Math.max(1, line), Math.max(logFile.lineCount, 1));
      const centeredScrollTop = (safeLine - 1) * ROW_HEIGHT - Math.max(0, viewportHeight - ROW_HEIGHT) / 2;
      viewportRef.current.scrollTop = Math.max(0, centeredScrollTop);
      if (options?.markLine) {
        setSelectedLine(safeLine);
      }
      setPendingTailLines(0);
    },
    [logFile, viewportHeight],
  );

  const isLineInViewport = React.useCallback(
    (line: number) => {
      const viewport = viewportRef.current;
      if (!logFile || !viewport) {
        return false;
      }
      const lineTop = (line - 1) * ROW_HEIGHT;
      const lineBottom = lineTop + ROW_HEIGHT;
      const viewportTop = viewport.scrollTop;
      const viewportBottom = viewportTop + viewport.clientHeight;
      return lineBottom > viewportTop && lineTop < viewportBottom;
    },
    [logFile],
  );

  const revealSearchMatchIfNeeded = React.useCallback(
    (match: LogSearchMatch) => {
      if (!isLineInViewport(match.lineNumber)) {
        scrollToLineCentered(match.lineNumber);
      }
    },
    [isLineInViewport, scrollToLineCentered],
  );

  const selectMarker = React.useCallback(
    async (marker: LogMarker) => {
      if (!logFile) {
        return;
      }
      setSelectedMarker(marker);
      setSelectedPayload(null);
      scrollToLineCentered(marker.startLine);
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
    [logFile, scrollToLineCentered],
  );

  const focusViewer = React.useCallback(() => {
    requestAnimationFrame(() => {
      viewportRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const jumpToInputLine = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number.parseInt(jumpLine, 10);
    const targetLine =
      logFile && Number.isFinite(parsed)
        ? Math.min(Math.max(1, parsed), Math.max(logFile.lineCount, 1))
        : selectedLine;
    setGotoBarOpen(false);
    setSelectedLine(null);
    focusViewer();
    requestAnimationFrame(() => selectVisibleLineText(targetLine));
  };

  const closeGotoLineBar = React.useCallback(() => {
    setGotoBarOpen(false);
    setSelectedLine(null);
    focusViewer();
  }, [focusViewer]);

  const openGotoLineBar = React.useCallback(() => {
    const viewportCenterLine = logFile
      ? Math.min(
          Math.max(1, Math.floor(scrollTop / ROW_HEIGHT) + Math.floor(Math.max(1, viewportHeight / ROW_HEIGHT) / 2) + 1),
          Math.max(logFile.lineCount, 1),
        )
      : firstVisibleLine;
    setGotoBarOpen(true);
    setJumpLine(String(viewportCenterLine));
  }, [firstVisibleLine, logFile, scrollTop, viewportHeight]);

  const jumpToLineFromText = React.useCallback(
    (text: string) => {
      const parsed = Number.parseInt(text, 10);
      if (!Number.isFinite(parsed)) {
        return;
      }
      scrollToLineCentered(parsed, { markLine: true });
    },
    [scrollToLineCentered],
  );

  const selectVisibleLineText = React.useCallback((lineNumber: number | null) => {
    if (!lineNumber || !viewportRef.current) {
      return;
    }

    const codeElement = viewportRef.current.querySelector<HTMLElement>(
      `[data-line-number="${lineNumber}"] code`,
    );
    if (!codeElement) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(codeElement);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  const runSearch = async (
    direction: "next" | "previous",
    override?: {
      query?: string;
      startLine?: number;
      startColumn?: number;
      forceRefresh?: boolean;
    },
  ) => {
    if (!logFile) {
      return;
    }

    const query = override?.query ?? searchQuery;
    if (!query) {
      setSearchResult(null);
      setActiveSearchMatch(null);
      return;
    }

    if (searchFindAll && !override?.forceRefresh) {
      const cached = searchCacheRef.current;
      if (cached && isSearchCacheValid(cached, logFile, query, searchCaseSensitive, searchRegex, searchWholeWord)) {
        const nextResult = navigateCachedSearch(
          cached.result,
          direction,
          activeSearchMatch,
          firstVisibleLine,
          searchWrapAround,
        );
        setSearchResult(nextResult);
        const match = getActiveSearchMatch(nextResult);
        setActiveSearchMatch(match);
        if (match) {
          revealSearchMatchIfNeeded(match);
        }
        return;
      }
    }

    setIsSearching(true);
    setError(null);
    try {
      let startLine: number;
      let startColumn: number;
      if (override?.startLine !== undefined || override?.startColumn !== undefined) {
        startLine = override.startLine ?? firstVisibleLine;
        startColumn = override.startColumn ?? 0;
      } else if (activeSearchMatch && activeSearchMatch.lineNumber >= 1) {
        startLine = activeSearchMatch.lineNumber;
        if (direction === "next") {
          startColumn = activeSearchMatch.startColumn + 1;
        } else {
          startColumn = activeSearchMatch.startColumn;
        }
      } else {
        startLine = firstVisibleLine;
        startColumn = 0;
      }

      const result = await invoke<LogSearchResult>("search_log_text", {
        sessionId: logFile.sessionId,
        query,
        startLine: Math.min(Math.max(1, startLine), Math.max(logFile.lineCount, 1)),
        startColumn,
        direction,
        caseSensitive: searchCaseSensitive,
        useRegex: searchRegex,
        wholeWord: searchWholeWord,
        wrapAround: searchWrapAround,
        findAll: searchFindAll,
      });
      if (searchFindAll) {
        searchCacheRef.current = {
          sessionId: logFile.sessionId,
          fileSize: logFile.fileSize,
          lineCount: logFile.lineCount,
          query,
          caseSensitive: searchCaseSensitive,
          useRegex: searchRegex,
          wholeWord: searchWholeWord,
          result,
        };
      } else {
        searchCacheRef.current = null;
      }
      setSearchResult(result);
      const match = getActiveSearchMatch(result);
      setActiveSearchMatch(match);
      if (match) {
        revealSearchMatchIfNeeded(match);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSearching(false);
    }
  };

  React.useEffect(() => {
    const updateSelectedWord = () => {
      const viewport = viewportRef.current;
      const selection = window.getSelection();
      if (!viewport || !selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) {
        setSelectedWord("");
        setSelectedWordRange(null);
        return;
      }
      if (!viewport.contains(selection.anchorNode) || !viewport.contains(selection.focusNode)) {
        setSelectedWord("");
        setSelectedWordRange(null);
        return;
      }

      const text = selection.toString().trim();
      const selectedRange = getSelectedWordRange(selection);
      setSelectedWord(isSelectableWord(text) && selectedRange ? text : "");
      setSelectedWordRange(isSelectableWord(text) ? selectedRange : null);
    };

    document.addEventListener("selectionchange", updateSelectedWord);
    return () => document.removeEventListener("selectionchange", updateSelectedWord);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        const sel = window.getSelection();
        const selectedText = sel ? sel.toString().trim() : "";
        const queryToUse = selectedText || searchQuery;
        if (selectedText) {
          setSearchQuery(selectedText);
        }
        setSearchResult(null);
        setActiveSearchMatch(null);
        setSelectedLine(null);
        setFindBarOpen(true);
        if (queryToUse) {
          void runSearch("next", {
            query: queryToUse,
            startLine: firstVisibleLine,
            startColumn: 0,
            forceRefresh: selectedText ? true : false,
          });
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "g") {
        event.preventDefault();
        openGotoLineBar();
      }
      if (event.key === "Escape" && findBarOpen) {
        event.preventDefault();
        setFindBarOpen(false);
      }
      if (event.key === "Escape" && gotoBarOpen) {
        event.preventDefault();
        closeGotoLineBar();
      }
      if (event.key === "F3" && (findBarOpen || searchQuery)) {
        event.preventDefault();
        void runSearch(event.shiftKey ? "previous" : "next");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    findBarOpen,
    gotoBarOpen,
    searchQuery,
    logFile,
    activeSearchMatch,
    searchCaseSensitive,
    searchRegex,
    searchWholeWord,
    searchWrapAround,
    searchFindAll,
    firstVisibleLine,
    openGotoLineBar,
    closeGotoLineBar,
    revealSearchMatchIfNeeded,
  ]);

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
  React.useEffect(() => {
    setPerfSnapshot((current) => ({
      ...current,
      renderedRows: renderedLineCount,
      cachedLines: lineCache.size,
    }));
  }, [lineCache.size, renderedLineCount]);
  const activePath = logFile?.path ?? placeholder?.path ?? "尚未打开文件";
  const activeStatus = placeholder?.message ?? "Ready";
  const statusItems = logFile
    ? [
        `大小 ${formatBytes(logFile.fileSize)}`,
        `行数 ${logFile.lineCount.toLocaleString()}`,
        `索引 ${logFile.indexDurationMs} ms`,
        searchResult ? `查找 ${searchResult.durationMs} ms` : "查找 -",
        `Marker ${markers.length.toLocaleString()}`,
        `DOM ${perfSnapshot.renderedRows}/${perfSnapshot.cachedLines}`,
        `Map ${(perfSnapshot.globalMinimapMs + perfSnapshot.localMinimapMs).toFixed(1)} ms`,
      ]
    : [activeStatus, "大小 -", "行数 -", "索引 -", "查找 -", `Marker ${markers.length.toLocaleString()}`, "DOM -", "Map -"];
  const visibleMarkerLines = React.useMemo(
    () => new Set(markers.map((marker) => marker.startLine)),
    [markers],
  );
  const activeSearchLine = activeSearchMatch?.lineNumber ?? 0;
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
    const drawStartedAt = performance.now();

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

    const frame = getGlobalMinimapFrame(firstVisibleLine, viewportLineCount, logFile.lineCount, width);
    drawViewportFrame(context, frame.left, 0, frame.width, GLOBAL_MINIMAP_HEIGHT, "#ff5a5f");

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
    const drawDurationMs = performance.now() - drawStartedAt;
    setPerfSnapshot((current) => ({ ...current, globalMinimapMs: drawDurationMs }));
  }, [firstVisibleLine, globalMinimapWidth, logFile, markers, selectedMarker?.id, viewportLineCount]);

  React.useEffect(() => {
    const canvas = localMinimapRef.current;
    if (!canvas || !logFile) {
      return;
    }
    const drawStartedAt = performance.now();

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

    const frame = getRightMinimapFrame(firstVisibleLine, viewportLineCount, logFile.lineCount, height);
    drawViewportFrame(context, 0, frame.top, MINIMAP_WIDTH, frame.height);

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
    const drawDurationMs = performance.now() - drawStartedAt;
    setPerfSnapshot((current) => ({ ...current, localMinimapMs: drawDurationMs }));
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
    const x = event.clientX - rect.left;
    const nearest = markers
      .filter((marker) => marker.startLine >= rightMinimapRange.startLine && marker.startLine <= rightMinimapRange.endLine)
      .map((marker) => ({
        marker,
        distance: distanceToRightMarker(marker, rightMinimapRange.startLine, rightMinimapRange.lineCount, rect.height, x, y),
      }))
      .sort((left, right) => left.distance - right.distance)[0];

    if (nearest && nearest.distance <= 12) {
      void selectMarker(nearest.marker);
      return;
    }

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
              <dt>Marker</dt>
              <dd>{logFile ? markers.length.toLocaleString() : "-"}</dd>
            </div>
            <div>
              <dt>Fixture</dt>
              <dd>
                {lastFixture
                  ? `${lastFixture.profile} / ${formatBytes(lastFixture.fileSize)} / ${lastFixture.generationDurationMs} ms`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt>Bench</dt>
              <dd>
                {lastBenchmark
                  ? `idx ${lastBenchmark.indexDurationMs} / search ${lastBenchmark.searchDurationMs} / read ${lastBenchmark.readVisibleDurationMs} ms`
                  : "-"}
              </dd>
            </div>
          </dl>
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

      <section
        className={`viewer-area${showGlobalMinimap ? "" : " is-global-minimap-hidden"}${
          showLocalMinimap ? "" : " is-local-minimap-hidden"
        }`}
      >
        <header className="viewer-toolbar">
          <div>
            <strong>Log viewer</strong>
            <span>{logFile ? "^+G 跳转行号" : activePath}</span>
          </div>
        </header>

        {showGlobalMinimap ? (
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
        ) : (
          <div className="global-minimap-bar is-hidden" aria-hidden="true" />
        )}

        <div
          className="viewer-layout"
          ref={viewportRef}
          aria-label="log viewer"
          tabIndex={-1}
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
                      }${activeSearchLine === line.lineNumber ? " has-active-search" : ""}${
                        selectedLine === line.lineNumber ? " has-selected-line" : ""
                      } ${getSeverityClass(line.text, logColorMode)}`}
                      key={line.lineNumber}
                      data-line-number={line.lineNumber}
                    >
                      <span className="line-number">{line.lineNumber}</span>
                      <code title={line.text ?? ""}>
                        {line.text === undefined
                          ? " "
                          : renderLogLine(
                              line.text,
                              searchQuery,
                              searchCaseSensitive,
                              searchRegex,
                              searchWholeWord,
                              logColorMode,
                              line.lineNumber,
                              activeSearchLine === line.lineNumber,
                              selectedWord,
                              selectedWordRange,
                            )}
                      </code>
                    </div>
                  ))}
                </div>
              </div>

              {showLocalMinimap ? (
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
              ) : null}
            </div>
          ) : (
            <div className="viewer-scroll-space empty-scroll-space">
              <div className="log-viewport">
                <div className="empty-state">
                  <strong>等待文件</strong>
                  <span>输入本机 log 路径后打开；viewer 只渲染当前可见行。</span>
                </div>
              </div>

              {showLocalMinimap ? (
                <canvas className="minimap-placeholder" width={MINIMAP_WIDTH} height="640" aria-label="minimap placeholder" />
              ) : null}
            </div>
          )}
        </div>

        {gotoBarOpen ? (
          <form className="goto-line-bar" onSubmit={jumpToInputLine}>
            <input
              ref={gotoInputRef}
              value={jumpLine}
              onChange={(event) => {
                const nextValue = event.target.value;
                setJumpLine(nextValue);
                jumpToLineFromText(nextValue);
              }}
              inputMode="numeric"
              placeholder="输入行数"
              aria-label="输入行数"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeGotoLineBar();
                }
              }}
            />
            <button type="submit" className="find-bar-btn" disabled={!logFile}>
              Go
            </button>
          </form>
        ) : null}

        {findBarOpen && (
          <div className="find-bar-overlay">
            <button
              type="button"
              className={`find-bar-btn find-bar-toggle${searchRegex ? " is-toggled" : ""}`}
              onClick={() => {
                searchCacheRef.current = null;
                setSearchResult(null);
                setActiveSearchMatch(null);
                setSearchRegex((prev) => !prev);
              }}
              title="正则表达式"
            >
              .*
            </button>
            <button
              type="button"
              className={`find-bar-btn find-bar-toggle${searchCaseSensitive ? " is-toggled" : ""}`}
              onClick={() => {
                searchCacheRef.current = null;
                setSearchResult(null);
                setActiveSearchMatch(null);
                setSearchCaseSensitive((prev) => !prev);
              }}
              title="区分大小写"
            >
              Aa
            </button>
            <button
              type="button"
              className={`find-bar-btn find-bar-toggle${searchWholeWord ? " is-toggled" : ""}`}
              onClick={() => {
                searchCacheRef.current = null;
                setSearchResult(null);
                setActiveSearchMatch(null);
                setSearchWholeWord((prev) => !prev);
              }}
              title="全字匹配"
            >
              W
            </button>
            <button
              type="button"
              className={`find-bar-btn find-bar-toggle${searchWrapAround ? " is-toggled" : ""}`}
              onClick={() => setSearchWrapAround((prev) => !prev)}
              title="循环查找"
            >
              ⟳
            </button>
            <button
              type="button"
              className={`find-bar-btn find-bar-toggle${searchFindAll ? " is-toggled" : ""}`}
              onClick={() => {
                searchCacheRef.current = null;
                setSearchResult(null);
                setActiveSearchMatch(null);
                setSearchFindAll((prev) => !prev);
              }}
              title="查找所有"
            >
              All
            </button>
            <span className="find-bar-separator" />
            <input
              ref={findInputRef}
              value={searchQuery}
              onChange={(event) => {
                searchCacheRef.current = null;
                setSearchResult(null);
                setActiveSearchMatch(null);
                setSearchQuery(event.target.value);
              }}
              placeholder="查找"
              aria-label="查找文本"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeFindBar();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  void (async () => {
                    await runSearch(event.shiftKey ? "previous" : "next");
                    focusViewer();
                  })();
                }
              }}
            />
            <span className="find-bar-match-count">
              {searchResult
                ? searchResult.matches.length > 0
                  ? searchFindAll
                    ? `${searchResult.activeMatchIndex}/${searchResult.totalMatches}${searchResult.wrapped ? " ↻" : ""}`
                    : `L${searchResult.matches[0].lineNumber}${searchResult.wrapped ? " ↻" : ""}`
                  : searchFindAll
                    ? `0/${searchResult.totalMatches}`
                    : "无匹配"
                : ""}
            </span>
            <span className="find-bar-separator" />
            <button
              type="button"
              className="find-bar-btn"
              onClick={() => void runSearch("next")}
              disabled={!logFile || isSearching || !searchQuery}
              title="查找下一个 (F3 / Enter)"
            >
              Find
            </button>
            <button
              type="button"
              className="find-bar-btn"
              onClick={() => void runSearch("previous")}
              disabled={!logFile || isSearching || !searchQuery}
              title="查找上一个 (Shift+F3 / Shift+Enter)"
            >
              Find Prev
            </button>
            <button
              type="button"
              className="find-bar-close"
              onClick={closeFindBar}
              title="关闭 (Esc)"
            >
              ✕
            </button>
          </div>
        )}

        {error ? <p className="error-message">{error}</p> : null}
        {tailNotice ? <p className="tail-notice">{tailNotice}</p> : null}
        <footer className="viewer-status-bar" aria-label="log 状态栏">
          {statusItems.map((item) => (
            <strong key={item}>{item}</strong>
          ))}
          <div className="status-actions" aria-label="状态栏操作">
            <div className="status-button-group" role="group" aria-label="日志着色模式">
              <button
                type="button"
                className={`status-icon-button${logColorMode === "full" ? " is-active" : ""}`}
                onClick={() => setLogColorMode("full")}
                title="完整着色"
                aria-label="完整着色"
                aria-pressed={logColorMode === "full"}
              >
                <span className="status-icon status-icon-color-full" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`status-icon-button${logColorMode === "severity" ? " is-active" : ""}`}
                onClick={() => setLogColorMode("severity")}
                title="仅 severity 着色"
                aria-label="仅 severity 着色"
                aria-pressed={logColorMode === "severity"}
              >
                <span className="status-icon status-icon-color-severity" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`status-icon-button${logColorMode === "off" ? " is-active" : ""}`}
                onClick={() => setLogColorMode("off")}
                title="关闭着色"
                aria-label="关闭着色"
                aria-pressed={logColorMode === "off"}
              >
                <span className="status-icon status-icon-color-off" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className={`status-icon-button${showGlobalMinimap ? " is-active" : ""}`}
              onClick={() => setShowGlobalMinimap((current) => !current)}
              title={showGlobalMinimap ? "关闭顶部 minimap" : "显示顶部 minimap"}
              aria-label={showGlobalMinimap ? "关闭顶部 minimap" : "显示顶部 minimap"}
              aria-pressed={showGlobalMinimap}
            >
              <span className="status-icon status-icon-top" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`status-icon-button${showLocalMinimap ? " is-active" : ""}`}
              onClick={() => setShowLocalMinimap((current) => !current)}
              title={showLocalMinimap ? "关闭右侧 minimap" : "显示右侧 minimap"}
              aria-label={showLocalMinimap ? "关闭右侧 minimap" : "显示右侧 minimap"}
              aria-pressed={showLocalMinimap}
            >
              <span className="status-icon status-icon-right" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`status-tail-button${followTail ? " is-active" : ""}`}
              onClick={() => {
                setFollowTail((current) => {
                  const enabled = !current;
                  if (enabled && logFile) {
                    setPendingTailLines(0);
                    requestAnimationFrame(() => scrollToLine(logFile.lineCount));
                  }
                  return enabled;
                });
              }}
              title={followTail ? "点击切换为阅读锁定" : "点击切换为跟随 tail"}
              aria-pressed={followTail}
            >
              {followTail ? "跟随 Tail" : "阅读锁定"}
            </button>
          </div>
        </footer>
      </section>

      {showSocketModal && createPortal(
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>连接 Socket</h2>
            <form onSubmit={(e) => {
              connectSocket(e);
              setShowSocketModal(false);
            }}>
              <div className="modal-field">
                <label>Host</label>
                <input
                  value={socketHost}
                  onChange={(event) => setSocketHost(event.target.value)}
                  placeholder="127.0.0.1"
                  autoFocus
                />
              </div>
              <div className="modal-field">
                <label>Port</label>
                <input
                  value={socketPort}
                  onChange={(event) => setSocketPort(event.target.value)}
                  inputMode="numeric"
                  placeholder="8765"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setShowSocketModal(false)}>取消</button>
                <button type="submit" className="primary-button" disabled={isConnectingSocket}>连接</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
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

function isLogColorMode(value: string): value is "full" | "severity" | "off" {
  return value === "full" || value === "severity" || value === "off";
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

function getGlobalMinimapFrame(firstVisibleLine: number, viewportLineCount: number, totalLines: number, width: number) {
  const safeTotalLines = Math.max(1, totalLines);
  const left = Math.max(0, Math.min(width, ((firstVisibleLine - 1) / safeTotalLines) * width));
  const frameWidth = Math.max(1, Math.min(width - left, (viewportLineCount / safeTotalLines) * width));
  return { left, width: frameWidth };
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

function distanceToRightMarker(
  marker: LogMarker,
  rangeStartLine: number,
  rangeLineCount: number,
  height: number,
  x: number,
  y: number,
) {
  const point = markerRightMinimapPoint(marker, rangeStartLine, rangeLineCount, height);
  return Math.hypot(point.x - x, point.y - y);
}

function drawViewportFrame(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  strokeStyle?: string,
) {
  context.save();
  context.fillStyle = "rgba(219, 235, 224, 0.08)";
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  context.fillRect(left, top, safeWidth, safeHeight);
  if (strokeStyle) {
    context.strokeStyle = strokeStyle;
    context.lineWidth = 1.5;
    context.strokeRect(left + 0.75, top + 0.75, Math.max(1, safeWidth - 1.5), Math.max(1, safeHeight - 1.5));
  }
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

function isSearchCacheValid(
  cache: SearchCache,
  logFile: LogFileMetadata,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
) {
  return (
    cache.sessionId === logFile.sessionId &&
    cache.fileSize === logFile.fileSize &&
    cache.lineCount === logFile.lineCount &&
    cache.query === query &&
    cache.caseSensitive === caseSensitive &&
    cache.useRegex === useRegex &&
    cache.wholeWord === wholeWord
  );
}

function getActiveSearchMatch(result: LogSearchResult | null) {
  if (!result || result.matches.length === 0) {
    return null;
  }
  return result.matches[Math.max(0, result.activeMatchIndex - 1)] ?? result.matches[0] ?? null;
}

function navigateCachedSearch(
  result: LogSearchResult,
  direction: "next" | "previous",
  activeMatch: LogSearchMatch | null,
  firstVisibleLine: number,
  wrapAround: boolean,
) {
  if (result.matches.length === 0) {
    return result;
  }

  const currentIndex = activeMatch
    ? result.matches.findIndex(
        (match) =>
          match.lineNumber === activeMatch.lineNumber &&
          match.startColumn === activeMatch.startColumn &&
          match.endColumn === activeMatch.endColumn,
      )
    : -1;
  let nextIndex = currentIndex;
  let wrapped = false;

  if (currentIndex === -1) {
    nextIndex =
      direction === "next"
        ? result.matches.findIndex((match) => match.lineNumber >= firstVisibleLine)
        : findLastIndex(result.matches, (match) => match.lineNumber <= firstVisibleLine);
    if (nextIndex === -1) {
      nextIndex = direction === "next" ? 0 : result.matches.length - 1;
      wrapped = true;
    }
  } else if (direction === "next") {
    nextIndex = currentIndex + 1;
    if (nextIndex >= result.matches.length) {
      if (!wrapAround) {
        return result;
      }
      nextIndex = 0;
      wrapped = true;
    }
  } else {
    nextIndex = currentIndex - 1;
    if (nextIndex < 0) {
      if (!wrapAround) {
        return result;
      }
      nextIndex = result.matches.length - 1;
      wrapped = true;
    }
  }

  return {
    ...result,
    direction,
    activeMatchIndex: nextIndex + 1,
    wrapped,
  };
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) {
      return index;
    }
  }
  return -1;
}

function renderLogLine(
  text: string,
  searchQuery: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
  colorMode: "full" | "severity" | "off",
  lineNumber: number,
  activeLine: boolean,
  selectedWord: string,
  selectedWordRange: SelectedWordRange | null,
) {
  const tokens =
    colorMode === "full"
      ? tokenizeLogLine(text)
      : [
          {
            kind: "plain" as const,
            text,
          },
        ];
  const searchRanges = searchQuery ? findSearchRanges(text, searchQuery, caseSensitive, useRegex, wholeWord) : [];
  const selectedWordRanges = selectedWord
    ? findExactWordRanges(
        text,
        selectedWord,
        selectedWordRange?.lineNumber === lineNumber ? selectedWordRange : null,
      )
    : [];
  let absoluteOffset = 0;

  return tokens.map((token, tokenIndex) => {
    const tokenStart = absoluteOffset;
    const tokenEnd = tokenStart + token.text.length;
    absoluteOffset += token.text.length;

    if (searchRanges.length === 0 && selectedWordRanges.length === 0) {
      return (
        <span className={`log-token token-${token.kind}`} key={tokenIndex}>
          {token.text}
        </span>
      );
    }

    const pieces = splitTokenByDecorationRanges(token.text, tokenStart, tokenEnd, searchRanges, selectedWordRanges);
    return pieces.map((piece, pieceIndex) => {
      return (
        <span
          className={`log-token token-${token.kind}${piece.searchMatched ? " search-hit" : ""}${
            piece.searchMatched && activeLine ? " is-active" : ""
          }${piece.selectedWordMatched ? " selected-word-hit" : ""}`}
          key={`${tokenIndex}-${pieceIndex}-${piece.start}`}
        >
          {piece.text}
        </span>
      );
    });
  });
}

function tokenizeLogLine(text: string): LogToken[] {
  if (!text) {
    return [{ kind: "plain", text: " " }];
  }

  const tokenizedText = text.slice(0, MAX_TOKENIZED_CHARS);
  const overflowText = text.slice(MAX_TOKENIZED_CHARS);
  const pattern = /\([^)]*?\)|\[[^\]]*?\]|\{[^}]*?\}|\b(?:\d+[-/.:T])*\d+\b|\b[a-z_][a-z0-9_]*\b/gi;
  const tokens: LogToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(tokenizedText))) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "plain", text: tokenizedText.slice(lastIndex, match.index) });
    }

    const value = match[0];
    tokens.push({
      kind: classifyToken(value),
      text: value,
    });
    lastIndex = match.index + value.length;
  }

  if (lastIndex < tokenizedText.length) {
    tokens.push({ kind: "plain", text: tokenizedText.slice(lastIndex) });
  }
  if (overflowText) {
    tokens.push({ kind: "plain", text: overflowText });
  }

  return tokens.length > 0 ? tokens : [{ kind: "plain", text }];
}

function classifyToken(value: string): LogTokenKind {
  const first = value[0];
  if (first === "(" || first === "[" || first === "{") {
    return "bracket";
  }
  if (/\d/.test(first)) {
    return "number";
  }
  return "identifier";
}

function findSearchRanges(
  text: string,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  wholeWord: boolean,
) {
  if (!query) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  if (useRegex || wholeWord) {
    const pattern = buildSearchPattern(query, caseSensitive, useRegex, wholeWord);
    if (!pattern) {
      return ranges;
    }
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (!value) {
        continue;
      }
      const start = match.index ?? 0;
      ranges.push({ start, end: start + value.length });
    }
    return ranges;
  }

  const haystack = caseSensitive ? text : toAsciiLowerCase(text);
  const normalizedQuery = caseSensitive ? query : toAsciiLowerCase(query);
  let offset = 0;

  while (offset <= text.length) {
    const foundAt = haystack.indexOf(normalizedQuery, offset);
    if (foundAt === -1) {
      break;
    }
    const end = foundAt + normalizedQuery.length;
    ranges.push({ start: foundAt, end });
    offset = end > foundAt ? end : foundAt + 1;
  }

  return ranges;
}

function findExactWordRanges(text: string, word: string, excludedRange: { start: number; end: number } | null) {
  const ranges: Array<{ start: number; end: number }> = [];
  if (!word) {
    return ranges;
  }

  let offset = 0;
  while (offset <= text.length) {
    const foundAt = text.indexOf(word, offset);
    if (foundAt === -1) {
      break;
    }
    const end = foundAt + word.length;
    if (
      isWordBoundary(text[foundAt - 1]) &&
      isWordBoundary(text[end]) &&
      !(excludedRange && excludedRange.start === foundAt && excludedRange.end === end)
    ) {
      ranges.push({ start: foundAt, end });
    }
    offset = end > foundAt ? end : foundAt + 1;
  }

  return ranges;
}

function isSelectableWord(value: string) {
  return value.length > 0 && value.length <= 256 && !/\s/.test(value);
}

function getSelectedWordRange(selection: Selection): SelectedWordRange | null {
  if (selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startCode = getLogCodeElement(range.startContainer);
  const endCode = getLogCodeElement(range.endContainer);
  if (!startCode || startCode !== endCode) {
    return null;
  }

  const row = startCode.closest<HTMLElement>(".log-row");
  const lineNumber = row ? Number.parseInt(row.dataset.lineNumber ?? "", 10) : Number.NaN;
  if (!Number.isFinite(lineNumber)) {
    return null;
  }

  const beforeSelection = range.cloneRange();
  beforeSelection.selectNodeContents(startCode);
  beforeSelection.setEnd(range.startContainer, range.startOffset);
  const start = beforeSelection.toString().length;
  const end = start + range.toString().trim().length;
  if (end <= start) {
    return null;
  }

  return { lineNumber, start, end };
}

function getLogCodeElement(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>(".log-row code") ?? null;
}

function isWordBoundary(value: string | undefined) {
  return value === undefined || !/[A-Za-z0-9_]/.test(value);
}

function buildSearchPattern(query: string, caseSensitive: boolean, useRegex: boolean, wholeWord: boolean) {
  try {
    const body = useRegex ? query : escapeRegExp(query);
    const pattern = wholeWord ? `\\b(?:${body})\\b` : body;
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(pattern, flags);
    if (regex.test("")) {
      return null;
    }
    regex.lastIndex = 0;
    return regex;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function toAsciiLowerCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function splitTokenByDecorationRanges(
  tokenText: string,
  tokenStart: number,
  tokenEnd: number,
  searchRanges: Array<{ start: number; end: number }>,
  selectedWordRanges: Array<{ start: number; end: number }>,
) {
  const boundaries = new Set<number>([tokenStart, tokenEnd]);
  for (const range of [...searchRanges, ...selectedWordRanges]) {
    const start = Math.max(tokenStart, range.start);
    const end = Math.min(tokenEnd, range.end);
    if (start < end) {
      boundaries.add(start);
      boundaries.add(end);
    }
  }

  const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
  const pieces: Array<{
    text: string;
    searchMatched: boolean;
    selectedWordMatched: boolean;
    start: number;
  }> = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    if (start >= end) {
      continue;
    }
    pieces.push({
      text: tokenText.slice(start - tokenStart, end - tokenStart),
      searchMatched: rangeContains(searchRanges, start, end),
      selectedWordMatched: rangeContains(selectedWordRanges, start, end),
      start,
    });
  }

  return pieces.length > 0
    ? pieces
    : [{ text: tokenText, searchMatched: false, selectedWordMatched: false, start: tokenStart }];
}

function rangeContains(ranges: Array<{ start: number; end: number }>, start: number, end: number) {
  return ranges.some((range) => range.start <= start && range.end >= end);
}

function getSeverityClass(text: string | undefined, colorMode: "full" | "severity" | "off") {
  if (!text || colorMode === "off") {
    return "";
  }

  const lower = text.toLocaleLowerCase();
  if (
    lower.includes("success") ||
    lower.includes("succeed") ||
    lower.includes("without error") ||
    lower.includes("no error")
  ) {
    return "severity-success";
  }
  if (
    lower.includes("error") ||
    lower.includes("exception") ||
    lower.includes("fail") ||
    lower.includes("fatal") ||
    lower.includes("crash") ||
    lower.includes("violat")
  ) {
    return "severity-error";
  }
  if (
    lower.includes("warn") ||
    lower.includes("critical") ||
    lower.includes("conflict") ||
    lower.includes("invalid") ||
    lower.includes("not ready") ||
    lower.includes("not found") ||
    lower.includes("out of date")
  ) {
    return "severity-warning";
  }
  return "";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
