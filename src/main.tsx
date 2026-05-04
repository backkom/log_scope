import React from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

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

type DiscoveredServer = {
  host: string;
  port: number;
  hostname: string;
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
  keywordClass: string;
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
  wasTruncated: boolean;
  originalBytes: number;
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

type MarkerRuleConfig = {
  version: number;
  ruleEnabled: {
    message_blocks: boolean;
    error_stack: boolean;
    json_event: boolean;
    state_change: boolean;
    keyword: boolean;
  };
  kindColors: {
    error_stack: string;
    json_event: string;
    state_change: string;
    keyword_error: string;
    keyword_warning: string;
  };
  keywordRules: {
    error: string[];
    warning: string[];
  };
  severityRules: {
    success: string[];
    error: string[];
    warning: string[];
  };
  stackTracePatterns: string[];
};

type PersistedFileSource = {
  path: string;
  displayName: string;
  lastOpenedAt: number;
};

type PersistedSocketSource = {
  host: string;
  port: number;
  hostname?: string | null;
  displayName: string;
  lastOpenedAt: number;
};

type PersistedDataSource = {
  kind: "file" | "socket" | string;
  path: string | null;
  host: string | null;
  port: number | null;
  hostname?: string | null;
};

type PersistedFavorite = {
  kind: "file" | "socket";
  path: string | null;
  host: string | null;
  port: number | null;
  hostname?: string | null;
  displayName: string;
};

type PersistedUiState = {
  followTail: boolean;
  showSourcePanel: boolean;
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
  favorites: PersistedFavorite[];
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

const DEFAULT_MARKER_RULE_CONFIG: MarkerRuleConfig = {
  version: 2,
  ruleEnabled: {
    message_blocks: true,
    error_stack: true,
    json_event: true,
    state_change: true,
    keyword: true,
  },
  kindColors: {
    error_stack: "#f46d75",
    json_event: "#b693ff",
    state_change: "#f0c84b",
    keyword_error: "#f46d75",
    keyword_warning: "#f0c84b",
  },
  keywordRules: {
    error: ["error", "failed", "not found", "exception"],
    warning: ["warn", "corrupt", "currupted"],
  },
  severityRules: {
    success: ["success", "succeed", "without error", "no error"],
    error: ["error", "exception", "fail", "fatal", "crash", "violat"],
    warning: ["warn", "critical", "conflict", "invalid", "not ready", "not found", "out of date"],
  },
  stackTracePatterns: [
    "(Filename:", "at ", "[C]:", "UnityEngine.", "System.", "SPGF.", "Assets/",
    ": in function ", ": in main chunk", ") [0x",
  ],
};
const MAX_TOKENIZED_CHARS = 4_096;
const LARGE_FILE_DEGRADE_BYTES = 100 * 1024 * 1024;
const HUGE_FILE_DEGRADE_BYTES = 300 * 1024 * 1024;
const MARKER_LIST_ROW_HEIGHT = 38;
const MARKER_LIST_OVERSCAN = 4;

// Render a single JSON value as a styled inline span
function JsonValueSpan({ value }: { value: unknown }) {
  if (value === null) return <span className="jt-null">null</span>;
  if (value === undefined) return <span className="jt-null">undefined</span>;
  if (typeof value === "boolean") return <span className="jt-bool">{String(value)}</span>;
  if (typeof value === "number") return <span className="jt-number">{String(value)}</span>;
  if (typeof value === "string") return <span className="jt-string">"{value}"</span>;
  return <span className="jt-null">{String(value)}</span>;
}

// Recursive tree node for rendering JSON as a collapsible file-tree
function JsonTreeNode({
  label,
  value,
  defaultOpen = true,
  depth = 0,
}: {
  label?: string;
  value: unknown;
  defaultOpen?: boolean;
  depth?: number;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  // Primitive values
  if (value === null || value === undefined || typeof value !== "object") {
    return (
      <div className="jt-leaf">
        {label != null && <span className="jt-key">{label}: </span>}
        <JsonValueSpan value={value} />
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const bracketLabel = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className="jt-branch">
      <button
        type="button"
        className={`jt-toggle${open ? " is-open" : ""}`}
        onClick={() => setOpen((p) => !p)}
      >
        <span className="jt-arrow">{open ? "▾" : "▸"}</span>
        {label != null && <span className="jt-key">{label}</span>}
        <span className="jt-bracket">{bracketLabel}</span>
      </button>
      {open && (
        <div className="jt-children">
          {entries.map(([k, v]) => (
            <JsonTreeNode
              key={k}
              label={k}
              value={v}
              defaultOpen={depth < 1}
              depth={depth + 1}
            />
          ))}
          {entries.length === 0 && (
            <div className="jt-leaf">
              <span className="jt-null">(empty)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function TopPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
    </svg>
  );
}

function RightPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function OpenFileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ConnectSocketIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" ry="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function App() {
  const [health, setHealth] = React.useState<HealthCheck | null>(null);
  const [placeholder, setPlaceholder] = React.useState<FileOpenPlaceholder | null>(null);
  const [filePath, setFilePath] = React.useState("");
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
  const [discoveredServers, setDiscoveredServers] = React.useState<DiscoveredServer[]>([]);
  const [discoveryRefreshToken, setDiscoveryRefreshToken] = React.useState(0);
  const [socketHostInput, setSocketHostInput] = React.useState("");
  const [socketPortInput, setSocketPortInput] = React.useState("");
  const [serverFilterText, setServerFilterText] = React.useState("");
  const [showFavoriteDialog, setShowFavoriteDialog] = React.useState(false);
  const [favoriteDialogName, setFavoriteDialogName] = React.useState("");
  const [favoriteDialogPath, setFavoriteDialogPath] = React.useState("");
  const [showMarkerConfigModal, setShowMarkerConfigModal] = React.useState(false);
  const [markerRuleConfig, setMarkerRuleConfig] = React.useState<MarkerRuleConfig>(DEFAULT_MARKER_RULE_CONFIG);
  const saveMarkerConfigTimerRef = React.useRef<number | null>(null);
  const [isDisconnected, setIsDisconnected] = React.useState(false);
  const [showSourcePanel, setShowSourcePanel] = React.useState(false);
  const [sourcePanelWidth, setSourcePanelWidth] = React.useState(280);

  const [lastFixture, setLastFixture] = React.useState<FixtureMetadata | null>(null);
  const [lastBenchmark, setLastBenchmark] = React.useState<CoreBenchmarkReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [followTail, setFollowTail] = React.useState(true);
  const [pendingTailLines, setPendingTailLines] = React.useState(0);
  const [tailNotice, setTailNotice] = React.useState<string | null>(null);
  const [markers, setMarkers] = React.useState<LogMarker[]>([]);
  const [selectedMarker, setSelectedMarker] = React.useState<LogMarker | null>(null);
  const [selectedPayload, setSelectedPayload] = React.useState<MarkerPayload | null>(null);
  const [copiedMarkerId, setCopiedMarkerId] = React.useState<string | null>(null);
  const [markerFilterText, setMarkerFilterText] = React.useState("");
  const [markerFilterKinds, setMarkerFilterKinds] = React.useState<Set<string>>(() => new Set());
  const [markerListScrollTop, setMarkerListScrollTop] = React.useState(0);
  const [markerListHeight, setMarkerListHeight] = React.useState(200);
  const [markerSplitRatio, setMarkerSplitRatio] = React.useState(0.5);
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
  const logViewportRef = React.useRef<HTMLDivElement | null>(null);
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
  const logFileRef = React.useRef<LogFileMetadata | null>(null);
  React.useEffect(() => { logFileRef.current = logFile; }, [logFile]);
  const saveUiStateTimerRef = React.useRef<number | null>(null);
  const markerListRef = React.useRef<HTMLDivElement | null>(null);
  const initialLoadDoneRef = React.useRef(false);
  const knownMarkerKindsRef = React.useRef<Set<string>>(new Set());
  const pendingHorizontalRevealRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    invoke<HealthCheck>("health_check")
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("logscope-marker-rules");
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<MarkerRuleConfig>;
        const d = DEFAULT_MARKER_RULE_CONFIG;
        setMarkerRuleConfig({
          version: parsed.version ?? d.version,
          ruleEnabled: { ...d.ruleEnabled, ...parsed.ruleEnabled },
          kindColors: { ...d.kindColors, ...parsed.kindColors },
          keywordRules: {
            error: parsed.keywordRules?.error ?? d.keywordRules.error,
            warning: parsed.keywordRules?.warning ?? d.keywordRules.warning,
          },
          severityRules: {
            success: parsed.severityRules?.success ?? d.severityRules.success,
            error: parsed.severityRules?.error ?? d.severityRules.error,
            warning: parsed.severityRules?.warning ?? d.severityRules.warning,
          },
          stackTracePatterns: parsed.stackTracePatterns ?? d.stackTracePatterns,
        });
      }
    } catch { /* ignore */ }
  }, []);

  // UDP discovery lifecycle: start/stop when socket modal opens/closes
  React.useEffect(() => {
    if (!showSocketModal) {
      invoke("stop_udp_discovery").catch(() => {});
      return;
    }
    // Start listening and clear previous results
    setDiscoveredServers([]);
    invoke("start_udp_discovery").catch(() => {});

    const unlisten = listen<DiscoveredServer>("udp-server-discovered", (event) => {
      const server = event.payload;
      setDiscoveredServers((prev) => {
        const identity = (server.hostname || server.host).trim().toLowerCase();
        const next = [...prev];
        const index = next.findIndex((item) => {
          const itemIdentity = (item.hostname || item.host).trim().toLowerCase();
          return itemIdentity === identity || item.host === server.host;
        });
        if (index >= 0) {
          next[index] = server;
        } else {
          next.push(server);
        }
        return next;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
      invoke("stop_udp_discovery").catch(() => {});
    };
  }, [discoveryRefreshToken, showSocketModal]);

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
        setShowSourcePanel(uiState.showSourcePanel ?? false);
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
        showSourcePanel,
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
    showSourcePanel,
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
    if (saveMarkerConfigTimerRef.current !== null) {
      window.clearTimeout(saveMarkerConfigTimerRef.current);
    }
    saveMarkerConfigTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem("logscope-marker-rules", JSON.stringify(markerRuleConfig));
      } catch { /* ignore */ }
    }, 400);
    return () => {
      if (saveMarkerConfigTimerRef.current !== null) {
        window.clearTimeout(saveMarkerConfigTimerRef.current);
      }
    };
  }, [markerRuleConfig]);

  React.useEffect(() => {
    invoke("update_marker_config", {
      config: {
        rule_enabled: {
          message_blocks: markerRuleConfig.ruleEnabled.message_blocks,
          error_stack: markerRuleConfig.ruleEnabled.error_stack,
          json_event: markerRuleConfig.ruleEnabled.json_event,
          state_change: markerRuleConfig.ruleEnabled.state_change,
          keyword: markerRuleConfig.ruleEnabled.keyword,
        },
        kind_colors: {
          error_stack: markerRuleConfig.kindColors.error_stack,
          json_event: markerRuleConfig.kindColors.json_event,
          state_change: markerRuleConfig.kindColors.state_change,
          keyword_error: markerRuleConfig.kindColors.keyword_error,
          keyword_warning: markerRuleConfig.kindColors.keyword_warning,
        },
        keyword_rules: {
          error: markerRuleConfig.keywordRules.error,
          warning: markerRuleConfig.keywordRules.warning,
        },
        stack_trace_patterns: markerRuleConfig.stackTracePatterns,
      },
    }).catch((err: unknown) => console.warn("Unable to sync marker config to backend", err));
  }, [markerRuleConfig]);

  React.useEffect(() => {
    const title = logFile?.path ? `${logFile.path} - Log Scope` : "Log Scope";
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

  const focusFindInput = React.useCallback((selectText = true) => {
    if (!findInputRef.current) {
      return;
    }
    findInputRef.current.focus();
    if (selectText) {
      findInputRef.current.select();
    }
  }, []);

  React.useEffect(() => {
    if (!findBarOpen) {
      return;
    }

    focusFindInput();
    const animationFrameId = requestAnimationFrame(() => focusFindInput());
    return () => cancelAnimationFrame(animationFrameId);
  }, [findBarOpen, focusFindInput]);

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
        setServerFilterText("");
      } else if (payload.action === "health_check") {
        runPlaceholder();
      } else if (payload.action === "open_recent_file") {
        setFilePath(payload.path);
        openPath(payload.path);
      } else if (payload.action === "open_recent_socket") {
        connectSocketSource(payload.host, payload.port);
      } else if (payload.action === "open_favorite_file") {
        setFilePath(payload.path);
        openPath(payload.path);
      } else if (payload.action === "open_favorite_socket") {
        connectSocketSource(payload.host, payload.port, payload.hostname);
      } else if (payload.action === "add_favorite") {
        const current = logFileRef.current;
        if (!current) return;
        const displayPath = current.path.startsWith("logscope-frame-v1://")
          ? current.path.slice("logscope-frame-v1://".length)
          : current.path;
        setFavoriteDialogPath(displayPath);
        setFavoriteDialogName("");
        setShowFavoriteDialog(true);
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
    if (!logFile || isDisconnected) {
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
  }, [followTail, loadMarkers, logFile?.sessionId, isDisconnected]);

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
      setCopiedMarkerId(null);
      setMarkerFilterText("");
      setMarkerFilterKinds(new Set());
      setMarkerListScrollTop(0);
      knownMarkerKindsRef.current = new Set();
      setSearchResult(null);
      setActiveSearchMatch(null);
      searchCacheRef.current = null;
      setPendingTailLines(0);
      setTailNotice(null);
      setScrollTop(0);
      setJumpLine("1");
      setIsDisconnected(false);
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

  const connectSocketSource = async (
    normalizedHost: string,
    parsedPort: number,
    hostname?: string | null,
  ) => {
    setIsConnectingSocket(true);
    setError(null);
    try {
      const metadata = await invoke<SocketConnectMetadata>("connect_log_socket", {
        host: normalizedHost,
        port: parsedPort,
        hostname: hostname ?? null,
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
      setCopiedMarkerId(null);
      setMarkerFilterText("");
      setMarkerFilterKinds(new Set());
      setMarkerListScrollTop(0);
      knownMarkerKindsRef.current = new Set();
      setSearchResult(null);
      setActiveSearchMatch(null);
      searchCacheRef.current = null;
      setPendingTailLines(0);
      setTailNotice("Socket 已连接，正在等待 frame 数据");
      setScrollTop(0);
      setJumpLine("1");
      setIsDisconnected(false);
      await refreshPersistedState();
      if (viewportRef.current) {
        viewportRef.current.scrollTop = 0;
      }
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setIsConnectingSocket(false);
    }
  };

  const normalizedSocketHost = socketHostInput.trim();
  const normalizedSocketPortText = socketPortInput.trim();
  const parsedSocketPort = Number.parseInt(socketPortInput, 10);
  const hasSocketEndpointInput = normalizedSocketHost.length > 0 && normalizedSocketPortText.length > 0;
  const isSocketPortValid = Number.isInteger(parsedSocketPort) && parsedSocketPort > 0 && parsedSocketPort <= 65535;
  const matchedDiscoveredServer = React.useMemo(
    () => discoveredServers.find((server) => server.host === normalizedSocketHost && server.port === parsedSocketPort) ?? null,
    [discoveredServers, normalizedSocketHost, parsedSocketPort],
  );
  const filteredServers = React.useMemo(() => {
    const q = serverFilterText.trim().toLowerCase();
    if (!q) return discoveredServers;
    return discoveredServers.filter((server) =>
      server.hostname.toLowerCase().includes(q) || server.host.toLowerCase().includes(q) || server.port.toString().includes(q)
    );
  }, [discoveredServers, serverFilterText]);

  const handleSocketModalClose = React.useCallback(() => {
    setShowSocketModal(false);
  }, []);

  const handleFavoriteDialogConfirm = React.useCallback(async () => {
    const current = logFileRef.current;
    if (!current) return;
    const name = favoriteDialogName.trim() || undefined;
    try {
      if (current.path.startsWith("logscope-frame-v1://")) {
        const afterProto = current.path.slice("logscope-frame-v1://".length);
        const sepIdx = afterProto.lastIndexOf(":");
        if (sepIdx > 0) {
          const host = afterProto.slice(0, sepIdx);
          const port = Number.parseInt(afterProto.slice(sepIdx + 1), 10);
          if (host && Number.isInteger(port)) {
            await invoke<PersistedStore>("add_favorite_socket", { host, port, hostname: null, customName: name });
          }
        }
      } else {
        await invoke<PersistedStore>("add_favorite_file", { path: current.path, customName: name });
      }
      await refreshPersistedState();
    } catch (err) {
      setError(`收藏失败: ${String(err)}`);
    }
    setShowFavoriteDialog(false);
  }, [favoriteDialogName, refreshPersistedState]);

  const handleDiscoveredServerPick = React.useCallback((server: DiscoveredServer) => {
    setSocketHostInput(server.host);
    setSocketPortInput(String(server.port));
  }, []);

  const handleConnectSocketFromInput = React.useCallback(async () => {
    if (!hasSocketEndpointInput || !isSocketPortValid) {
      return false;
    }
    return connectSocketSource(
      normalizedSocketHost,
      parsedSocketPort,
      matchedDiscoveredServer?.hostname ?? null,
    );
  }, [
    connectSocketSource,
    isSocketPortValid,
    matchedDiscoveredServer?.hostname,
    normalizedSocketHost,
    parsedSocketPort,
  ]);

  React.useEffect(() => {
    if (!showSocketModal) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      handleSocketModalClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSocketModalClose, showSocketModal]);

  React.useEffect(() => {
    if (!showFavoriteDialog) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setShowFavoriteDialog(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showFavoriteDialog]);

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

  const isMarkerInViewport = React.useCallback(
    (marker: LogMarker) => {
      const viewport = viewportRef.current;
      if (!logFile || !viewport) {
        return false;
      }
      const markerTop = (Math.max(1, marker.startLine) - 1) * ROW_HEIGHT;
      const markerBottom = Math.max(markerTop + ROW_HEIGHT, marker.endLine * ROW_HEIGHT);
      const viewportTop = viewport.scrollTop;
      const viewportBottom = viewportTop + viewport.clientHeight;
      return markerBottom > viewportTop && markerTop < viewportBottom;
    },
    [logFile],
  );

  const revealSearchMatchIfNeeded = React.useCallback(
    (match: LogSearchMatch) => {
      if (!isLineInViewport(match.lineNumber)) {
        scrollToLineCentered(match.lineNumber);
      }
      pendingHorizontalRevealRef.current = getSearchMatchKey(match);
    },
    [isLineInViewport, scrollToLineCentered],
  );

  const revealSearchMatchHorizontally = React.useCallback((match: LogSearchMatch) => {
    const viewport = logViewportRef.current;
    if (!viewport) {
      return false;
    }

    const row = viewport.querySelector<HTMLElement>(`.log-row[data-line-number="${match.lineNumber}"]`);
    if (!row) {
      return false;
    }

    const pieces = row.querySelectorAll<HTMLElement>(
      `[data-search-start="${match.startColumn}"][data-search-end="${match.endColumn}"]`,
    );
    if (pieces.length === 0) {
      return false;
    }

    const gutter = row.querySelector<HTMLElement>(".line-number");
    const gutterWidth = gutter?.offsetWidth ?? 0;
    let rangeLeft = Number.POSITIVE_INFINITY;
    let rangeRight = Number.NEGATIVE_INFINITY;
    const viewportRect = viewport.getBoundingClientRect();

    for (const piece of pieces) {
      const pieceRect = piece.getBoundingClientRect();
      rangeLeft = Math.min(rangeLeft, viewport.scrollLeft + pieceRect.left - viewportRect.left);
      rangeRight = Math.max(rangeRight, viewport.scrollLeft + pieceRect.right - viewportRect.left);
    }

    if (!Number.isFinite(rangeLeft) || !Number.isFinite(rangeRight)) {
      return false;
    }

    const padding = 24;
    const visibleLeft = viewport.scrollLeft + gutterWidth;
    const visibleRight = viewport.scrollLeft + viewport.clientWidth;
    if (rangeLeft >= visibleLeft + padding && rangeRight <= visibleRight - padding) {
      return true;
    }

    let nextScrollLeft = viewport.scrollLeft;
    if (rangeLeft < visibleLeft + padding) {
      nextScrollLeft = Math.max(0, rangeLeft - gutterWidth - padding);
    } else if (rangeRight > visibleRight - padding) {
      nextScrollLeft = Math.max(0, rangeRight - viewport.clientWidth + padding);
    }

    if (Math.abs(nextScrollLeft - viewport.scrollLeft) > 1) {
      viewport.scrollLeft = nextScrollLeft;
    }
    return true;
  }, []);

  // Derived: unique marker kinds for filter buttons
  const markerKinds = React.useMemo(() => {
    const kinds = new Set<string>();
    for (const m of markers) {
      kinds.add(m.kind);
    }
    return Array.from(kinds).sort();
  }, [markers]);

  // Auto-add new marker kinds to the filter set (default all ON)
  React.useEffect(() => {
    const unseenKinds = markerKinds.filter((kind) => !knownMarkerKindsRef.current.has(kind));
    if (unseenKinds.length === 0) {
      return;
    }

    for (const kind of unseenKinds) {
      knownMarkerKindsRef.current.add(kind);
    }

    setMarkerFilterKinds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const kind of unseenKinds) {
        if (!next.has(kind)) {
          next.add(kind);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [markerKinds]);

  // Derived: filtered markers for the left-panel list
  const filteredMarkers = React.useMemo(() => {
    let result = markers;
    // Always apply kind filter when marker kinds exist.
    // Before the auto-add effect runs, markerFilterKinds may be empty;
    // in that case fall through (show all) only if no kinds are known yet.
    if (markerKinds.length > 0) {
      result = result.filter((m) => markerFilterKinds.has(m.kind));
    }
    if (markerFilterText) {
      const lower = markerFilterText.toLowerCase();
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(lower) ||
          m.messageName.toLowerCase().includes(lower) ||
          m.kind.toLowerCase().includes(lower),
      );
    }
    // Already sorted by startLine ascending (newer = higher line = lower in list)
    return result;
  }, [markers, markerFilterKinds, markerFilterText, markerKinds.length]);

  // Scroll marker list to show the selected marker (virtualized)
  const scrollMarkerListToSelected = React.useCallback(
    (markerId: string) => {
      const idx = filteredMarkers.findIndex((m) => m.id === markerId);
      if (idx === -1) return;
      const container = markerListRef.current;
      if (!container) return;
      const itemTop = idx * MARKER_LIST_ROW_HEIGHT;
      const itemBottom = itemTop + MARKER_LIST_ROW_HEIGHT;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (itemTop < viewTop) {
        container.scrollTop = itemTop;
      } else if (itemBottom > viewBottom) {
        container.scrollTop = itemBottom - container.clientHeight;
      }
    },
    [filteredMarkers],
  );

  // ResizeObserver for marker list container height
  React.useEffect(() => {
    const container = markerListRef.current;
    if (!container) return;
    const update = () => setMarkerListHeight(container.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [showSourcePanel, markerSplitRatio]);

  const selectMarker = React.useCallback(
    async (marker: LogMarker) => {
      if (!logFile) {
        return;
      }
      setSelectedMarker(marker);
      setShowSourcePanel(true);
      setSelectedPayload(null);
      setCopiedMarkerId(null);
      if (!isMarkerInViewport(marker)) {
        scrollToLineCentered(marker.startLine);
      }
      // Scroll the marker list to show the selected item (if it exists in filtered list)
      requestAnimationFrame(() => scrollMarkerListToSelected(marker.id));
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
    [isMarkerInViewport, logFile, scrollToLineCentered, scrollMarkerListToSelected],
  );

  const copySelectedMarkerText = React.useCallback(async () => {
    if (!selectedMarker || !logFile) {
      return;
    }
    try {
      const fullText = await invoke<string>("get_marker_copy_text", {
        sessionId: logFile.sessionId,
        markerId: selectedMarker.id,
      });
      await invoke("copy_text_to_clipboard", { text: fullText });
      setCopiedMarkerId(selectedMarker.id);
      window.setTimeout(() => {
        setCopiedMarkerId((current) => (current === selectedMarker.id ? null : current));
      }, 1500);
      setError(null);
    } catch (err) {
      setError(`复制 Marker 文本失败: ${String(err)}`);
    }
  }, [logFile, selectedMarker]);

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

  const getViewportSearchAnchor = React.useCallback(
    (direction: "next" | "previous") => {
      const shouldRestartFromViewport =
        !activeSearchMatch || !isLineInViewport(activeSearchMatch.lineNumber);
      if (shouldRestartFromViewport) {
        const viewportLineCount = Math.max(1, Math.ceil(Math.max(viewportHeight, ROW_HEIGHT) / ROW_HEIGHT));
        const lastVisibleLine = logFile
          ? Math.min(firstVisibleLine + viewportLineCount - 1, logFile.lineCount)
          : firstVisibleLine;
        return {
          startLine: direction === "previous" ? lastVisibleLine : firstVisibleLine,
          startColumn: 0,
          activeMatchForNavigation: null,
        };
      }

      return {
        startLine: activeSearchMatch.lineNumber,
        startColumn: direction === "next" ? activeSearchMatch.startColumn + 1 : activeSearchMatch.startColumn,
        activeMatchForNavigation: activeSearchMatch,
      };
    },
    [activeSearchMatch, firstVisibleLine, isLineInViewport, viewportHeight, logFile],
  );

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
        const anchor = getViewportSearchAnchor(direction);
        const viewportLineCount = Math.max(1, Math.ceil(Math.max(viewportHeight, ROW_HEIGHT) / ROW_HEIGHT));
        const lastVisibleLine = logFile
          ? Math.min(firstVisibleLine + viewportLineCount - 1, logFile.lineCount)
          : firstVisibleLine;
        const nextResult = navigateCachedSearch(
          cached.result,
          direction,
          anchor.activeMatchForNavigation,
          firstVisibleLine,
          lastVisibleLine,
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
      } else {
        const anchor = getViewportSearchAnchor(direction);
        startLine = anchor.startLine;
        startColumn = anchor.startColumn;
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
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        const sel = window.getSelection();
        const selectedText = sel ? sel.toString().trim() : "";
        if (findBarOpen) {
          if (selectedText) {
            searchCacheRef.current = null;
            setSearchResult(null);
            setActiveSearchMatch(null);
            setSearchQuery(selectedText);
          }
          if (document.activeElement !== findInputRef.current) {
            focusFindInput();
          } else {
            findInputRef.current?.select();
          }
          return;
        }
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
      if (event.key === "Escape") {
        if (findBarOpen) {
          event.preventDefault();
          setFindBarOpen(false);
        } else if (gotoBarOpen) {
          event.preventDefault();
          closeGotoLineBar();
        } else if (showSourcePanel) {
          event.preventDefault();
          setShowSourcePanel(false);
        }
      }
      if (
        showSourcePanel &&
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !findBarOpen &&
        !gotoBarOpen &&
        !isEditableTarget &&
        filteredMarkers.length > 0
      ) {
        const currentIdx = selectedMarker
          ? filteredMarkers.findIndex((m) => m.id === selectedMarker.id)
          : -1;

        let selectedInViewport = false;
        if (currentIdx >= 0 && selectedMarker && logFile) {
          const viewport = viewportRef.current;
          if (viewport) {
            const markerTop = (Math.max(1, selectedMarker.startLine) - 1) * ROW_HEIGHT;
            const markerBottom = Math.max(markerTop + ROW_HEIGHT, selectedMarker.endLine * ROW_HEIGHT);
            const vpTop = viewport.scrollTop;
            const vpBottom = vpTop + viewport.clientHeight;
            selectedInViewport = markerBottom > vpTop && markerTop < vpBottom;
          }
        }

        let nextIdx = currentIdx;
        if (event.key === "ArrowDown") {
          if (currentIdx < 0 || !selectedInViewport) {
            nextIdx = filteredMarkers.findIndex((m) => m.startLine >= firstVisibleLine);
            if (nextIdx < 0) nextIdx = 0;
          } else {
            nextIdx = Math.min(currentIdx + 1, filteredMarkers.length - 1);
          }
        } else {
          if (currentIdx < 0 || !selectedInViewport) {
            const viewport = viewportRef.current;
            let viewportBottomLine = 1;
            if (viewport && logFile) {
              viewportBottomLine = Math.min(
                Math.floor((viewport.scrollTop + viewport.clientHeight) / ROW_HEIGHT) + 1,
                logFile.lineCount,
              );
            }
            nextIdx = findLastIndex(filteredMarkers, (m) => m.startLine <= viewportBottomLine);
            if (nextIdx < 0) nextIdx = filteredMarkers.length - 1;
          } else {
            nextIdx = Math.max(currentIdx - 1, 0);
          }
        }
        if (nextIdx !== currentIdx) {
          event.preventDefault();
          void selectMarker(filteredMarkers[nextIdx]);
        }
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
    showSourcePanel,
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
    focusFindInput,
    revealSearchMatchIfNeeded,
    filteredMarkers,
    selectedMarker,
    selectMarker,
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
  const selectedMarkerRange = React.useMemo(
    () =>
      selectedMarker
        ? {
          startLine: selectedMarker.startLine,
          endLine: selectedMarker.endLine,
        }
        : null,
    [selectedMarker],
  );
  const activeSearchLine = activeSearchMatch?.lineNumber ?? 0;
  const activeSearchMatchKey = activeSearchMatch ? getSearchMatchKey(activeSearchMatch) : null;
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
    if (!activeSearchMatch || !activeSearchMatchKey) {
      pendingHorizontalRevealRef.current = null;
      return;
    }
    if (pendingHorizontalRevealRef.current !== activeSearchMatchKey) {
      return;
    }
    if (revealSearchMatchHorizontally(activeSearchMatch)) {
      pendingHorizontalRevealRef.current = null;
    }
  }, [activeSearchMatch, activeSearchMatchKey, renderedLines, revealSearchMatchHorizontally, scrollTop]);

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
      const isSelected = selectedMarker?.id === marker.id;
      context.fillStyle = getMarkerDisplayColor(marker, markerRuleConfig);
      if (marker.kind === "message") {
        drawMessageTriangle(context, point.x, point.y, isSelected ? 5 : 4, marker.direction);
      } else {
        context.beginPath();
        context.arc(point.x, point.y, isSelected ? 4 : 3, 0, Math.PI * 2);
        context.fill();
      }
      if (isSelected) {
        drawSelectedMarkerRing(context, point.x, point.y, marker.kind === "message" ? 8 : 7);
      }
    }
    const drawDurationMs = performance.now() - drawStartedAt;
    setPerfSnapshot((current) => ({ ...current, globalMinimapMs: drawDurationMs }));
  }, [firstVisibleLine, globalMinimapWidth, logFile, markers, markerRuleConfig, selectedMarker?.id, viewportLineCount]);

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
      const isSelected = selectedMarker?.id === marker.id;
      context.fillStyle = getMarkerDisplayColor(marker, markerRuleConfig);
      if (marker.kind === "message") {
        drawMessageTriangle(context, point.x, point.y, isSelected ? 6 : 5, marker.direction);
      } else {
        context.beginPath();
        context.arc(point.x, point.y, isSelected ? 4 : 3, 0, Math.PI * 2);
        context.fill();
      }
      if (isSelected) {
        drawSelectedMarkerRing(context, point.x, point.y, marker.kind === "message" ? 9 : 7);
      }
    }
    const drawDurationMs = performance.now() - drawStartedAt;
    setPerfSnapshot((current) => ({ ...current, localMinimapMs: drawDurationMs }));
  }, [firstVisibleLine, logFile, markers, markerRuleConfig, rightMinimapRange, selectedMarker?.id, viewportHeight, viewportLineCount]);

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

  React.useEffect(() => {
    if (persistedStore && !initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;
      if (persistedStore.lastSource?.kind === "file" && persistedStore.lastSource.path) {
        void openPath(persistedStore.lastSource.path);
      } else if (persistedStore.lastSource?.kind === "socket" && persistedStore.lastSource.host && persistedStore.lastSource.port) {
        void connectSocketSource(
          persistedStore.lastSource.host,
          persistedStore.lastSource.port,
          persistedStore.lastSource.hostname,
        );
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedStore]);

  return (
    <main className="app-shell">
      <header className="viewer-toolbar">
        <div className="toolbar-buttons">
          <button
            type="button"
            className="toolbar-icon-button"
            onClick={() => open({ multiple: false, directory: false }).then((selected) => {
              if (typeof selected === "string") {
                setFilePath(selected);
                openPath(selected);
              }
            }).catch(console.error)}
            title="打开文件 (⌘O)"
          >
            <OpenFileIcon />
          </button>
          <button
            type="button"
            className="toolbar-icon-button"
            onClick={() => { setShowSocketModal(true); setServerFilterText(""); }}
            title="连接 Socket (⌘⇧O)"
          >
            <ConnectSocketIcon />
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            className="toolbar-icon-button"
            style={{
              backgroundColor: isDisconnected ? "#ffe9e9" : "#e9f2ef",
              color: isDisconnected ? "#c92a2a" : "#18706a",
            }}
            disabled={!logFile && !isConnectingSocket}
            onClick={() => setIsDisconnected((current) => !current)}
            title={isDisconnected ? "恢复更新" : "暂停更新"}
          >
            {isDisconnected ? <PlayIcon /> : <PauseIcon />}
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            className={`toolbar-icon-button${showSourcePanel ? " is-active" : ""}`}
            onClick={() => setShowSourcePanel((current) => !current)}
            title="显示/隐藏左侧栏"
          >
            <SidebarIcon />
          </button>
          <button
            type="button"
            className={`toolbar-icon-button${showGlobalMinimap ? " is-active" : ""}`}
            onClick={() => setShowGlobalMinimap((current) => !current)}
            title="显示/隐藏顶部 Minimap"
          >
            <TopPanelIcon />
          </button>
          <button
            type="button"
            className={`toolbar-icon-button${showLocalMinimap ? " is-active" : ""}`}
            onClick={() => setShowLocalMinimap((current) => !current)}
            title="显示/隐藏右侧 Minimap"
          >
            <RightPanelIcon />
          </button>
          <span className="toolbar-separator" />
          <button
            type="button"
            className="toolbar-icon-button"
            onClick={() => setShowMarkerConfigModal(true)}
            title="标记规则配置"
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="app-body" style={{ gridTemplateColumns: showSourcePanel ? `${sourcePanelWidth}px 4px minmax(0, 1fr)` : 'minmax(0, 1fr)' }}>
        <aside className="source-panel" style={{ display: showSourcePanel ? 'flex' : 'none' }}>

          <section className="panel-section marker-panel" style={{ flex: 1, minHeight: 0 }}>
            <input
              className="marker-filter-input"
              value={markerFilterText}
              onChange={(e) => setMarkerFilterText(e.target.value)}
              placeholder={`搜索 Marker (${markers.length})`}
              aria-label="过滤 Marker"
              onKeyDown={(e) => e.stopPropagation()}
            />

            {markerKinds.length > 1 && (
              <div className="marker-kind-filters">
                {markerKinds.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`marker-kind-btn${markerFilterKinds.has(kind) ? " is-active" : ""}`}
                    onClick={() => {
                      setMarkerFilterKinds((prev) => {
                        const next = new Set(prev);
                        if (next.has(kind)) {
                          next.delete(kind);
                        } else {
                          next.add(kind);
                        }
                        return next;
                      });
                    }}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            )}

            {/* Virtualized marker list */}
            <div
              className="marker-virtual-list"
              ref={markerListRef}
              tabIndex={-1}
              style={{ flex: markerSplitRatio }}
              onScroll={(e) => setMarkerListScrollTop(e.currentTarget.scrollTop)}
            >
              {filteredMarkers.length > 0 ? (
                <div style={{ height: filteredMarkers.length * MARKER_LIST_ROW_HEIGHT, position: "relative" }}>
                  {(() => {
                    const firstIdx = Math.max(0, Math.floor(markerListScrollTop / MARKER_LIST_ROW_HEIGHT) - MARKER_LIST_OVERSCAN);
                    const visibleCount = Math.ceil(markerListHeight / MARKER_LIST_ROW_HEIGHT) + MARKER_LIST_OVERSCAN * 2;
                    const lastIdx = Math.min(filteredMarkers.length - 1, firstIdx + visibleCount);
                    const items: React.ReactNode[] = [];
                    for (let i = firstIdx; i <= lastIdx; i++) {
                      const marker = filteredMarkers[i];
                      items.push(
                        <button
                          key={marker.id}
                          type="button"
                          className={`marker-list-item${selectedMarker?.id === marker.id ? " is-selected" : ""}`}
                          data-marker-id={marker.id}
                          style={{
                            position: "absolute",
                            top: i * MARKER_LIST_ROW_HEIGHT,
                            left: 0,
                            right: 0,
                            height: MARKER_LIST_ROW_HEIGHT,
                          }}
                          onClick={() => void selectMarker(marker)}
                          title={`${marker.title}\n${marker.kind}${marker.direction ? ` · ${marker.direction}` : ""}${marker.messageName ? ` · ${marker.messageName}` : ""}\nL${marker.startLine}–L${marker.endLine} · ${marker.parseStatus}${marker.lineTime ? `\n${marker.lineTime}` : ""}`}
                        >
                          <span className="marker-list-item-dot" style={{ background: getMarkerDisplayColor(marker, markerRuleConfig) }} />
                          <span className="marker-list-item-title">{marker.title}</span>
                          <span className="marker-list-item-time">{marker.lineTime || ""}</span>
                          <span className="marker-list-item-line">L{marker.startLine}</span>
                        </button>,
                      );
                    }
                    return items;
                  })()}
                </div>
              ) : (
                <div className="marker-list-empty">
                  {markers.length > 0
                    ? "无匹配的 Marker"
                    : "当前文件未识别到 Marker"}
                </div>
              )}
            </div>

            {/* Horizontal splitter between list and detail */}
            <div
              className="marker-panel-splitter"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                e.currentTarget.dataset.dragStartY = String(e.clientY);
                e.currentTarget.dataset.dragStartRatio = String(markerSplitRatio);
                const panel = e.currentTarget.closest<HTMLElement>(".marker-panel");
                if (panel) {
                  e.currentTarget.dataset.dragFlexHeight = String(panel.clientHeight);
                }
              }}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const startY = Number(e.currentTarget.dataset.dragStartY);
                const startRatio = Number(e.currentTarget.dataset.dragStartRatio);
                const flexHeight = Number(e.currentTarget.dataset.dragFlexHeight);
                if (!flexHeight) return;
                const deltaY = e.clientY - startY;
                const deltaRatio = deltaY / flexHeight;
                setMarkerSplitRatio(Math.max(0.1, Math.min(0.9, startRatio + deltaRatio)));
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
            />

            {/* Marker detail area */}
            <div className="marker-detail-area" style={{ flex: Math.max(0.01, 1 - markerSplitRatio) }}>
              {selectedMarker ? (
                <>
                  <div className="marker-summary-row">
                    <button type="button" className="marker-summary" onClick={() => scrollToLine(selectedMarker.startLine)}>
                      <span className="marker-dot" style={{ background: getMarkerDisplayColor(selectedMarker, markerRuleConfig) }} />
                      <strong>{selectedMarker.title}</strong>
                      <small>
                        {selectedMarker.kind} {selectedMarker.direction ? `· ${selectedMarker.direction}` : ""} · L
                        {selectedMarker.startLine} · {selectedMarker.parseStatus}
                      </small>
                    </button>
                    <button
                      type="button"
                      className={`marker-copy-button${copiedMarkerId === selectedMarker.id ? " is-copied" : ""}`}
                      onClick={() => void copySelectedMarkerText()}
                      title="复制 Marker 全部文本"
                      aria-label="复制 Marker 全部文本"
                    >
                      <CopyIcon />
                    </button>
                  </div>
                  {!selectedPayload ? <pre className="payload-preview">载入中...</pre> : null}
                  {(() => {
                    const jsonData = selectedPayload?.parsedJson ?? null;
                    if (jsonData) {
                      return (
                        <div className="json-tree-viewer">
                          <JsonTreeNode value={jsonData} defaultOpen={true} />
                        </div>
                      );
                    }
                    if (selectedPayload) {
                      return <pre className="payload-preview">{selectedPayload.rawText || "(empty payload)"}</pre>;
                    }
                    return null;
                  })()}
                  {selectedPayload?.wasTruncated ? (
                    <p className="payload-note">当前仅显示前 64 KiB 预览，原始 payload 为 {selectedPayload.originalBytes} bytes。</p>
                  ) : null}
                  {selectedPayload?.parseError ? <p className="payload-note">{selectedPayload.parseError}</p> : null}
                </>
              ) : (
                <p className="panel-hint">{markers.length > 0 ? "点击列表或右侧 marker 查看详情" : "当前文件未识别到消息 marker"}</p>
              )}
            </div>
          </section>
        </aside>

        <div
          className="panel-resizer"
          style={{ display: showSourcePanel ? 'block' : 'none' }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              setSourcePanelWidth(Math.max(150, Math.min(e.clientX, window.innerWidth - 200)));
            }
          }}
          onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        />

        <section
          className={`viewer-area${showGlobalMinimap ? "" : " is-global-minimap-hidden"}${showLocalMinimap ? "" : " is-local-minimap-hidden"
            }`}
        >
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
                <div className="log-viewport" ref={logViewportRef} style={{ height: viewportHeight || undefined }}>
                  <div className="visible-lines" style={{ transform: `translateY(${visibleOffset}px)` }}>
                    {renderedLines.map((line) => {
                      const isSelectedMarkerLine =
                        selectedMarkerRange !== null &&
                        line.lineNumber >= selectedMarkerRange.startLine &&
                        line.lineNumber <= selectedMarkerRange.endLine;
                      return (
                        <div
                          className={`log-row${line.text === undefined ? " is-loading" : ""}${visibleMarkerLines.has(line.lineNumber) ? " has-marker" : ""
                            }${isSelectedMarkerLine ? " has-selected-marker" : ""
                            }${activeSearchLine === line.lineNumber ? " has-active-search" : ""}${selectedLine === line.lineNumber ? " has-selected-line" : ""
                            } ${getSeverityClass(line.text, logColorMode, markerRuleConfig.severityRules)}`}
                          key={line.lineNumber}
                          data-line-number={line.lineNumber}
                        >
                          <span className={`line-number${isSelectedMarkerLine ? " is-selected-marker" : ""}`}>{line.lineNumber}</span>
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
                      );
                    })}
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
                    <span>将文件拖拽入后打开；viewer 只渲染当前可见行。</span>
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
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    event.preventDefault();
                    closeFindBar();
                  } else if (event.key === "Enter") {
                    event.stopPropagation();
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
        </section>
      </div>

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

      {showSocketModal && createPortal(
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              handleSocketModalClose();
            }
          }}
        >
          <div
            className="modal-content"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-header-left">
                <svg className="modal-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
                <h2>连接 Socket</h2>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={handleSocketModalClose}
                title="关闭"
              >
                ×
              </button>
            </div>
            <div className="discovered-servers">
              <div className="discovered-servers-header">
                <span className="discovered-servers-title">发现的服务器</span>
                <button
                  type="button"
                  className="refresh-button"
                  onClick={() => {
                    setDiscoveredServers([]);
                    setDiscoveryRefreshToken((current) => current + 1);
                  }}
                  title="刷新列表"
                >
                  ⟳
                </button>
              </div>
              <div className="server-filter-bar">
                <svg className="server-filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  className="server-filter-input"
                  type="text"
                  value={serverFilterText}
                  onChange={(event) => setServerFilterText(event.target.value)}
                  placeholder="过滤 hostname 或 IP…"
                  autoComplete="off"
                  spellCheck={false}
                />
                {serverFilterText && (
                  <button
                    type="button"
                    className="server-filter-clear"
                    onClick={() => setServerFilterText("")}
                    title="清除过滤"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="discovered-servers-list">
                {discoveredServers.length === 0 ? (
                  <div className="discovered-servers-empty">
                    <svg className="discovery-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 6v6l4 2" />
                    </svg>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="discovery-spinner" />
                      正在搜索局域网服务器…
                    </span>
                    <span className="discovery-empty-hint">可在下方手动输入 IP 和端口</span>
                  </div>
                ) : filteredServers.length === 0 ? (
                  <div className="discovered-servers-empty">
                    <svg className="discovery-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <span>未匹配到服务器</span>
                    <span className="discovery-empty-hint">尝试修改过滤条件</span>
                  </div>
                ) : (
                  filteredServers.map((server) => {
                    const isSelected = matchedDiscoveredServer?.host === server.host && matchedDiscoveredServer.port === server.port;
                    const initial = (server.hostname || server.host || "?").charAt(0).toUpperCase();
                    const avatarColors = ["#1a6b5a", "#2d5a3d", "#3d5a1a", "#1a5a6b", "#4a3d6b", "#6b4a1a"];
                    const colorIndex = initial.charCodeAt(0) % avatarColors.length;
                    return (
                      <button
                        type="button"
                        key={`${server.host}:${server.port}`}
                        className={`discovered-server-item${isSelected ? " is-selected" : ""}`}
                        onClick={() => handleDiscoveredServerPick(server)}
                      >
                        <div className="server-avatar" style={{ background: avatarColors[colorIndex] }}>
                          {initial}
                          <span className="server-avatar-dot" />
                        </div>
                        <div className="server-info">
                          <span className="server-hostname">{server.hostname}</span>
                          <span className="server-address">{server.host}:{server.port}</span>
                        </div>
                        {isSelected ? (
                          <svg className="server-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg className="server-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="socket-connect-editor">
              <div className="socket-inline-field">
                <label className="modal-field-inline" htmlFor="socket-host-input">
                  <span>IP</span>
                  <input
                    id="socket-host-input"
                    value={socketHostInput}
                    onChange={(event) => setSocketHostInput(event.target.value)}
                    placeholder="例如 127.0.0.1"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </div>
              <div className="socket-editor-actions">
                <div className="socket-inline-field">
                  <label className="modal-field-inline" htmlFor="socket-port-input">
                    <span>端口</span>
                    <input
                      id="socket-port-input"
                      value={socketPortInput}
                      onChange={(event) => setSocketPortInput(event.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      placeholder="8765"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="primary-button socket-connect-button"
                  disabled={!hasSocketEndpointInput || !isSocketPortValid || isConnectingSocket}
                  onClick={() => {
                    void handleConnectSocketFromInput().then((connected) => {
                      if (connected) {
                        handleSocketModalClose();
                      }
                    });
                  }}
                >
                  {isConnectingSocket ? (
                    <>
                      <span className="btn-spinner" />
                      连接中…
                    </>
                  ) : "连接"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showFavoriteDialog && createPortal(
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowFavoriteDialog(false);
            }
          }}
        >
          <div
            className="modal-content favorite-dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-header-left">
                <svg className="modal-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <h2>添加到收藏</h2>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setShowFavoriteDialog(false)}
                title="关闭"
              >
                ×
              </button>
            </div>
            <div className="favorite-dialog-path" title={favoriteDialogPath}>
              {favoriteDialogPath}
            </div>
            <div className="favorite-dialog-field">
              <label className="modal-field-inline" htmlFor="favorite-name-input">
                <span>名称</span>
                <input
                  id="favorite-name-input"
                  value={favoriteDialogName}
                  onChange={(event) => setFavoriteDialogName(event.target.value)}
                  placeholder="留空则显示完整路径"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleFavoriteDialogConfirm();
                    }
                  }}
                />
              </label>
            </div>
            <div className="favorite-dialog-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowFavoriteDialog(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleFavoriteDialogConfirm()}
              >
                确定
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showMarkerConfigModal && createPortal(
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowMarkerConfigModal(false);
            }
          }}
        >
          <div
            className="modal-content marker-config-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-header-left">
                <svg className="modal-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <h2>标记规则配置</h2>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setShowMarkerConfigModal(false)}
                title="关闭"
              >
                ×
              </button>
            </div>

            <div className="marker-config-body">
              {/* Message Blocks */}
              <div className="marker-config-section">
                <div className="marker-config-section-header">
                  <div className="marker-config-section-title">消息块 (Message Blocks)</div>
                  <label className="marker-config-switch">
                    <input
                      type="checkbox"
                      checked={markerRuleConfig.ruleEnabled.message_blocks}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c,
                        ruleEnabled: { ...c.ruleEnabled, message_blocks: e.target.checked },
                      }))}
                    />
                    <span>{markerRuleConfig.ruleEnabled.message_blocks ? "启用" : "禁用"}</span>
                  </label>
                </div>
                <div className="marker-config-info">
                  检测模式: <code>HH:MM:SS&#9;=== Send/Receive Message ([id]) name ===</code><br />
                  颜色: 根据 message_id 哈希自动计算 HSL 颜色，不可手动配置。<br />
                  多行: 消息体持续到分隔线 (<code>====...</code>) 或下一个消息头。
                </div>
              </div>

              {/* Stack Trace */}
              <div className="marker-config-section">
                <div className="marker-config-section-header">
                  <div className="marker-config-section-title">堆栈跟踪 (Stack Trace)</div>
                  <label className="marker-config-switch">
                    <input
                      type="checkbox"
                      checked={markerRuleConfig.ruleEnabled.error_stack}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c,
                        ruleEnabled: { ...c.ruleEnabled, error_stack: e.target.checked },
                      }))}
                    />
                    <span>{markerRuleConfig.ruleEnabled.error_stack ? "启用" : "禁用"}</span>
                  </label>
                </div>
                <div className="marker-config-color-row">
                  <span className="marker-config-label">颜色:</span>
                  <input
                    type="color"
                    value={markerRuleConfig.kindColors.error_stack}
                    onChange={(e) => setMarkerRuleConfig((c) => ({
                      ...c, kindColors: { ...c.kindColors, error_stack: e.target.value },
                    }))}
                  />
                  <input
                    className="marker-config-color-text"
                    type="text"
                    value={markerRuleConfig.kindColors.error_stack}
                    onChange={(e) => setMarkerRuleConfig((c) => ({
                      ...c, kindColors: { ...c.kindColors, error_stack: e.target.value },
                    }))}
                  />
                </div>
                <div className="marker-config-info">
                  检测模式: 行内容为 <code>stack traceback:</code><br />
                  延续模式 (每行一个):
                </div>
                <textarea
                  className="marker-config-textarea"
                  value={markerRuleConfig.stackTracePatterns.join("\n")}
                  onChange={(e) => setMarkerRuleConfig((c) => ({
                    ...c, stackTracePatterns: e.target.value.split("\n").filter((s) => s.length > 0),
                  }))}
                  rows={5}
                />
              </div>

              {/* JSON Events */}
              <div className="marker-config-section">
                <div className="marker-config-section-header">
                  <div className="marker-config-section-title">JSON 事件 (JSON Events)</div>
                  <label className="marker-config-switch">
                    <input
                      type="checkbox"
                      checked={markerRuleConfig.ruleEnabled.json_event}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c,
                        ruleEnabled: { ...c.ruleEnabled, json_event: e.target.checked },
                      }))}
                    />
                    <span>{markerRuleConfig.ruleEnabled.json_event ? "启用" : "禁用"}</span>
                  </label>
                </div>
                <div className="marker-config-color-row">
                  <span className="marker-config-label">颜色:</span>
                  <input
                    type="color"
                    value={markerRuleConfig.kindColors.json_event}
                    onChange={(e) => setMarkerRuleConfig((c) => ({
                      ...c, kindColors: { ...c.kindColors, json_event: e.target.value },
                    }))}
                  />
                  <input
                    className="marker-config-color-text"
                    type="text"
                    value={markerRuleConfig.kindColors.json_event}
                    onChange={(e) => setMarkerRuleConfig((c) => ({
                      ...c, kindColors: { ...c.kindColors, json_event: e.target.value },
                    }))}
                  />
                </div>
                <div className="marker-config-info">
                  检测模式: <code>HH:MM:SS&#9;{"{...}"}</code>，内容为有效 JSON。<br />
                  标题: 从 JSON 的 <code>event_name</code> 字段提取。
                </div>
              </div>

              {/* State Change */}
              <div className="marker-config-section">
                <div className="marker-config-section-header">
                  <div className="marker-config-section-title">状态变更 (ChangeState)</div>
                  <label className="marker-config-switch">
                    <input
                      type="checkbox"
                      checked={markerRuleConfig.ruleEnabled.state_change}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c,
                        ruleEnabled: { ...c.ruleEnabled, state_change: e.target.checked },
                      }))}
                    />
                    <span>{markerRuleConfig.ruleEnabled.state_change ? "启用" : "禁用"}</span>
                  </label>
                </div>
                <div className="marker-config-color-row">
                  <span className="marker-config-label">颜色:</span>
                  <input
                    type="color"
                    value={markerRuleConfig.kindColors.state_change}
                    onChange={(e) => setMarkerRuleConfig((c) => ({
                      ...c, kindColors: { ...c.kindColors, state_change: e.target.value },
                    }))}
                  />
                  <input
                    className="marker-config-color-text"
                    type="text"
                    value={markerRuleConfig.kindColors.state_change}
                    onChange={(e) => setMarkerRuleConfig((c) => ({
                      ...c, kindColors: { ...c.kindColors, state_change: e.target.value },
                    }))}
                  />
                </div>
                <div className="marker-config-info">
                  检测模式: 时间戳行内容以 <code>ChangeState</code> 开头。<br />
                  多行: 若包含 <code>{"{"}</code> 但不以 <code>{"}"}</code> 结尾，持续收集到 <code>{"}"}</code>。
                </div>
              </div>

              {/* Keyword Markers */}
              <div className="marker-config-section">
                <div className="marker-config-section-header">
                  <div className="marker-config-section-title">关键字标记 (Keyword Markers)</div>
                  <label className="marker-config-switch">
                    <input
                      type="checkbox"
                      checked={markerRuleConfig.ruleEnabled.keyword}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c,
                        ruleEnabled: { ...c.ruleEnabled, keyword: e.target.checked },
                      }))}
                    />
                    <span>{markerRuleConfig.ruleEnabled.keyword ? "启用" : "禁用"}</span>
                  </label>
                </div>
                <div className="marker-config-subsection">
                  <div className="marker-config-color-row">
                    <span className="marker-config-label">错误类颜色:</span>
                    <input
                      type="color"
                      value={markerRuleConfig.kindColors.keyword_error}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c, kindColors: { ...c.kindColors, keyword_error: e.target.value },
                      }))}
                    />
                    <input
                      className="marker-config-color-text"
                      type="text"
                      value={markerRuleConfig.kindColors.keyword_error}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c, kindColors: { ...c.kindColors, keyword_error: e.target.value },
                      }))}
                    />
                  </div>
                  <div className="marker-config-row">
                    <span className="marker-config-label">错误关键字:</span>
                    <input
                      className="marker-config-keyword-input"
                      type="text"
                      value={markerRuleConfig.keywordRules.error.join(", ")}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c, keywordRules: { ...c.keywordRules, error: e.target.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0) },
                      }))}
                      placeholder="逗号分隔"
                    />
                  </div>
                </div>
                <div className="marker-config-subsection">
                  <div className="marker-config-color-row">
                    <span className="marker-config-label">警告类颜色:</span>
                    <input
                      type="color"
                      value={markerRuleConfig.kindColors.keyword_warning}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c, kindColors: { ...c.kindColors, keyword_warning: e.target.value },
                      }))}
                    />
                    <input
                      className="marker-config-color-text"
                      type="text"
                      value={markerRuleConfig.kindColors.keyword_warning}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c, kindColors: { ...c.kindColors, keyword_warning: e.target.value },
                      }))}
                    />
                  </div>
                  <div className="marker-config-row">
                    <span className="marker-config-label">警告关键字:</span>
                    <input
                      className="marker-config-keyword-input"
                      type="text"
                      value={markerRuleConfig.keywordRules.warning.join(", ")}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c, keywordRules: { ...c.keywordRules, warning: e.target.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0) },
                      }))}
                      placeholder="逗号分隔"
                    />
                  </div>
                </div>
                <div className="marker-config-info">
                  仅对带时间戳的行生效，每行只匹配一次（按优先级：错误类 &gt; 警告类）。
                </div>
              </div>

              {/* Severity Coloring */}
              <div className="marker-config-section">
                <div className="marker-config-section-title">行严重级别着色 (Severity Coloring)</div>
                <div className="marker-config-info" style={{ marginBottom: 8 }}>
                  用于日志行的背景着色，独立于标记系统。
                </div>
                {(["success", "error", "warning"] as const).map((level) => (
                  <div className="marker-config-row" key={level}>
                    <span className="marker-config-label">
                      <span className={`marker-config-severity-dot severity-${level}`} />
                      {level === "success" ? "成功" : level === "error" ? "错误" : "警告"}:
                    </span>
                    <input
                      className="marker-config-keyword-input"
                      type="text"
                      value={markerRuleConfig.severityRules[level].join(", ")}
                      onChange={(e) => setMarkerRuleConfig((c) => ({
                        ...c, severityRules: {
                          ...c.severityRules,
                          [level]: e.target.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
                        },
                      }))}
                      placeholder="逗号分隔"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="marker-config-info" style={{ marginTop: 8, marginBottom: 4 }}>
              颜色类配置会即时生效；规则启用状态、关键字集合和堆栈延续模式需要重新打开文件或点击「重新扫描」后生效。
            </div>

            <div className="marker-config-actions">
              <button
                type="button"
                className="marker-config-btn secondary"
                onClick={() => {
                  const doc = generateMarkerRuleDoc(markerRuleConfig);
                  navigator.clipboard.writeText(doc).catch(() => {});
                }}
              >
                复制文档
              </button>
              <div style={{ flex: 1 }} />
              {filePath && (
                <button
                  type="button"
                  className="marker-config-btn secondary"
                  onClick={() => {
                    setShowMarkerConfigModal(false);
                    openPath(filePath);
                  }}
                >
                  重新扫描
                </button>
              )}
              <button
                type="button"
                className="marker-config-btn secondary"
                onClick={() => setMarkerRuleConfig(DEFAULT_MARKER_RULE_CONFIG)}
              >
                恢复默认
              </button>
              <button
                type="button"
                className="marker-config-btn primary"
                onClick={() => setShowMarkerConfigModal(false)}
              >
                关闭
              </button>
            </div>
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
  return Math.max(1, totalLines + BOTTOM_PADDING_ROWS - viewportLineCount + 1);
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

function drawSelectedMarkerRing(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  context.save();
  context.strokeStyle = "#f8f0c9";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
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

function getSearchMatchKey(match: LogSearchMatch) {
  return `${match.lineNumber}:${match.startColumn}:${match.endColumn}`;
}

function navigateCachedSearch(
  result: LogSearchResult,
  direction: "next" | "previous",
  activeMatch: LogSearchMatch | null,
  firstVisibleLine: number,
  lastVisibleLine: number,
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
    const anchorLine = direction === "next" ? firstVisibleLine : lastVisibleLine;
    nextIndex =
      direction === "next"
        ? result.matches.findIndex((match) => match.lineNumber >= anchorLine)
        : findLastIndex(result.matches, (match) => match.lineNumber <= anchorLine);
    if (nextIndex === -1) {
      if (!wrapAround) {
        return {
          ...result,
          direction,
          wrapped: false,
        };
      }
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
          className={`log-token token-${token.kind}${piece.searchMatched ? " search-hit" : ""}${piece.searchMatched && activeLine ? " is-active" : ""
            }${piece.selectedWordMatched ? " selected-word-hit" : ""}`}
          key={`${tokenIndex}-${pieceIndex}-${piece.start}`}
          data-search-start={piece.searchMatched ? piece.matchStart : undefined}
          data-search-end={piece.searchMatched ? piece.matchEnd : undefined}
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
    matchStart: number | null;
    matchEnd: number | null;
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
      matchStart: getContainingRangeEdge(searchRanges, start, end, "start"),
      matchEnd: getContainingRangeEdge(searchRanges, start, end, "end"),
    });
  }

  return pieces.length > 0
    ? pieces
    : [{
      text: tokenText,
      searchMatched: false,
      selectedWordMatched: false,
      start: tokenStart,
      matchStart: null,
      matchEnd: null,
    }];
}

function rangeContains(ranges: Array<{ start: number; end: number }>, start: number, end: number) {
  return ranges.some((range) => range.start <= start && range.end >= end);
}

function getContainingRangeEdge(
  ranges: Array<{ start: number; end: number }>,
  start: number,
  end: number,
  edge: "start" | "end",
) {
  const range = ranges.find((item) => item.start <= start && item.end >= end);
  if (!range) {
    return null;
  }
  return edge === "start" ? range.start : range.end;
}

function generateMarkerRuleDoc(config: MarkerRuleConfig): string {
  const lines: string[] = [
    "# Log Scope 标记规则文档",
    "",
    "## 1. 消息块 (Message Blocks)",
    `- 启用: ${config.ruleEnabled.message_blocks ? "是" : "否"}`,
    "- Kind: `message`",
    "- 检测: `HH:MM:SS\\t=== Send/Receive Message ([id]) name ===`",
    "- 颜色: 根据 message_id 哈希自动计算 HSL",
    "- 多行: 持续到 `====...` 分隔线或下一个消息头",
    "",
    "## 2. 堆栈跟踪 (Stack Trace)",
    `- 启用: ${config.ruleEnabled.error_stack ? "是" : "否"}`,
    "- Kind: `error_stack`",
    `- 颜色: \`${config.kindColors.error_stack}\``,
    "- 检测: 行内容为 `stack traceback:`",
    "- 延续模式:",
    ...config.stackTracePatterns.map((p) => `  - \`${p}\``),
    "",
    "## 3. JSON 事件 (JSON Events)",
    `- 启用: ${config.ruleEnabled.json_event ? "是" : "否"}`,
    "- Kind: `json_event`",
    `- 颜色: \`${config.kindColors.json_event}\``,
    "- 检测: `HH:MM:SS\\t{...}` 有效 JSON",
    "- 标题: 从 `event_name` 字段提取",
    "",
    "## 4. 状态变更 (ChangeState)",
    `- 启用: ${config.ruleEnabled.state_change ? "是" : "否"}`,
    "- Kind: `state_change`",
    `- 颜色: \`${config.kindColors.state_change}\``,
    "- 检测: 时间戳行以 `ChangeState` 开头",
    "- 多行: 若含 `{` 但不以 `}` 结尾，持续到 `}`",
    "",
    "## 5. 关键字标记 (Keyword Markers)",
    `- 启用: ${config.ruleEnabled.keyword ? "是" : "否"}`,
    "- Kind: `keyword`",
    `- 错误类 (${config.kindColors.keyword_error}): ${config.keywordRules.error.map((k) => `\`${k}\``).join(", ")}`,
    `- 警告类 (${config.kindColors.keyword_warning}): ${config.keywordRules.warning.map((k) => `\`${k}\``).join(", ")}`,
    "- 仅对带时间戳的行生效",
    "",
    "## 6. 行严重级别着色 (Severity Coloring)",
    `- 成功: ${config.severityRules.success.map((k) => `\`${k}\``).join(", ")}`,
    `- 错误: ${config.severityRules.error.map((k) => `\`${k}\``).join(", ")}`,
    `- 警告: ${config.severityRules.warning.map((k) => `\`${k}\``).join(", ")}`,
    "",
    "## 扫描优先级",
    "1. 堆栈跟踪延续",
    "2. ChangeState 延续",
    "3. 消息头 (Send/Receive)",
    "4. 消息分隔线",
    "5. 消息体累积",
    "6. `stack traceback:` 开始",
    "7. JSON 事件",
    "8. `ChangeState` 开始",
    "9. 关键字匹配",
  ];
  return lines.join("\n");
}

function getMarkerDisplayColor(marker: LogMarker, config: MarkerRuleConfig): string {
  if (marker.kind === "error_stack") return config.kindColors.error_stack;
  if (marker.kind === "json_event") return config.kindColors.json_event;
  if (marker.kind === "state_change") return config.kindColors.state_change;
  if (marker.kind === "keyword") {
    if (marker.keywordClass === "error") {
      return config.kindColors.keyword_error;
    }
    if (marker.keywordClass === "warning") {
      return config.kindColors.keyword_warning;
    }
  }
  return marker.color;
}

function getSeverityClass(text: string | undefined, colorMode: "full" | "severity" | "off", severityRules?: MarkerRuleConfig["severityRules"]) {
  if (!text || colorMode === "off") {
    return "";
  }

  const rules = severityRules ?? DEFAULT_MARKER_RULE_CONFIG.severityRules;
  const lower = text.toLocaleLowerCase();
  if (rules.success.some((kw) => lower.includes(kw))) {
    return "severity-success";
  }
  if (rules.error.some((kw) => lower.includes(kw))) {
    return "severity-error";
  }
  if (rules.warning.some((kw) => lower.includes(kw))) {
    return "severity-warning";
  }
  return "";
}

document.addEventListener("contextmenu", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return;
  }
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
