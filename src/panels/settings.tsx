import { useState } from "react";
import { EffectiveSetting, Layer, LayerFile, MutationPreview, RawFile, SchemaResult, Scope, SettingsDomain, api } from "../api";
import { Empty, Icon, InlineValue, JsonView, LayerBadge } from "../ui";
import { PreviewConfirm, RawEditor } from "../editor";
import { defaultWriteLayer } from "../helpers";
import { Loading } from "./common";

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
