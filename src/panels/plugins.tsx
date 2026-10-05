import { useEffect, useState } from "react";
import { MutationPreview, Plugin, PluginAction, PluginsDomain, Scope, api } from "../api";
import { Empty, Icon, LayerBadge } from "../ui";
import { PreviewConfirm } from "../editor";
import { needsTrustWarning, pluginActionLabel } from "../helpers";
import { Loading } from "./common";

/**
 * Confirm a `claude plugin …` command: shows exactly what will run (masked)
 * and, for anything that fetches code, a trust warning. Install and add
 * marketplace take their target and scope here.
 */
function PluginActionModal({
  scope,
  initial,
  onCancel,
  onDone,
}: {
  scope: Scope;
  initial: PluginAction;
  onCancel: () => void;
  onDone: (msg: string) => void;
}) {
  const [action, setAction] = useState(initial);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = initial.action === "install" || initial.action === "marketplace-add";

  useEffect(() => {
    let live = true;
    api
      .pluginActionPreview(scope, action)
      .then((c) => live && (setCommand(c), setError(null)))
      .catch((e) => live && (setCommand(""), setError(String(e))));
    return () => {
      live = false;
    };
  }, [scope, action]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.pluginActionRun(scope, action));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = pluginActionLabel(action.action);
  return (
    <div className="modal-scrim" onClick={() => !busy && onCancel()}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{editable ? label : `${label} ${action.target || "all marketplaces"}`}</strong>
          <span className="muted mono" style={{ fontSize: 11 }}>
            claude plugin
          </span>
        </div>
        <div className="form">
          {editable && (
            <div className="frow">
              <label className="fld">
                <span>{action.action === "install" ? "Plugin (name@marketplace)" : "Source"}</span>
                <input
                  className="finput mono"
                  autoFocus
                  value={action.target}
                  placeholder={action.action === "install" ? "formatter@my-marketplace" : "owner/repo"}
                  onChange={(e) => setAction({ ...action, target: e.target.value })}
                />
              </label>
              <label className="fld" style={{ maxWidth: 130 }}>
                <span>Scope</span>
                <select
                  className="select"
                  value={action.scope ?? "user"}
                  onChange={(e) => setAction({ ...action, scope: e.target.value })}
                >
                  <option value="user">user</option>
                  <option value="project">project</option>
                  <option value="local">local</option>
                </select>
              </label>
            </div>
          )}
          <div className="fhint">Command</div>
          <pre className="preview">{command || "—"}</pre>
          {needsTrustWarning(action.action) && (
            <div className="warnbar">
              <Icon name="dot" size={12} /> Plugins can run hooks, MCP servers and commands with
              your permissions. Only {action.action === "marketplace-add" ? "add marketplaces" : "install plugins"}{" "}
              you trust.
            </div>
          )}
        </div>
        {error && (
          <div className="warnbar" style={{ margin: "0 16px 10px" }}>
            <Icon name="dot" size={12} /> {error}
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${action.action.endsWith("remove") || action.action === "uninstall" ? "danger" : "primary"}`}
            onClick={run}
            disabled={busy || !command}
          >
            {busy ? "Running…" : label}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Plugins ---------- */

export function PluginsPanel({
  data,
  filter,
  scope,
  onReload,
}: {
  data: PluginsDomain | null;
  filter: string;
  scope: Scope;
  onReload: () => void;
}) {
  const [preview, setPreview] = useState<MutationPreview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cli, setCli] = useState<PluginAction | null>(null);
  const defaultScope = scope.kind === "project" ? "project" : "user";

  if (!data) return <Loading label="Reading plugins…" />;
  const f = filter.trim().toLowerCase();
  const plugins = data.plugins.filter((p) => !f || p.fullId.toLowerCase().includes(f));
  const markets = data.marketplaces.filter((m) => !f || m.id.toLowerCase().includes(f));

  const startToggle = async (p: Plugin) => {
    setError(null);
    const target = p.enabled === false; // currently disabled → enable, else disable
    try {
      setPreview(await api.previewPluginToggle(scope, p.fullId, target));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="panel">
      <h1>Plugins &amp; Marketplaces</h1>
      <div className="sub">Installed plugins and the marketplaces they came from.</div>

      {note && (
        <div className="okbar">
          <Icon name="dot" size={12} /> {note}
        </div>
      )}
      {error && (
        <div className="warnbar">
          <Icon name="dot" size={12} /> {error}
        </div>
      )}

      <div className="toolbar">
        <button
          className="btn primary"
          onClick={() => setCli({ action: "install", target: "", scope: defaultScope })}
        >
          <Icon name="plugins" size={13} /> &nbsp;Install plugin…
        </button>
        <button
          className="btn"
          onClick={() => setCli({ action: "marketplace-add", target: "", scope: defaultScope })}
        >
          Add marketplace…
        </button>
      </div>

      <div className="section-title">Plugins ({data.plugins.length})</div>
      {plugins.length === 0 ? (
        <Empty>No plugins{f ? " match" : " installed"}.</Empty>
      ) : (
        plugins.map((p) => {
          const enabled = p.enabled !== false; // default = enabled
          return (
            <div className="row" key={p.fullId}>
              <div className="grow">
                <div className="nm">
                  {p.name}
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    @{p.marketplace}
                  </span>
                  {p.version && <span className="badge muted">v{p.version}</span>}
                  {p.scope && <span className="badge layer">{p.scope}</span>}
                </div>
                {p.displayInstallPath && (
                  <div className="path">{p.displayInstallPath}</div>
                )}
              </div>
              {p.enabledSource && <LayerBadge layer={p.enabledSource} />}
              <button
                className={`toggle ${enabled ? "on" : ""}`}
                title={enabled ? "Disable plugin" : "Enable plugin"}
                onClick={() => startToggle(p)}
              >
                <span className="knob" />
                <span className="tlabel">{enabled ? "enabled" : "disabled"}</span>
              </button>
              <button
                className="btn"
                onClick={() => setCli({ action: "update", target: p.fullId, scope: p.scope })}
              >
                Update
              </button>
              <button
                className="btn danger-outline"
                onClick={() => setCli({ action: "uninstall", target: p.fullId, scope: p.scope })}
              >
                Uninstall…
              </button>
            </div>
          );
        })
      )}

      <div className="section-title">Marketplaces ({data.marketplaces.length})</div>
      {markets.length === 0 ? (
        <Empty>No marketplaces{f ? " match" : " configured"}.</Empty>
      ) : (
        markets.map((m) => {
          const src = m.source as any;
          const repo = src?.repo ?? src?.source ?? "";
          return (
            <div className="row" key={m.id}>
              <div className="grow">
                <div className="nm">
                  {m.id}
                  {m.autoUpdate && <span className="badge accent">auto-update</span>}
                </div>
                {repo && <div className="path">{String(repo)}</div>}
                {m.displayInstallLocation && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {m.displayInstallLocation}
                  </div>
                )}
              </div>
              <button
                className="btn"
                onClick={() => setCli({ action: "marketplace-update", target: m.id })}
              >
                Update
              </button>
              <button
                className="btn danger-outline"
                onClick={() => setCli({ action: "marketplace-remove", target: m.id })}
              >
                Remove…
              </button>
            </div>
          );
        })
      )}

      {cli && (
        <PluginActionModal
          scope={scope}
          initial={cli}
          onCancel={() => setCli(null)}
          onDone={(msg) => {
            setCli(null);
            setNote(msg);
            onReload();
            setTimeout(() => setNote(null), 8000);
          }}
        />
      )}

      {preview && (
        <PreviewConfirm
          scope={scope}
          preview={preview}
          onCancel={() => setPreview(null)}
          onDone={(backup) => {
            setPreview(null);
            setNote(backup ? `Saved. Backup: ${backup}` : "Saved.");
            onReload();
            setTimeout(() => setNote(null), 6000);
          }}
        />
      )}
    </div>
  );
}
