import { useState } from "react";
import { AppInfo, SchemaResult, Scope, api } from "../api";
import { Icon } from "../ui";
import { ImportModal } from "../import";
import { UpdateCard } from "../update";
import { fmtTime } from "../helpers";
import { Loading } from "./common";

/* ---------- Overview ---------- */

export function OverviewPanel({
  info,
  schema,
  counts,
  onRefreshSchema,
  schemaBusy,
  scope,
  onChanged,
}: {
  info: AppInfo | null;
  schema: SchemaResult | null;
  counts: Record<string, number | null>;
  onRefreshSchema: () => void;
  schemaBusy: boolean;
  scope: Scope;
  onChanged: () => void;
}) {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const doExport = async () => {
    setExportBusy(true);
    setExportError(null);
    setExportNote(null);
    try {
      const r = await api.exportSnapshot(scope);
      setExportNote(`Exported snapshot (${(r.bytes / 1024).toFixed(1)} KB) → ${r.displayPath}`);
    } catch (e) {
      setExportError(String(e));
    } finally {
      setExportBusy(false);
    }
  };

  if (!info) return <Loading label="Reading environment…" />;
  const schemaProps =
    schema?.schema && typeof schema.schema === "object"
      ? Object.keys((schema.schema as any).properties ?? {}).length
      : null;
  return (
    <div className="panel">
      <h1>Overview</h1>
      <div className="sub">
        Everything Claude Control discovered on this machine. Read-only.
      </div>

      <div className="section-title">Environment</div>
      <div className="card">
        <div className="card-body">
          <div className="info-grid">
            <div className="lab">claude CLI</div>
            <div className="val">
              {info.claudeFound ? (
                <>
                  {info.claudeVersion ?? "found"}{" "}
                  <span className="muted">· {info.claudePath}</span>
                </>
              ) : (
                <span style={{ color: "var(--warn)" }}>not found on PATH</span>
              )}
            </div>
            <div className="lab">Home</div>
            <div className="val">{info.home}</div>
            <div className="lab">Config dir</div>
            <div className="val">{info.claudeDir}</div>
            <div className="lab">Managed settings</div>
            <div className="val">
              {info.managedPresent ? (
                <span style={{ color: "var(--text)" }}>
                  present · {info.managedPath}{" "}
                  <span className="badge lock">
                    <Icon name="lock" size={11} /> read-only
                  </span>
                </span>
              ) : (
                <span className="muted">none ({info.managedPath})</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="section-title">Updates</div>
      <UpdateCard currentVersion={info.appVersion} />

      <div className="section-title">Settings schema</div>
      <div className="card">
        <div className="card-body">
          <div className="info-grid">
            <div className="lab">Source</div>
            <div className="val">{info.schemaUrl}</div>
            <div className="lab">State</div>
            <div className="val" style={{ fontFamily: "var(--font-ui)" }}>
              {schema ? (
                schema.schema ? (
                  <span className="badge ok">
                    {schema.fromCache ? "cached" : "fetched"}
                  </span>
                ) : (
                  <span className="badge error">unavailable</span>
                )
              ) : (
                <span className="muted">not loaded</span>
              )}{" "}
              {schemaProps != null && (
                <span className="muted">· {schemaProps} properties</span>
              )}{" "}
              {schema?.fetchedAtMs && (
                <span className="muted">· {fmtTime(schema.fetchedAtMs)}</span>
              )}
            </div>
          </div>
          {schema?.error && (
            <div className="warnbar" style={{ marginTop: 10 }}>
              <Icon name="dot" size={12} /> {schema.error}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={onRefreshSchema} disabled={schemaBusy}>
              {schemaBusy ? "Fetching…" : "Refresh schema"}
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">Inventory</div>
      <div className="chip-row">
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="badge muted" style={{ fontSize: 11.5 }}>
            {k}: {v == null ? "…" : v}
          </span>
        ))}
      </div>

      <div className="section-title">Snapshot</div>
      <div className="card">
        <div className="card-body">
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Export a read-only JSON snapshot of this scope's config (settings, plugins,
            agents/commands/skills, hooks). Secrets are masked, so it is a structural
            backup — not a credential export.
          </div>
          {exportNote && (
            <div className="okbar">
              <Icon name="dot" size={12} /> {exportNote}
            </div>
          )}
          {exportError && (
            <div className="warnbar">
              <Icon name="dot" size={12} /> {exportError}
            </div>
          )}
          <div className="toolbar" style={{ margin: 0 }}>
            <button className="btn primary" onClick={doExport} disabled={exportBusy}>
              {exportBusy ? "Exporting…" : "Export snapshot"}
            </button>
            <button className="btn" onClick={() => setImporting(true)}>
              Import snapshot…
            </button>
          </div>
        </div>
      </div>

      {importing && (
        <ImportModal
          scope={scope}
          onClose={() => setImporting(false)}
          onApplied={onChanged}
        />
      )}
    </div>
  );
}
