import { useState } from "react";
import {
  EffectiveSetting,
  LAYER_LABEL,
  Layer,
  LayerFile,
  MutationPreview,
  RawFile,
  SchemaResult,
  Scope,
  SettingsDomain,
  api,
} from "../api";
import { Empty, Icon, InlineValue, JsonView, LayerBadge } from "../ui";
import { PreviewConfirm, RawEditor } from "../editor";
import { defaultWriteLayer, editableLayers } from "../helpers";
import {
  ControlKind,
  SettingRow,
  controlKind,
  isMasked,
  parseInput,
  settingRows,
} from "../settings-edit";
import { Loading } from "./common";
import { HistoryModal } from "../history";

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
  const [history, setHistory] = useState(false);
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
        {editable && file.present && (
          <button
            className="btn"
            onClick={(e) => {
              e.stopPropagation();
              setHistory(true);
            }}
          >
            History
          </button>
        )}
        <span className="meta">{file.displayPath}</span>
      </div>
      {history && (
        <HistoryModal
          scope={scope}
          target={{ kind: "settings", layer: file.layer }}
          title={file.label}
          loadCurrent={async () => (await api.readRawSettings(scope, file.layer)).text}
          onClose={() => setHistory(false)}
          onRestored={(backup) => {
            setHistory(false);
            onChanged(backup);
          }}
        />
      )}
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
            Edit
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
          data={data}
          filter={filter}
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

function JsonEditModal({
  row,
  onCancel,
  onSubmit,
}: {
  row: SettingRow;
  onCancel: () => void;
  onSubmit: (value: unknown) => void;
}) {
  const initial = row.set
    ? JSON.stringify(row.value, null, 2)
    : row.prop?.type === "array"
      ? "[]"
      : "{}";
  const [text, setText] = useState(initial);
  const parsed = parseInput("json", text);
  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong className="mono">{row.key}</strong>
        </div>
        {row.prop?.description && (
          <div className="modal-sub" style={{ borderBottom: "none" }}>
            {row.prop.description}
          </div>
        )}
        <div style={{ padding: "0 16px" }}>
          <textarea
            className="code-area"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(20, Math.max(6, text.split("\n").length + 1))}
          />
          {!parsed.ok && <div className="fhint err">{parsed.error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!parsed.ok}
            onClick={() => parsed.ok && onSubmit(parsed.value)}
          >
            Preview change…
          </button>
        </div>
      </div>
    </div>
  );
}

function ValueInput({
  row,
  kind,
  onSubmit,
}: {
  row: SettingRow;
  kind: ControlKind;
  onSubmit: (value: unknown) => void;
}) {
  const current = row.set ? String(row.value) : "";
  const [draft, setDraft] = useState(current);
  const parsed = parseInput(kind, draft);
  const changed = draft !== current;
  return (
    <span className="inline-edit">
      <input
        className="finput mono"
        style={{ width: kind === "string" ? 220 : 110 }}
        value={draft}
        placeholder={row.set ? "" : "not set"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && changed && parsed.ok) onSubmit(parsed.value);
        }}
      />
      {changed && (
        <button
          className="btn primary"
          disabled={!parsed.ok}
          title={parsed.ok ? "" : parsed.error}
          onClick={() => parsed.ok && onSubmit(parsed.value)}
        >
          Save…
        </button>
      )}
    </span>
  );
}

function short(v: unknown): string {
  const t = JSON.stringify(v);
  return t.length > 60 ? t.slice(0, 60) + "…" : t;
}

