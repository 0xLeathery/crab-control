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
  const [matcher, setMatcher] = useState("");
  const [command, setCommand] = useState("");
  const [timeout, setTimeoutSecs] = useState("");
  const { start, modal, bars } = useEditFlow(scope, onReload);

  if (!hooks) return <Empty>Reading hooks…</Empty>;
  const target = layer && layers.includes(layer) ? layer : layers[0];
  const f = filter.trim().toLowerCase();
  const list = hooks.filter(
    (h) =>
      !f ||
      h.event.toLowerCase().includes(f) ||
      (h.command ?? "").toLowerCase().includes(f) ||
      (h.matcher ?? "").toLowerCase().includes(f)
  );
  const secs = timeout.trim() ? Number(timeout) : null;
  const timeoutOk = secs === null || (Number.isInteger(secs) && secs > 0);

  return (
    <div className="panel">
      <h1>Hooks</h1>
      <div className="sub">Commands Claude Code runs on lifecycle events.</div>
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
              <span>Matcher (optional)</span>
              <input
                className="finput mono"
                value={matcher}
                placeholder="Edit|Write"
                onChange={(e) => setMatcher(e.target.value)}
              />
            </label>
            <label className="fld" style={{ maxWidth: 160 }}>
              <span>Layer</span>
              <LayerSelect layers={layers} value={target} onChange={setLayer} />
            </label>
          </div>
          <div className="frow">
            <label className="fld">
              <span>Command</span>
              <input
                className="finput mono"
                value={command}
                placeholder="./scripts/format.sh"
                onChange={(e) => setCommand(e.target.value)}
              />
            </label>
            <label className="fld" style={{ maxWidth: 110 }}>
              <span>Timeout (s)</span>
              <input
                className="finput mono"
                value={timeout}
                onChange={(e) => setTimeoutSecs(e.target.value)}
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              className="btn primary"
              disabled={!command.trim() || !timeoutOk}
              onClick={() =>
                start(() =>
                  api.previewHookAdd(scope, target, event, matcher.trim() || null, command, secs)
                ).then((ok) => ok && setCommand(""))
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
          <div className="row" key={`${h.source}:${h.event}:${h.groupIndex}:${h.hookIndex}`}>
            <div className="grow">
              <div className="nm">
                {h.event}
                {h.matcher && <span className="badge layer">{h.matcher}</span>}
                <span className="badge accent">{h.hookType}</span>
              </div>
              {h.command && <div className="path">{h.command}</div>}
            </div>
            <LayerBadge layer={h.source} />
            {layers.includes(h.source) && (
              <button
                className="btn"
                onClick={() =>
                  start(() =>
                    api.previewHookRemove(scope, h.source, h.event, h.groupIndex, h.hookIndex)
                  )
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
