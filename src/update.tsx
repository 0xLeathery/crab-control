// In-app auto-update: check GitHub releases, download + install a signed update,
// then relaunch. Uses the Tauri updater + process plugins.
import { useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Icon } from "./ui";

type State = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";

export function UpdateCard({ currentVersion }: { currentVersion: string }) {
  const [state, setState] = useState<State>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);

  const doCheck = async () => {
    setState("checking");
    setError(null);
    try {
      const u = await check();
      if (u) {
        setUpdate(u);
        setState("available");
      } else {
        setState("none");
      }
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  };

  const doInstall = async () => {
    if (!update) return;
    setState("downloading");
    setDownloaded(0);
    setTotal(0);
    try {
      let dl = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") setTotal(ev.data.contentLength ?? 0);
        else if (ev.event === "Progress") {
          dl += ev.data.chunkLength;
          setDownloaded(dl);
        } else if (ev.event === "Finished") setState("ready");
      });
      setState("ready");
      await relaunch();
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  };

  const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;

  return (
    <div className="card">
      <div className="card-body">
        <div className="info-grid" style={{ marginBottom: 10 }}>
          <div className="lab">Installed</div>
          <div className="val">v{currentVersion}</div>
        </div>

        {state === "none" && (
          <div className="okbar" style={{ marginBottom: 10 }}>
            <Icon name="dot" size={12} /> You're on the latest version.
          </div>
        )}
        {state === "available" && update && (
          <div className="card flat" style={{ marginBottom: 10 }}>
            <div className="card-body" style={{ padding: 0 }}>
              <div style={{ marginBottom: 6 }}>
                <span className="badge accent">v{update.version} available</span>
              </div>
              {update.body && (
                <pre className="preview" style={{ maxHeight: 160 }}>
                  {update.body}
                </pre>
              )}
            </div>
          </div>
        )}
        {(state === "downloading" || state === "ready") && (
          <div style={{ marginBottom: 10 }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
              {state === "ready"
                ? "Installed — relaunching…"
                : `Downloading… ${total > 0 ? `${pct}%` : `${(downloaded / 1024 / 1024).toFixed(1)} MB`}`}
            </div>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${state === "ready" ? 100 : pct}%` }} />
            </div>
          </div>
        )}
        {error && (
          <div className="warnbar" style={{ marginBottom: 10 }}>
            <Icon name="dot" size={12} /> {error}
          </div>
        )}

        <div className="toolbar" style={{ margin: 0 }}>
          {state === "available" ? (
            <button className="btn primary" onClick={doInstall}>
              Download &amp; install
            </button>
          ) : (
            <button
              className="btn"
              onClick={doCheck}
              disabled={state === "checking" || state === "downloading"}
            >
              {state === "checking" ? "Checking…" : "Check for updates"}
            </button>
          )}
          {state === "checking" && <span className="spin" />}
        </div>
      </div>
    </div>
  );
}
