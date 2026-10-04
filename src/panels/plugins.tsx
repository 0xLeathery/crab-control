import { useState } from "react";
import { MutationPreview, Plugin, PluginsDomain, Scope, api } from "../api";
import { Empty, Icon, LayerBadge } from "../ui";
import { PreviewConfirm } from "../editor";
import { Loading } from "./common";

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
            </div>
          );
        })
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
