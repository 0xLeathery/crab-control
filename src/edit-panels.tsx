// Structured editors for permissions and hooks. Every change is a preview
// (diff) the user confirms; saving goes through the Rust write pipeline.
import { useState } from "react";
import {
  HookEntry,
  LAYER_LABEL,
  Layer,
  MutationPreview,
  Scope,
  SettingsDomain,
  api,
} from "./api";
import { PreviewConfirm } from "./editor";
import {
  HOOK_TYPES,
  HookForm,
  emptyHookForm,
  hookFormFromEntry,
  hookSpecFromForm,
  hookSummary,
} from "./hooks";
import { isMasked } from "./settings-edit";
import { editableLayers, PermissionList, permissionRules } from "./helpers";
import { Empty, Icon, LayerBadge } from "./ui";

const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "SessionStart",
  "SessionEnd",
];

function useEditFlow(scope: Scope, onReload: () => void) {
  const [preview, setPreview] = useState<MutationPreview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Resolves true once a preview is showing, so callers can reset inputs.
  const start = async (make: () => Promise<MutationPreview>) => {
    setError(null);
    try {
      setPreview(await make());
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  const modal = preview && (
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
  );
  const bars = (
    <>
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
    </>
  );
  return { start, modal, bars };
}

function LayerSelect({
  layers,
  value,
  onChange,
}: {
  layers: Layer[];
  value: Layer;
  onChange: (l: Layer) => void;
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as Layer)}>
      {layers.map((l) => (
        <option key={l} value={l}>
          {LAYER_LABEL[l]}
        </option>
      ))}
    </select>
  );
}

/* ---------- Permissions ---------- */

export function PermissionsPanel({
  data,
  filter,
  scope,
  onReload,
}: {
  data: SettingsDomain | null;
  filter: string;
  scope: Scope;
  onReload: () => void;
}) {
  const layers = data ? editableLayers(data.files) : [];
  const [layer, setLayer] = useState<Layer | null>(null);
  const [list, setList] = useState<PermissionList>("allow");
  const [rule, setRule] = useState("");
  const { start, modal, bars } = useEditFlow(scope, onReload);

  if (!data) return <Empty>Reading permissions…</Empty>;
  const target = layer && layers.includes(layer) ? layer : layers[0];
  const f = filter.trim().toLowerCase();
  const rules = permissionRules(data.files).filter(
    (r) => !f || r.rule.toLowerCase().includes(f) || r.list.includes(f)
  );

  return (
    <div className="panel">
      <h1>Permissions</h1>
      <div className="sub">Allow / deny / ask rules from every settings layer.</div>
      {bars}

      {target && (
        <div className="form">
          <div className="frow">
            <label className="fld" style={{ maxWidth: 110 }}>
              <span>List</span>
              <select
                className="select"
                value={list}
                onChange={(e) => setList(e.target.value as PermissionList)}
              >
                <option value="allow">allow</option>
                <option value="deny">deny</option>
                <option value="ask">ask</option>
              </select>
            </label>
            <label className="fld">
              <span>Rule</span>
              <input
                className="finput mono"
                value={rule}
                placeholder="Bash(npm test:*)"
                onChange={(e) => setRule(e.target.value)}
              />
            </label>
            <label className="fld" style={{ maxWidth: 160 }}>
              <span>Layer</span>
              <LayerSelect layers={layers} value={target} onChange={setLayer} />
            </label>
          </div>
          <div className="toolbar">
            <button
              className="btn primary"
              disabled={!rule.trim()}
              onClick={() =>
                start(() => api.previewPermissionRule(scope, target, list, rule, true)).then((ok) =>
                  ok && setRule("")
                )
              }
            >
              Add rule…
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <Empty>No permission rules{f ? " match" : ""}.</Empty>
      ) : (
        rules.map((r) => (
          <div className="row" key={`${r.layer}:${r.list}:${r.rule}`}>
            <div className="grow">
              <div className="nm">
                <span className={`badge ${r.list === "deny" ? "error" : r.list === "ask" ? "warn" : "ok"}`}>
                  {r.list}
                </span>{" "}
                <span className="mono">{r.rule}</span>
              </div>
            </div>
            <LayerBadge layer={r.layer} />
            {!r.readOnly && (
              <button
                className="btn"
                onClick={() =>
                  start(() => api.previewPermissionRule(scope, r.layer, r.list, r.rule, false))
                }
              >
                Remove…
              </button>
            )}
          </div>
        ))
      )}
      {modal}
    </div>
  );
}

/* ---------- Hooks ---------- */

/** Type-specific inputs shared by the add and edit hook forms. */
function HookFields({ form, onChange }: { form: HookForm; onChange: (f: HookForm) => void }) {
  const set = (k: keyof HookForm) => (e: { target: { value: string } }) =>
    onChange({ ...form, [k]: e.target.value });
  const usesPrompt = form.hookType === "prompt" || form.hookType === "agent";
  return (
    <>
      <div className="frow">
        <label className="fld" style={{ maxWidth: 130 }}>
          <span>Type</span>
          <select className="select" value={form.hookType} onChange={set("hookType")}>
            {HOOK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ maxWidth: 160 }}>
          <span>Matcher (optional)</span>
          <input className="finput mono" value={form.matcher} placeholder="Edit|Write" onChange={set("matcher")} />
        </label>
        <label className="fld" style={{ maxWidth: 110 }}>
          <span>Timeout (s)</span>
          <input className="finput mono" value={form.timeout} onChange={set("timeout")} />
        </label>
      </div>
      <div className="frow">
        {form.hookType === "command" && (
          <label className="fld">
            <span>Command</span>
            <input
              className="finput mono"
              value={form.command}
              placeholder="./scripts/format.sh"
              onChange={set("command")}
            />
          </label>
        )}
        {form.hookType === "http" && (
          <label className="fld">
            <span>URL (receives the event JSON as a POST)</span>
            <input
              className="finput mono"
              value={form.url}
              placeholder="http://localhost:8080/hooks"
              onChange={set("url")}
            />
          </label>
        )}
        {usesPrompt && (
          <>
            <label className="fld">
              <span>{form.hookType === "agent" ? "Agent instructions" : "Prompt"} ($ARGUMENTS = event JSON)</span>
              <input className="finput" value={form.prompt} onChange={set("prompt")} />
            </label>
            <label className="fld" style={{ maxWidth: 130 }}>
              <span>Model (optional)</span>
              <input className="finput mono" value={form.model} placeholder="haiku" onChange={set("model")} />
            </label>
          </>
        )}
      </div>
    </>
  );
}

