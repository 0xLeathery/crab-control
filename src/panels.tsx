import { useState } from "react";
import {
  AppInfo,
  EffectiveSetting,
  HookEntry,
  Item,
  Layer,
  LayerFile,
  McpServer,
  MutationPreview,
  Plugin,
  PluginsDomain,
  RawFile,
  SchemaResult,
  Scope,
  SettingsDomain,
  api,
} from "./api";
import { Empty, Icon, InlineValue, JsonView, LayerBadge } from "./ui";
import { ConfirmModal, PreviewConfirm, RawEditor } from "./editor";
import { AddMcpModal, NewItemModal } from "./create";
import { ImportModal } from "./import";
import { UpdateCard } from "./update";
import { defaultWriteLayer, fmtTime, mcpScopeFlag, statusClass } from "./helpers";


/* ---------- small helpers ---------- */

function Loading({ label }: { label: string }) {
  return (
    <div className="empty">
      <span className="spin" /> &nbsp;{label}
    </div>
  );
}


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

/* ---------- Settings ---------- */

function FileCard({
  file,
  scope,
  onChanged,
}: {
  file: LayerFile;
  scope: Scope;
  onChanged: (backup?: string | null) => void;
}) {
  const [open, setOpen] = useState(file.present && !file.error);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState<RawFile | null>(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const editable = !file.readOnly;

  const startEdit = async () => {
    setLoadingRaw(true);
    try {
      const r = await api.readRawSettings(scope, file.layer);
      if (!r.exists && r.text.trim() === "") r.text = "{\n}\n";
      setRaw(r);
      setEditing(true);
      setOpen(true);
    } finally {
      setLoadingRaw(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head" onClick={() => setOpen((o) => !o)}>
        <span
          style={{
            display: "inline-flex",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform .12s",
            color: "var(--text-faint)",
          }}
        >
          <Icon name="chevron" size={14} />
        </span>
        <span className="title">{file.label}</span>
        {file.readOnly && (
          <span className="badge lock">
            <Icon name="lock" size={11} /> read-only
          </span>
        )}
        {!file.present ? (
          <span className="badge muted">not present</span>
        ) : file.error ? (
          <span className="badge error">parse error</span>
        ) : (
          <span className="badge ok">present</span>
        )}
        <span className="spacer" />
        {editable && (
          <button
            className="btn"
            onClick={(e) => {
              e.stopPropagation();
              if (editing) setEditing(false);
              else startEdit();
            }}
            disabled={loadingRaw}
          >
            {loadingRaw ? "…" : editing ? "View" : file.present ? "Edit" : "Create"}
          </button>
        )}
        <span className="meta">{file.displayPath}</span>
      </div>
      {open && (
        <div className="card-body">
          {editing && raw ? (
            <RawEditor
              scope={scope}
              layer={file.layer}
              initial={raw}
              onClose={() => setEditing(false)}
              onSaved={(backup) => {
                setEditing(false);
                onChanged(backup);
              }}
            />
          ) : file.error ? (
            <div className="warnbar">
              <Icon name="dot" size={12} /> {file.error}
            </div>
          ) : !file.present ? (
            <div className="muted">
              This file does not exist.{editable && " Use Create to add it."}
            </div>
          ) : (
            <JsonView value={file.content} />
          )}
        </div>
      )}
    </div>
  );
}

function EffectiveRow({ s }: { s: EffectiveSetting }) {
  return (
    <div className="eff-row">
      <div className="eff-key">{s.key}</div>
      <div style={{ minWidth: 0 }}>
        <InlineValue value={s.value} />
        {s.overridden.length > 0 && (
          <div className="eff-overrides">
            {s.overridden.map((o, i) => (
              <div className="ov" key={i}>
                <LayerBadge layer={o.layer} />
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {JSON.stringify(o.value).slice(0, 90)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <LayerBadge layer={s.source} />
    </div>
  );
}

export function SettingsPanel({
  data,
  filter,
  scope,
  schema,
  onReload,
}: {
  data: SettingsDomain | null;
  filter: string;
  scope: Scope;
  schema: SchemaResult | null;
  onReload: () => void;
}) {
  const [view, setView] = useState<"effective" | "schema" | "files">("effective");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [editPreview, setEditPreview] = useState<MutationPreview | null>(null);
  if (!data) return <Loading label="Reading settings layers…" />;

  const handleChanged = (backup?: string | null) => {
    setSavedNote(backup ? `Saved. Backup: ${backup}` : "Saved.");
    onReload();
    setTimeout(() => setSavedNote(null), 6000);
  };

  const f = filter.trim().toLowerCase();
  const eff = f
    ? data.effective.filter(
        (s) =>
          s.key.toLowerCase().includes(f) ||
          JSON.stringify(s.value).toLowerCase().includes(f)
      )
    : data.effective;

  return (
    <div className="panel">
      <h1>Settings</h1>
      <div className="sub">
        Merged from all layers, lowest → highest precedence. Secrets are masked.
      </div>

      <div className="toolbar">
        <div className="seg">
          <button
            className={view === "effective" ? "on" : ""}
            onClick={() => setView("effective")}
          >
            Effective
          </button>
          <button
            className={view === "schema" ? "on" : ""}
            onClick={() => setView("schema")}
          >
            By schema
          </button>
          <button
            className={view === "files" ? "on" : ""}
            onClick={() => setView("files")}
          >
            Files ({data.files.filter((x) => x.present).length}/{data.files.length})
          </button>
        </div>
        {view === "schema" && !schema?.schema && (
          <span className="muted" style={{ fontSize: 11.5 }}>
            Schema unavailable — showing keys without descriptions.
          </span>
        )}
      </div>

      {savedNote && (
        <div className="okbar">
          <Icon name="dot" size={12} /> {savedNote}
        </div>
      )}

      {view === "effective" ? (
        eff.length === 0 ? (
          <Empty>No settings{f ? " match the filter" : " found"}.</Empty>
        ) : (
          <div className="eff">
            {eff.map((s) => (
              <EffectiveRow key={s.key} s={s} />
            ))}
          </div>
        )
      ) : view === "schema" ? (
        <SchemaView
          settings={eff}
          schema={schema}
          scope={scope}
          onEdit={setEditPreview}
        />
      ) : (
        data.files.map((file) => (
          <FileCard key={file.layer} file={file} scope={scope} onChanged={handleChanged} />
        ))
      )}

      {editPreview && (
        <PreviewConfirm
          scope={scope}
          preview={editPreview}
          onCancel={() => setEditPreview(null)}
          onDone={(backup) => {
            setEditPreview(null);
            handleChanged(backup);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Schema-driven settings view ---------- */

const DOMAIN_MAP: Record<string, string> = {
  permissions: "Permissions",
  env: "Environment",
  httpHookAllowedEnvVars: "Environment",
  apiKeyHelper: "Environment",
  awsCredentialExport: "Environment",
  awsAuthRefresh: "Environment",
  model: "Model",
  availableModels: "Model",
  modelOverrides: "Model",
  effortLevel: "Model",
  fastMode: "Model",
  fastModePerSessionOptIn: "Model",
  hooks: "Hooks",
  disableAllHooks: "Hooks",
  allowedHttpHookUrls: "Hooks",
  allowManagedHooksOnly: "Hooks",
  statusLine: "Status line & UI",
  theme: "Status line & UI",
  language: "Status line & UI",
  fileSuggestion: "Status line & UI",
  enabledPlugins: "Plugins & marketplaces",
  extraKnownMarketplaces: "Plugins & marketplaces",
  strictKnownMarketplaces: "Plugins & marketplaces",
  allowedChannelPlugins: "Plugins & marketplaces",
  enableAllProjectMcpServers: "MCP",
  enabledMcpjsonServers: "MCP",
  disabledMcpjsonServers: "MCP",
  allowedMcpServers: "MCP",
  deniedMcpServers: "MCP",
  autoUpdates: "Updates & cleanup",
  autoUpdatesChannel: "Updates & cleanup",
  cleanupPeriodDays: "Updates & cleanup",
  autoMemoryEnabled: "Updates & cleanup",
  feedbackSurveyRate: "Updates & cleanup",
  includeCoAuthoredBy: "Git & attribution",
  attribution: "Git & attribution",
  includeGitInstructions: "Git & attribution",
  respectGitignore: "Git & attribution",
  claudeMdExcludes: "Git & attribution",
  plansDirectory: "Git & attribution",
};

const DOMAIN_ORDER = [
  "Permissions",
  "Model",
  "Environment",
  "Hooks",
  "MCP",
  "Plugins & marketplaces",
  "Status line & UI",
  "Git & attribution",
  "Updates & cleanup",
  "Other",
];

function domainOf(key: string): string {
  return DOMAIN_MAP[key] ?? "Other";
}

function schemaProps(schema: SchemaResult | null): Record<string, any> {
  const s: any = schema?.schema;
  return (s && typeof s === "object" && s.properties) || {};
}

function SchemaView({
  settings,
  schema,
  scope,
  onEdit,
}: {
  settings: EffectiveSetting[];
  schema: SchemaResult | null;
  scope: Scope;
  onEdit: (p: MutationPreview) => void;
}) {
  const props = schemaProps(schema);

  const groups = new Map<string, EffectiveSetting[]>();
  for (const s of settings) {
    const d = domainOf(s.key);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(s);
  }
  const orderedDomains = DOMAIN_ORDER.filter((d) => groups.has(d));

  const writeLayer = (s: EffectiveSetting): Layer =>
    s.source === "managed" ? defaultWriteLayer(scope) : s.source;

  const edit = async (
    s: EffectiveSetting,
    value: unknown
  ): Promise<void> => {
    try {
      onEdit(await api.previewSetSetting(scope, writeLayer(s), [s.key], value));
    } catch {
      /* surfaced by panel on save */
    }
  };

  if (settings.length === 0) return <Empty>No settings to show.</Empty>;

  return (
    <>
      {orderedDomains.map((domain) => (
        <div key={domain}>
          <div className="section-title">{domain}</div>
          {groups.get(domain)!.map((s) => {
            const prop = props[s.key];
            const desc: string | undefined = prop?.description;
            const enumVals: unknown[] | undefined = prop?.enum;
            const locked = s.source === "managed";
            const isBool = typeof s.value === "boolean";
            return (
              <div className="srow" key={s.key}>
                <div className="grow">
                  <div className="srow-key">
                    {s.key}
                    <LayerBadge layer={s.source} />
                    {locked && (
                      <span className="badge lock">
                        <Icon name="lock" size={11} /> locked
                      </span>
                    )}
                  </div>
                  {desc && <div className="srow-desc">{desc}</div>}
                </div>
                <div className="srow-control">
                  {locked ? (
                    <span className="eff-val">{JSON.stringify(s.value)}</span>
                  ) : isBool ? (
                    <button
                      className={`toggle ${s.value ? "on" : ""}`}
                      onClick={() => edit(s, !s.value)}
                    >
                      <span className="knob" />
                      <span className="tlabel">{s.value ? "on" : "off"}</span>
                    </button>
                  ) : enumVals && enumVals.length ? (
                    <select
                      className="select"
                      value={String(s.value)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const match = enumVals.find((v) => String(v) === raw);
                        edit(s, match ?? raw);
                      }}
                    >
                      {enumVals.map((v) => (
                        <option key={String(v)} value={String(v)}>
                          {String(v)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="eff-val" title="Edit complex values in Files view">
                      {(() => {
                        const t = JSON.stringify(s.value);
                        return t.length > 60 ? t.slice(0, 60) + "…" : t;
                      })()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>
        Booleans and enumerated values are editable here. Use the Files view to edit
        objects, arrays, and other structured values as raw JSON.
      </div>
    </>
  );
}

/* ---------- MCP ---------- */



export function McpPanel({
  servers,
  busy,
  onReload,
  filter,
  scope,
}: {
  servers: McpServer[] | null;
  busy: boolean;
  onReload: () => void;
  filter: string;
  scope: Scope;
}) {
  const [removeTarget, setRemoveTarget] = useState<McpServer | null>(null);
  const [togglePreview, setTogglePreview] = useState<MutationPreview | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const f = filter.trim().toLowerCase();
  const list = (servers ?? []).filter(
    (s) =>
      !f ||
      s.name.toLowerCase().includes(f) ||
      (s.target ?? "").toLowerCase().includes(f) ||
      s.scope.toLowerCase().includes(f)
  );

  const doRemove = async () => {
    if (!removeTarget) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const out = await api.mcpRemove(removeTarget.name, mcpScopeFlag(removeTarget));
      setRemoveTarget(null);
      setNote(out || `Removed ${removeTarget.name}.`);
      onReload();
      setTimeout(() => setNote(null), 8000);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const startToggle = async (s: McpServer, enabled: boolean) => {
    setActionError(null);
    try {
      setTogglePreview(await api.previewMcpToggle(scope, s.name, enabled));
    } catch (e) {
      setActionError(String(e));
    }
  };

  return (
    <div className="panel">
      <h1>MCP Servers</h1>
      <div className="sub">
        Live state from the <span className="mono">claude</span> CLI, merged with
        file-defined servers. Tokens in URLs are masked.
      </div>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Icon name="mcp" size={13} /> &nbsp;Add server
        </button>
        <button className="btn" onClick={onReload} disabled={busy}>
          {busy ? "Checking…" : "Reload"}
        </button>
        {busy && <span className="spin" />}
      </div>

      {note && (
        <div className="okbar">
          <Icon name="dot" size={12} /> {note}
        </div>
      )}
      {actionError && (
        <div className="warnbar">
          <Icon name="dot" size={12} /> {actionError}
        </div>
      )}

      {servers === null && busy ? (
        <Loading label="Querying claude mcp list…" />
      ) : list.length === 0 ? (
        <Empty>
          {servers === null
            ? "Could not query MCP servers."
            : f
            ? "No servers match the filter."
            : "No MCP servers configured."}
        </Empty>
      ) : (
        list.map((s) => {
          const isProjectMcp =
            s.scope.toLowerCase().includes("project") ||
            s.source.toLowerCase().includes(".mcp.json");
          const isClaudeAi = mcpScopeFlag(s) === "claudeai";
          return (
            <div className="row" key={s.name + s.source}>
              <div className="grow">
                <div className="nm">
                  {s.name}
                  <span className="badge accent">{s.transport}</span>
                  {s.scope && s.scope !== "unknown" && (
                    <span className="badge layer">{s.scope}</span>
                  )}
                </div>
                {s.target && <div className="path">{s.target}</div>}
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {s.source}
                </div>
              </div>
              {s.status && (
                <span className={`badge ${statusClass(s.status)}`}>{s.status}</span>
              )}
              {isProjectMcp && (
                <>
                  <button className="btn" onClick={() => startToggle(s, true)}>
                    Enable
                  </button>
                  <button className="btn" onClick={() => startToggle(s, false)}>
                    Disable
                  </button>
                </>
              )}
              {isClaudeAi ? (
                <span
                  className="badge muted"
                  title="Provided by your connected claude.ai account — remove it in claude.ai or via Claude Code's /mcp menu"
                >
                  claude.ai managed
                </span>
              ) : (
                <button
                  className="btn danger-outline"
                  onClick={() => setRemoveTarget(s)}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })
      )}

      {removeTarget && (
        <ConfirmModal
          title="Remove MCP server"
          danger
          confirmLabel="Remove server"
          busy={actionBusy}
          error={actionError}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={doRemove}
          body={
            <>
              Remove <strong>{removeTarget.name}</strong> via{" "}
              <span className="mono">claude mcp remove</span> (scope{" "}
              <span className="mono">{mcpScopeFlag(removeTarget)}</span>)? This runs the
              CLI and cannot be undone from here.
            </>
          }
        />
      )}

      {togglePreview && (
        <PreviewConfirm
          scope={scope}
          preview={togglePreview}
          onCancel={() => setTogglePreview(null)}
          onDone={(backup) => {
            setTogglePreview(null);
            setNote(backup ? `Saved. Backup: ${backup}` : "Saved.");
            onReload();
            setTimeout(() => setNote(null), 6000);
          }}
        />
      )}

      {adding && (
        <AddMcpModal
          scope={scope}
          onClose={() => setAdding(false)}
          onAdded={(msg) => {
            setAdding(false);
            setNote(msg);
            onReload();
            setTimeout(() => setNote(null), 8000);
          }}
        />
      )}
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

/* ---------- Items (agents / commands / skills) ---------- */

function ItemRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="grow">
          <div className="nm">
            {item.name}
            <span className="badge layer">{item.source}</span>
          </div>
          {item.description && <div className="desc">{item.description}</div>}
          <div className="path">{item.displayPath}</div>
        </div>
        {item.preview && (
          <button className="btn" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Preview"}
          </button>
        )}
      </div>
      {open && item.preview && (
        <pre className="preview" style={{ marginTop: 10 }}>
          {item.preview}
        </pre>
      )}
    </div>
  );
}

export function ItemsPanel({
  title,
  subtitle,
  items,
  filter,
  scope,
  kind,
  onReload,
}: {
  title: string;
  subtitle: string;
  items: Item[] | null;
  filter: string;
  scope: Scope;
  kind: "agent" | "command" | "skill";
  onReload: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const f = filter.trim().toLowerCase();
  const list = (items ?? []).filter(
    (i) =>
      !f ||
      i.name.toLowerCase().includes(f) ||
      (i.description ?? "").toLowerCase().includes(f) ||
      i.source.toLowerCase().includes(f)
  );
  const where = scope.kind === "project" ? "project" : "user";

  return (
    <div className="panel">
      <h1>{title}</h1>
      <div className="sub">{subtitle}</div>

      <div className="toolbar">
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="commands" size={13} /> &nbsp;New {kind} ({where})
        </button>
      </div>

      {note && (
        <div className="okbar">
          <Icon name="dot" size={12} /> {note}
        </div>
      )}

      {!items ? (
        <Loading label={`Reading ${title.toLowerCase()}…`} />
      ) : list.length === 0 ? (
        <Empty>
          No {title.toLowerCase()}
          {f ? " match the filter" : " found"}.
        </Empty>
      ) : (
        list.map((i) => <ItemRow key={i.path} item={i} />)
      )}

      {creating && (
        <NewItemModal
          scope={scope}
          kind={kind}
          onClose={() => setCreating(false)}
          onCreated={(path) => {
            setCreating(false);
            setNote(`Created ${path}`);
            onReload();
            setTimeout(() => setNote(null), 6000);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Hooks ---------- */

export function HooksPanel({
  hooks,
  filter,
}: {
  hooks: HookEntry[] | null;
  filter: string;
}) {
  if (!hooks) return <Loading label="Reading hooks…" />;
  const f = filter.trim().toLowerCase();
  const list = hooks.filter(
    (h) =>
      !f ||
      h.event.toLowerCase().includes(f) ||
      (h.command ?? "").toLowerCase().includes(f) ||
      (h.matcher ?? "").toLowerCase().includes(f)
  );
  return (
    <div className="panel">
      <h1>Hooks</h1>
      <div className="sub">Commands Claude Code runs on lifecycle events.</div>
      {list.length === 0 ? (
        <Empty>No hooks{f ? " match" : " configured"}.</Empty>
      ) : (
        list.map((h, i) => (
          <div className="row" key={i}>
            <div className="grow">
              <div className="nm">
                {h.event}
                {h.matcher && <span className="badge layer">{h.matcher}</span>}
                <span className="badge accent">{h.hookType}</span>
              </div>
              {h.command && <div className="path">{h.command}</div>}
            </div>
            <LayerBadge layer={h.source} />
          </div>
        ))
      )}
    </div>
  );
}