function SchemaView({
  data,
  filter,
  schema,
  scope,
  onEdit,
}: {
  data: SettingsDomain;
  filter: string;
  schema: SchemaResult | null;
  scope: Scope;
  onEdit: (p: MutationPreview) => void;
}) {
  const props = schemaProps(schema);
  const layers = editableLayers(data.files);
  const [layer, setLayer] = useState<Layer>(defaultWriteLayer(scope));
  const [showUnset, setShowUnset] = useState(false);
  const [jsonRow, setJsonRow] = useState<SettingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = layers.includes(layer) ? layer : layers[0];

  const rows = settingRows(props, data.effective, { showUnset, filter });
  const unsetCount = Object.keys(props).filter(
    (k) => !data.effective.some((s) => s.key === k)
  ).length;

  const run = async (make: () => Promise<MutationPreview>) => {
    setError(null);
    try {
      onEdit(await make());
    } catch (e) {
      setError(String(e));
    }
  };
  const set = (key: string, value: unknown) =>
    target && run(() => api.previewSetSetting(scope, target, [key], value));
  const unset = (row: SettingRow) =>
    row.source && run(() => api.previewRemoveSetting(scope, row.source as Layer, [row.key]));

  const groups = new Map<string, SettingRow[]>();
  for (const r of rows) {
    const d = domainOf(r.key);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(r);
  }
  const orderedDomains = DOMAIN_ORDER.filter((d) => groups.has(d));

  return (
    <>
      <div className="toolbar">
        <label className="fld" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <span>Changes are written to</span>
          <select
            className="select"
            value={target ?? ""}
            onChange={(e) => setLayer(e.target.value as Layer)}
          >
            {layers.map((l) => (
              <option key={l} value={l}>
                {LAYER_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={showUnset}
            onChange={(e) => setShowUnset(e.target.checked)}
          />
          Show all available settings ({unsetCount} not set)
        </label>
      </div>
      {error && (
        <div className="warnbar">
          <Icon name="dot" size={12} /> {error}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>No settings{filter.trim() ? " match the filter" : " set yet"}.</Empty>
      ) : (
        orderedDomains.map((domain) => (
          <div key={domain}>
            <div className="section-title">{domain}</div>
            {groups.get(domain)!.map((r) => {
              const kind = controlKind(r.prop, r.value);
              const locked = r.source === "managed";
              const masked = r.set && isMasked(r.value);
              const enumVals: unknown[] = r.prop?.enum ?? [];
              return (
                <div className="srow" key={r.key}>
                  <div className="grow">
                    <div className="srow-key">
                      {r.key}
                      {r.source && <LayerBadge layer={r.source} />}
                      {!r.set && <span className="badge">not set</span>}
                      {locked && (
                        <span className="badge lock">
                          <Icon name="lock" size={11} /> locked
                        </span>
                      )}
                    </div>
                    {r.prop?.description && <div className="srow-desc">{r.prop.description}</div>}
                  </div>
                  <div className="srow-control">
                    {locked || !target ? (
                      <span className="eff-val">{short(r.value)}</span>
                    ) : masked ? (
                      <span className="eff-val" title="Contains masked secrets — edit in the Files view">
                        {short(r.value)} <Icon name="lock" size={11} />
                      </span>
                    ) : kind === "bool" ? (
                      <button
                        className={`toggle ${r.value ? "on" : ""}`}
                        onClick={() => set(r.key, !r.value)}
                      >
                        <span className="knob" />
                        <span className="tlabel">{r.value ? "on" : "off"}</span>
                      </button>
                    ) : kind === "enum" ? (
                      <select
                        className="select"
                        value={r.set ? String(r.value) : ""}
                        onChange={(e) => {
                          const match = enumVals.find((v) => String(v) === e.target.value);
                          set(r.key, match ?? e.target.value);
                        }}
                      >
                        {!r.set && <option value="">— choose —</option>}
                        {enumVals.map((v) => (
                          <option key={String(v)} value={String(v)}>
                            {String(v)}
                          </option>
                        ))}
                      </select>
                    ) : kind === "json" ? (
                      <>
                        {r.set && <span className="eff-val">{short(r.value)}</span>}
                        <button className="btn" onClick={() => setJsonRow(r)}>
                          {r.set ? "Edit…" : "Set…"}
                        </button>
                      </>
                    ) : (
                      <ValueInput
                        key={`${r.key}:${String(r.value)}`}
                        row={r}
                        kind={kind}
                        onSubmit={(v) => set(r.key, v)}
                      />
                    )}
                    {r.set && !locked && r.source && (
                      <button
                        className="btn"
                        title={`Remove from ${LAYER_LABEL[r.source]} settings`}
                        onClick={() => unset(r)}
                      >
                        Unset
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>
        Every change shows a diff to confirm and keeps a backup. Values with masked secrets
        are edited in the Files view.
      </div>
      {jsonRow && (
        <JsonEditModal
          row={jsonRow}
          onCancel={() => setJsonRow(null)}
          onSubmit={(v) => {
            setJsonRow(null);
            set(jsonRow.key, v);
          }}
        />
      )}
    </>
  );
}
