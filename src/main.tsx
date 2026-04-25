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

function App() {
  const [health, setHealth] = React.useState<HealthCheck | null>(null);
  const [placeholder, setPlaceholder] = React.useState<FileOpenPlaceholder | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    invoke<HealthCheck>("health_check")
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)));
  }, []);

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
          <button type="button" className="primary-button" onClick={runPlaceholder}>
            打开文件占位
          </button>
          <button type="button" className="secondary-button" disabled>
            Socket 连接
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
          </dl>
        </section>
      </aside>

      <section className="viewer-area">
        <header className="viewer-toolbar">
          <div>
            <strong>{placeholder?.path ?? "尚未打开文件"}</strong>
            <span>{placeholder?.message ?? "阶段 0 骨架已连接 Rust command"}</span>
          </div>
        </header>

        <div className="viewer-layout">
          <div className="log-viewport" aria-label="log viewer placeholder">
            {Array.from({ length: 18 }, (_, index) => (
              <div className="log-row" key={index}>
                <span className="line-number">{index + 1}</span>
                <code>
                  {index === 0
                    ? "Rust core health_check -> frontend invoke OK"
                    : `stage_0.placeholder line=${index + 1} readonly=true`}
                </code>
              </div>
            ))}
          </div>

          <canvas className="minimap-placeholder" width="72" height="640" aria-label="minimap placeholder" />
        </div>

        {error ? <p className="error-message">{error}</p> : null}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