function HookRow({
  hook: h,
  editable,
  scope,
  start,
}: {
  hook: HookEntry;
  editable: boolean;
  scope: Scope;
  start: (load: () => Promise<MutationPreview>) => Promise<boolean>;
}) {
  const [form, setForm] = useState<HookForm | null>(null);
  const masked = isMasked([h.command, h.url, h.prompt]);
  const check = form ? hookSpecFromForm(form) : null;
  return (
    <div className="row" style={form ? { flexWrap: "wrap" } : undefined}>
      <div className="grow">
        <div className="nm">
          {h.event}
          {h.matcher && <span className="badge layer">{h.matcher}</span>}
          <span className="badge accent">{h.hookType}</span>
        </div>
        {hookSummary(h) && <div className="path">{hookSummary(h)}</div>}
      </div>
      {h.plugin ? (
        <span className="badge muted" title="Provided by a plugin — read-only">
          {h.plugin}
        </span>
      ) : (
        <LayerBadge layer={h.source} />
      )}
      {editable && !form && (
        <>
          <button
            className="btn"
            disabled={masked}
            title={masked ? "Contains a masked secret — edit the raw settings file instead" : undefined}
            onClick={() => setForm(hookFormFromEntry(h))}
          >
            Edit
          </button>
          <button
            className="btn"
            onClick={() => start(() => api.previewHookRemove(scope, h.source, h.event, h.groupIndex, h.hookIndex))}
          >
            Remove…
          </button>
        </>
      )}
      {form && check && (
        <div className="form" style={{ flexBasis: "100%" }}>
          <HookFields form={form} onChange={setForm} />
          {check.error && <div className="fhint err">{check.error}</div>}
          <div className="toolbar">
            <button
              className="btn primary"
              disabled={!check.spec}
              onClick={() =>
                check.spec &&
                start(() =>
                  api.previewHookUpdate(
                    scope,
                    h.source,
                    h.event,
                    h.groupIndex,
                    h.hookIndex,
                    form.matcher.trim() || null,
                    check.spec!
                  )
                ).then((ok) => ok && setForm(null))
              }
            >
              Review changes…
            </button>
            <button className="btn" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function HooksPanel({
  hooks,
  settings,
  filter,
  scope,
  onReload,
}: {
  hooks: HookEntry[] | null;
  settings: SettingsDomain | null;
  filter: string;
  scope: Scope;
  onReload: () => void;
}) {
  const layers = settings ? editableLayers(settings.files) : [];
  const [layer, setLayer] = useState<Layer | null>(null);
  const [event, setEvent] = useState(HOOK_EVENTS[1]);
  const [form, setForm] = useState<HookForm>(emptyHookForm);
  const { start, modal, bars } = useEditFlow(scope, onReload);

  if (!hooks) return <Empty>Reading hooks…</Empty>;
  const target = layer && layers.includes(layer) ? layer : layers[0];
  const f = filter.trim().toLowerCase();
  const list = hooks.filter(
    (h) =>
      !f ||
      h.event.toLowerCase().includes(f) ||
      hookSummary(h).toLowerCase().includes(f) ||
      (h.matcher ?? "").toLowerCase().includes(f)
  );
  const check = hookSpecFromForm(form);
  const touched = !!(form.command || form.url || form.prompt || form.timeout);

  return (
    <div className="panel">
      <h1>Hooks</h1>
      <div className="sub">
        Commands, HTTP endpoints, prompts or agents Claude Code runs on lifecycle events.
      </div>
      {bars}

      {target && (
        <div className="form">
          <div className="frow">
            <label className="fld" style={{ maxWidth: 170 }}>
              <span>Event</span>
              <select className="select" value={event} onChange={(e) => setEvent(e.target.value)}>
                {HOOK_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </label>
            <label className="fld" style={{ maxWidth: 160 }}>
              <span>Layer</span>
              <LayerSelect layers={layers} value={target} onChange={setLayer} />
            </label>
          </div>
          <HookFields form={form} onChange={setForm} />
          {touched && check.error && <div className="fhint err">{check.error}</div>}
          <div className="toolbar">
            <button
              className="btn primary"
              disabled={!check.spec}
              onClick={() =>
                check.spec &&
                start(() =>
                  api.previewHookAdd(scope, target, event, form.matcher.trim() || null, check.spec!)
                ).then((ok) => ok && setForm(emptyHookForm()))
              }
            >
              Add hook…
            </button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <Empty>No hooks{f ? " match" : " configured"}.</Empty>
      ) : (
        list.map((h) => (
          <HookRow
            key={`${h.plugin ?? h.source}:${h.event}:${h.groupIndex}:${h.hookIndex}`}
            hook={h}
            editable={!h.plugin && layers.includes(h.source)}
            scope={scope}
            start={start}
          />
        ))
      )}
      {modal}
    </div>
  );
}
