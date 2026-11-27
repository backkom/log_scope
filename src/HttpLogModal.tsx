import React from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";

export type HttpServiceLogContext = {
  serverIp: string;
  serverPort: number;
  rid: string;
  rolename: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type HttpServiceLogItem = {
  id: number;
  uuid: string;
  project: string;
  package: string;
  platform: string;
  udid: string;
  fileName: string;
  fileSize: number;
  isProtected: boolean;
  contexts: HttpServiceLogContext[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type HttpServiceLogProject = {
  name: string;
  packages: string[];
};

export type HttpServiceLogListResponse = {
  items: HttpServiceLogItem[];
  total: number;
  limit: number;
  offset: number;
  order: string;
  projects: HttpServiceLogProject[];
  packages: string[];
};

type FilterValues = {
  rid: string;
  rolename: string;
  udid: string;
};

type HttpLogModalProps = {
  initialUrl: string;
  recentUrls: string[];
  isOpening: boolean;
  onClose: () => void;
  onSaveUrl: (url: string) => Promise<string>;
  onOpenLog: (item: HttpServiceLogItem, serverUrl: string) => Promise<boolean>;
};

const STORAGE_KEYS = {
  project: "logscope_http_log_project",
  packageName: "logscope_http_log_package",
  lastFilters: "logscope_http_log_last_filters",
  history: "logscope_http_log_history",
};

const MAX_HISTORY_ITEMS = 10;

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
}

function loadLastFilters(): FilterValues {
  const raw = safeStorageGet(STORAGE_KEYS.lastFilters);
  if (!raw) return { rid: "", rolename: "", udid: "" };
  try {
    const parsed = JSON.parse(raw) as Partial<FilterValues>;
    return {
      rid: typeof parsed.rid === "string" ? parsed.rid : "",
      rolename: typeof parsed.rolename === "string" ? parsed.rolename : "",
      udid: typeof parsed.udid === "string" ? parsed.udid : "",
    };
  } catch {
    return { rid: "", rolename: "", udid: "" };
  }
}

function loadHistory(): FilterValues[] {
  const raw = safeStorageGet(STORAGE_KEYS.history);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is FilterValues => Boolean(item && typeof item === "object"))
      .map((item) => ({
        rid: typeof item.rid === "string" ? item.rid.trim() : "",
        rolename: typeof item.rolename === "string" ? item.rolename.trim() : "",
        udid: typeof item.udid === "string" ? item.udid.trim() : "",
      }))
      .filter((item) => item.rid || item.rolename || item.udid)
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function formatUtcToCst(utcText: string | null): string {
  if (!utcText) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(utcText.trim());
  if (!match) return utcText;
  const ms =
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ) +
    8 * 3600 * 1000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function formatFileSize(bytes: number): string {
  let value = Math.max(0, Number(bytes) || 0);
  const units = ["B", "KB", "MB", "GB"];
  for (let i = 0; i < units.length; i += 1) {
    if (value < 1024 || i === units.length - 1) {
      return units[i] === "B" ? `${Math.trunc(value)} B` : `${value.toFixed(1)} ${units[i]}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function formatContextLabel(ctx: HttpServiceLogContext): string {
  const parts: string[] = [];
  if (ctx.rid) parts.push(`rid: ${ctx.rid}`);
  if (ctx.rolename) parts.push(`角色: ${ctx.rolename}`);
  if (ctx.serverIp || ctx.serverPort) {
    const portPart = ctx.serverPort ? `:${ctx.serverPort}` : "";
    parts.push(`${ctx.serverIp || ""}${portPart}`);
  }
  return parts.join(" | ");
}

function PlatformBadge({ platform }: { platform: string }) {
  const label = platform.trim();
  const key = label.toLowerCase();

  let icon: React.ReactNode;
  let isKnown = true;

  if (["editor", "unity", "unityeditor", "unity editor"].includes(key)) {
    icon = (
      <svg className="http-platform-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2.2 20.6 7.1v9.8L12 21.8 3.4 16.9V7.1L12 2.2Zm0 2.3L6.1 7.9 12 11.3l5.9-3.4L12 4.5Zm-6.6 5.2v6.1l5.6 3.2v-6.1L5.4 9.7Zm13.2 0-5.6 3.2V19l5.6-3.2V9.7Z"
        />
      </svg>
    );
  } else if (key === "android") {
    icon = (
      <svg className="http-platform-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#3fb950"
          d="M7.5 10.5h9a1 1 0 0 1 1 1v6.2a1.3 1.3 0 0 1-1.3 1.3H15v2.2a1 1 0 1 1-2 0V19h-2v2.2a1 1 0 1 1-2 0V19H7.8a1.3 1.3 0 0 1-1.3-1.3v-6.2a1 1 0 0 1 1-1Zm-3.1.8a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Zm15.2 0a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1ZM8.9 5.3 7.7 3.6a.5.5 0 1 1 .8-.6l1.3 1.8a5.8 5.8 0 0 1 4.4 0l1.3-1.8a.5.5 0 1 1 .8.6l-1.2 1.7A5.3 5.3 0 0 1 17.5 9.5h-11A5.3 5.3 0 0 1 8.9 5.3Zm1.2 2.4a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4Zm3.8 0a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4Z"
        />
      </svg>
    );
  } else if (["ios", "iphone", "ipad", "macos", "mac", "osx"].includes(key)) {
    icon = (
      <svg className="http-platform-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M16.4 12.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.6-1.3-.1-2.5.8-3.1.8s-1.6-.8-2.7-.7c-1.4 0-2.6.8-3.3 2-.1.2-1.5 2.7-.3 5.9.6 1.5 1.4 3.2 2.5 3.1 1 0 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1.5 2.4-3 .7-1.6 1-3.1 1-3.2-.1 0-2.5-1-2.5-3.1ZM14.3 6.3c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2Z"
        />
      </svg>
    );
  } else if (["windows", "win", "win32", "win64"].includes(key)) {
    icon = (
      <svg className="http-platform-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#38bdf8"
          d="M3 5.2 10.8 4v7.3H3V5.2Zm8.8-1.3L21 2.5v8.8h-9.2V3.9ZM3 12.3h7.8v7.4L3 18.5v-6.2Zm8.8 0H21v9l-9.2-1.4v-7.6Z"
        />
      </svg>
    );
  } else if (key === "linux") {
    icon = (
      <svg className="http-platform-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm3.3 3.7 3.5 3.3-3.5 3.3 1.4 1.4L13.6 12 8.7 7.3 7.3 8.7Zm5.7 6.8h4v-2h-4v2Z"
        />
      </svg>
    );
  } else if (["webgl", "web"].includes(key)) {
    icon = (
      <svg className="http-platform-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="1.8"
          d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.4 2.3 3.8 5.5 3.8 9s-1.4 6.7-3.8 9c-2.4-2.3-3.8-5.5-3.8-9S9.6 5.3 12 3Zm-8.5 6.2h17M3.5 14.8h17"
        />
      </svg>
    );
  } else {
    isKnown = false;
    icon = (
      <svg className="http-platform-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#94a3b8"
          d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4v2h2a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h2v-2H6a2 2 0 0 1-2-2V6Zm2 0v10h12V6H6Z"
        />
      </svg>
    );
  }

  return (
    <span className="http-platform-badge" title={label || "未知平台"} aria-label={label || "未知平台"}>
      {icon}
      {!isKnown && label ? <span className="http-platform-fallback">{label}</span> : null}
    </span>
  );
}

export function HttpLogModal({
  initialUrl,
  recentUrls,
  isOpening,
  onClose,
  onSaveUrl,
  onOpenLog,
}: HttpLogModalProps) {
  const initialFilters = React.useMemo(() => loadLastFilters(), []);
  const [urlInput, setUrlInput] = React.useState(initialUrl);
  const [activeServerUrl, setActiveServerUrl] = React.useState(initialUrl);
  const [projectFilter, setProjectFilter] = React.useState(() => safeStorageGet(STORAGE_KEYS.project) || "");
  const [packageFilter, setPackageFilter] = React.useState(() => safeStorageGet(STORAGE_KEYS.packageName) || "");
  const [ridFilter, setRidFilter] = React.useState(initialFilters.rid);
  const [rolenameFilter, setRolenameFilter] = React.useState(initialFilters.rolename);
  const [udidFilter, setUdidFilter] = React.useState(initialFilters.udid);
  const [filterHistory, setFilterHistory] = React.useState<FilterValues[]>(() => loadHistory());
  const [logList, setLogList] = React.useState<HttpServiceLogListResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [selectedLogId, setSelectedLogId] = React.useState<number | null>(null);
  const isFetchingRef = React.useRef(false);
  const fetchSeqRef = React.useRef(0);

  const hasActiveQueryCondition = Boolean(ridFilter.trim() || rolenameFilter.trim() || udidFilter.trim());

  const fetchLogs = React.useCallback(
    async (
      targetUrl: string,
      overrides?: {
        project?: string;
        packageName?: string;
        rid?: string;
        rolename?: string;
        udid?: string;
        recordHistory?: boolean;
      },
    ) => {
      const trimmedUrl = targetUrl.trim();
      if (!trimmedUrl) {
        setErrorText("请先输入日志服务器 URL");
        return;
      }
      const nextProject = overrides?.project ?? projectFilter;
      const nextPackage = overrides?.packageName ?? packageFilter;
      const nextFilters: FilterValues = {
        rid: (overrides?.rid ?? ridFilter).trim(),
        rolename: (overrides?.rolename ?? rolenameFilter).trim(),
        udid: (overrides?.udid ?? udidFilter).trim(),
      };
      safeStorageSet(STORAGE_KEYS.lastFilters, JSON.stringify(nextFilters));
      if (overrides?.recordHistory && (nextFilters.rid || nextFilters.rolename || nextFilters.udid)) {
        const key = `${nextFilters.rid}\0${nextFilters.rolename}\0${nextFilters.udid}`;
        setFilterHistory((prev) => {
          const next = [
            nextFilters,
            ...prev.filter((item) => `${item.rid}\0${item.rolename}\0${item.udid}` !== key),
          ].slice(0, MAX_HISTORY_ITEMS);
          safeStorageSet(STORAGE_KEYS.history, JSON.stringify(next));
          return next;
        });
      }

      const seq = ++fetchSeqRef.current;
      isFetchingRef.current = true;
      setIsLoading(true);
      setErrorText(null);
      try {
        const data = await invoke<HttpServiceLogListResponse>("fetch_http_service_logs", {
          serverUrl: trimmedUrl,
          project: nextProject || null,
          package: nextPackage || null,
          rid: nextFilters.rid || null,
          rolename: nextFilters.rolename || null,
          udid: nextFilters.udid || null,
          limit: 100,
        });
        if (seq !== fetchSeqRef.current) return;
        setLogList(data);
        setSelectedLogId((currentId) =>
          currentId !== null && data.items.some((item) => item.id === currentId)
            ? currentId
            : data.items[0]?.id ?? null,
        );
      } catch (err) {
        if (seq !== fetchSeqRef.current) return;
        setErrorText(String(err));
      } finally {
        if (seq === fetchSeqRef.current) {
          isFetchingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [packageFilter, projectFilter, ridFilter, rolenameFilter, udidFilter],
  );

  React.useEffect(() => {
    if (initialUrl.trim()) {
      void fetchLogs(initialUrl.trim());
    }
    // Run only once on modal open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!hasActiveQueryCondition || !activeServerUrl.trim()) {
      return;
    }
    const timer = window.setInterval(() => {
      if (!document.hidden && !isFetchingRef.current) {
        void fetchLogs(activeServerUrl);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeServerUrl, fetchLogs, hasActiveQueryCondition]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSaveAndFetch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setErrorText(null);
    try {
      const savedUrl = await onSaveUrl(urlInput);
      setUrlInput(savedUrl);
      setActiveServerUrl(savedUrl);
      await fetchLogs(savedUrl);
    } catch (err) {
      setErrorText(String(err));
    }
  };

  const configuredProjects = logList?.projects ?? [];
  const allPackages = logList?.packages ?? [];
  const activePackages = React.useMemo(() => {
    if (!projectFilter) return allPackages;
    const matched = configuredProjects.find((item) => item.name === projectFilter);
    return matched ? matched.packages : [];
  }, [allPackages, configuredProjects, projectFilter]);

  const packageToProjects = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const proj of configuredProjects) {
      for (const pkg of proj.packages) {
        const list = map.get(pkg) ?? [];
        list.push(proj.name);
        map.set(pkg, list);
      }
    }
    return map;
  }, [configuredProjects]);

  const items = logList?.items ?? [];
  const selectedItem = items.find((item) => item.id === selectedLogId) ?? null;

  const confirmOpenItem = React.useCallback(
    async (item: HttpServiceLogItem) => {
      const targetUrl = (activeServerUrl || urlInput).trim();
      if (!targetUrl) {
        setErrorText("请先设置日志服务器 URL");
        return;
      }
      const ok = await onOpenLog(item, targetUrl);
      if (ok) {
        onClose();
      }
    },
    [activeServerUrl, onClose, onOpenLog, urlInput],
  );

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-content http-log-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-left">
            <svg className="modal-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <h2>HTTP 日志服务器</h2>
          </div>
          <div className="http-modal-header-actions">
            {hasActiveQueryCondition && activeServerUrl ? (
              <span className="http-auto-refresh-pill">每 5 秒自动刷新中</span>
            ) : null}
            <button
              type="button"
              className="refresh-button"
              disabled={isLoading || !activeServerUrl.trim()}
              onClick={() => void fetchLogs(activeServerUrl || urlInput)}
              title="刷新日志列表"
            >
              ⟳
            </button>
            <button
              type="button"
              className="modal-close-button"
              onClick={onClose}
              title="关闭"
            >
              ×
            </button>
          </div>
        </div>

        <form className="http-server-url-bar" onSubmit={(e) => void handleSaveAndFetch(e)}>
          <label className="modal-field-inline http-url-field" htmlFor="http-server-url-input">
            <span>服务器</span>
            <input
              id="http-server-url-input"
              list="http-recent-servers"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="例如 http://127.0.0.1:7848"
              autoComplete="off"
              spellCheck={false}
            />
            {recentUrls.length > 0 && (
              <datalist id="http-recent-servers">
                {recentUrls.map((url) => (
                  <option key={url} value={url} />
                ))}
              </datalist>
            )}
          </label>
          <button
            type="submit"
            className="primary-button http-url-save-button"
            disabled={isLoading || !urlInput.trim()}
          >
            {isLoading ? "获取中…" : "保存并获取"}
          </button>
        </form>

        <div className="http-sub-tabs" role="tablist" aria-label="按 Project 过滤">
          <button
            type="button"
            role="tab"
            aria-selected={projectFilter === ""}
            className={`http-sub-tab${projectFilter === "" ? " is-active" : ""}`}
            onClick={() => {
              setProjectFilter("");
              safeStorageSet(STORAGE_KEYS.project, "");
              if (activeServerUrl.trim()) {
                void fetchLogs(activeServerUrl, { project: "" });
              }
            }}
          >
            全部
          </button>
          {configuredProjects.map((proj) => (
            <button
              key={proj.name}
              type="button"
              role="tab"
              aria-selected={projectFilter === proj.name}
              className={`http-sub-tab${projectFilter === proj.name ? " is-active" : ""}`}
              onClick={() => {
                const nextProj = proj.name;
                const nextPkg = proj.packages.includes(packageFilter) ? packageFilter : "";
                setProjectFilter(nextProj);
                setPackageFilter(nextPkg);
                safeStorageSet(STORAGE_KEYS.project, nextProj);
                safeStorageSet(STORAGE_KEYS.packageName, nextPkg);
                if (activeServerUrl.trim()) {
                  void fetchLogs(activeServerUrl, { project: nextProj, packageName: nextPkg });
                }
              }}
            >
              {proj.name}
            </button>
          ))}
        </div>

        <div className="http-tertiary-tabs" role="tablist" aria-label="按 Package 过滤">
          <span className="http-tertiary-label">Package：</span>
          <button
            type="button"
            role="tab"
            aria-selected={packageFilter === ""}
            className={`http-tertiary-tab${packageFilter === "" ? " is-active" : ""}`}
            onClick={() => {
              setPackageFilter("");
              safeStorageSet(STORAGE_KEYS.packageName, "");
              if (activeServerUrl.trim()) {
                void fetchLogs(activeServerUrl, { packageName: "" });
              }
            }}
          >
            全部
          </button>
          {activePackages.map((pkg) => (
            <button
              key={pkg}
              type="button"
              role="tab"
              aria-selected={packageFilter === pkg}
              className={`http-tertiary-tab${packageFilter === pkg ? " is-active" : ""}`}
              onClick={() => {
                setPackageFilter(pkg);
                safeStorageSet(STORAGE_KEYS.packageName, pkg);
                if (activeServerUrl.trim()) {
                  void fetchLogs(activeServerUrl, { packageName: pkg });
                }
              }}
            >
              {pkg}
            </button>
          ))}
        </div>

        <form
          className="http-filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (activeServerUrl.trim()) {
              void fetchLogs(activeServerUrl, { recordHistory: true });
            } else {
              void handleSaveAndFetch();
            }
          }}
        >
          <label className="http-filter-field">
            <span>RID</span>
            <input
              value={ridFilter}
              onChange={(event) => {
                const next = event.target.value;
                setRidFilter(next);
                safeStorageSet(STORAGE_KEYS.lastFilters, JSON.stringify({
                  rid: next.trim(),
                  rolename: rolenameFilter.trim(),
                  udid: udidFilter.trim(),
                }));
              }}
              placeholder="例如：10086"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="http-filter-field">
            <span>角色名 (rolename)</span>
            <input
              value={rolenameFilter}
              onChange={(event) => {
                const next = event.target.value;
                setRolenameFilter(next);
                safeStorageSet(STORAGE_KEYS.lastFilters, JSON.stringify({
                  rid: ridFilter.trim(),
                  rolename: next.trim(),
                  udid: udidFilter.trim(),
                }));
              }}
              placeholder="例如：Hero"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="http-filter-field">
            <span>UDID</span>
            <input
              value={udidFilter}
              onChange={(event) => {
                const next = event.target.value;
                setUdidFilter(next);
                safeStorageSet(STORAGE_KEYS.lastFilters, JSON.stringify({
                  rid: ridFilter.trim(),
                  rolename: rolenameFilter.trim(),
                  udid: next.trim(),
                }));
              }}
              placeholder="例如：device-001"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="http-filter-actions">
            <button type="submit" className="primary-button" disabled={isLoading}>
              查询
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setRidFilter("");
                setRolenameFilter("");
                setUdidFilter("");
                safeStorageSet(STORAGE_KEYS.lastFilters, JSON.stringify({ rid: "", rolename: "", udid: "" }));
                if (activeServerUrl.trim()) {
                  void fetchLogs(activeServerUrl, { rid: "", rolename: "", udid: "" });
                }
              }}
            >
              重置
            </button>
          </div>
        </form>

        {filterHistory.length > 0 && (
          <div className="http-filter-history">
            <span>历史条件：</span>
            <div className="http-history-chips">
              {filterHistory.map((item) => {
                const parts: string[] = [];
                if (item.rid) parts.push(`rid: ${item.rid}`);
                if (item.rolename) parts.push(`角色: ${item.rolename}`);
                if (item.udid) parts.push(`udid: ${item.udid}`);
                const label = parts.join(" | ");
                return (
                  <button
                    key={label}
                    type="button"
                    className="http-history-chip"
                    onClick={() => {
                      setRidFilter(item.rid);
                      setRolenameFilter(item.rolename);
                      setUdidFilter(item.udid);
                      if (activeServerUrl.trim()) {
                        void fetchLogs(activeServerUrl, {
                          rid: item.rid,
                          rolename: item.rolename,
                          udid: item.udid,
                          recordHistory: true,
                        });
                      }
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              <button
                type="button"
                className="http-history-clear"
                onClick={() => {
                  setFilterHistory([]);
                  safeStorageSet(STORAGE_KEYS.history, "[]");
                }}
              >
                清空历史
              </button>
            </div>
          </div>
        )}

        {errorText ? <div className="http-modal-error">{errorText}</div> : null}

        <div className="http-log-summary-row">
          <span>
            {logList
              ? `显示最近 ${items.length} 条（共 ${logList.total} 条匹配，最多显示 100 条）`
              : "输入并保存日志服务器 URL 后获取日志列表"}
          </span>
          {selectedItem ? (
            <span className="http-selected-summary">
              已选: #{selectedItem.id} · {selectedItem.fileName} ({formatFileSize(selectedItem.fileSize)})
            </span>
          ) : null}
        </div>

        <div className="http-log-table-wrap">
          {items.length > 0 ? (
            <table className="http-log-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>创建时间</th>
                  <th>Package / Project</th>
                  <th>平台</th>
                  <th>UDID</th>
                  <th>服务器 / 角色 (RID / rolename)</th>
                  <th>文件名 / 大小</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isSelected = item.id === selectedLogId;
                  const primaryPkg = item.package || item.project;
                  const projectLabel = item.package
                    ? item.project
                    : (packageToProjects.get(item.project) ?? []).join(", ");
                  return (
                    <tr
                      key={item.id}
                      className={isSelected ? "is-selected" : undefined}
                      onClick={() => setSelectedLogId(item.id)}
                      onDoubleClick={() => void confirmOpenItem(item)}
                    >
                      <td className="http-mono">{item.id}</td>
                      <td className="http-nowrap">{formatUtcToCst(item.createdAt)}</td>
                      <td>
                        <div className="http-mono">{primaryPkg || "-"}</div>
                        {projectLabel ? <div className="http-sub-meta">{projectLabel}</div> : null}
                      </td>
                      <td className="http-platform-cell">
                        <PlatformBadge platform={item.platform} />
                      </td>
                      <td className="http-mono">{item.udid}</td>
                      <td>
                        {item.contexts.length > 0 ? (
                          <div className="http-contexts">
                            {item.contexts.map((ctx, idx) => {
                              const label = formatContextLabel(ctx);
                              if (!label) return null;
                              return (
                                <span key={idx} className="http-context-chip">
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="http-sub-meta">-</span>
                        )}
                      </td>
                      <td>
                        <div className="http-mono">{item.fileName}</div>
                        <div className="http-sub-meta" title={`${item.fileSize} B`}>
                          {formatFileSize(item.fileSize)}
                        </div>
                      </td>
                      <td>
                        <span className={`http-status-pill ${item.isProtected ? "is-protected" : "is-normal"}`}>
                          {item.isProtected ? "已保护" : "普通"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="http-log-empty">
              {isLoading
                ? "正在从服务器获取日志列表…"
                : activeServerUrl.trim()
                  ? "暂无符合条件的服务日志。"
                  : "请输入日志服务器地址并点击「保存并获取」。"}
            </div>
          )}
        </div>

        <div className="http-modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!selectedItem || isOpening}
            onClick={() => {
              if (selectedItem) {
                void confirmOpenItem(selectedItem);
              }
            }}
          >
            {isOpening ? "打开中…" : "打开日志"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
