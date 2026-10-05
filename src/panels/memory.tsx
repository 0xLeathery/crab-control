import { useEffect, useState } from "react";
import { Item, MemoryTarget, Scope, api } from "../api";
import { creatableTargets, memoryStarter, ruleTemplate } from "../memory";
import { Empty, Icon } from "../ui";
import { Loading } from "./common";
import { Editing, TextFileEditor } from "../text-editor";
import { HistoryModal } from "../history";

function NewRuleModal({
  scope,
  onClose,
  onCreated,
}: {
  scope: Scope;
  onClose: () => void;
  onCreated: (path: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(name);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createItem(scope, "rule", name, ruleTemplate(name, paths));
      onCreated(r.path, name);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>New rule</strong>
        </div>
        <div className="modal-sub">
          A topic file in {scope.kind === "project" ? ".claude/rules/" : "~/.claude/rules/"}. With
          paths, it only loads when Claude works on matching files.
        </div>
        <div className="form" style={{ padding: "10px 16px" }}>
          <label className="fld">
            <span>Name</span>
            <input
              className="finput mono"
              value={name}
              autoFocus
              placeholder="testing"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="fld">
            <span>Paths (optional, comma-separated globs)</span>
            <input
              className="finput mono"
              value={paths}
              placeholder="src/api/**/*.ts"
              onChange={(e) => setPaths(e.target.value)}
            />
          </label>
          {error && <div className="fhint err">{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !nameOk} onClick={create}>
            Create and edit…
          </button>
        </div>
      </div>
    </div>
  );
}

export function MemoryPanel({
  items,
  filter,
  scope,
  onReload,
}: {
  items: Item[] | null;
  filter: string;
  scope: Scope;
  onReload: () => void;
}) {
  const [targets, setTargets] = useState<MemoryTarget[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const [newRule, setNewRule] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listMemoryTargets(scope)
      .then(setTargets)
      .catch(() => setTargets([]));
  }, [scope, items]);

  const open = async (path: string, title: string) => {
    setError(null);
    try {
      const f = await api.readMemory(scope, path);
      setEditing({ path: f.path, title, original: f.text, text: f.text });
    } catch (e) {
      setError(String(e));
    }
  };
  const create = (t: MemoryTarget) =>
    setEditing({
      path: t.path,
      title: `${t.source} ${t.name}`,
      original: "",
      text: memoryStarter(t),
    });

  if (!items) return <Loading label="Reading memory files…" />;
  const f = filter.trim().toLowerCase();
  const list = items.filter(
    (i) =>
      !f ||
      i.name.toLowerCase().includes(f) ||
      (i.description ?? "").toLowerCase().includes(f) ||
      i.source.toLowerCase().includes(f)
  );
  const missing = creatableTargets(targets);

  return (
    <div className="panel">
      <h1>Memory</h1>
      <div className="sub">CLAUDE.md files and rules loaded into Claude's context.</div>

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
        <button className="btn" onClick={() => setNewRule(true)}>
          + New rule ({scope.kind === "project" ? "project" : "user"})
        </button>
      </div>
      {missing.length > 0 && (
        <div className="toolbar">
          {missing.map((t) => (
            <button key={t.path} className="btn" title={t.displayPath} onClick={() => create(t)}>
              + Create {t.source} {t.name}
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <Empty>No memory files{f ? " match the filter" : " yet"}.</Empty>
      ) : (
        list.map((i) => (
          <div className="row" key={i.path}>
            <div className="grow">
              <div className="nm">
                {i.name}
                <span className="badge layer">{i.source}</span>
                {i.lineCount != null && <span className="badge">{i.lineCount} lines</span>}
              </div>
              {i.description && <div className="desc">{i.description}</div>}
              <div className="path">{i.displayPath}</div>
            </div>
            <button className="btn" onClick={() => setHistory(i)}>
              History
            </button>
            <button className="btn" onClick={() => open(i.path, `${i.source} ${i.name}`)}>
              View / edit
            </button>
          </div>
        ))
      )}

      {newRule && (
        <NewRuleModal
          scope={scope}
          onClose={() => setNewRule(false)}
          onCreated={async (path, name) => {
            setNewRule(false);
            onReload();
            await open(path, `rule ${name}`);
          }}
        />
      )}
      {history && (
        <HistoryModal
          scope={scope}
          target={{ kind: "memory", path: history.path }}
          title={`${history.source} ${history.name}`}
          loadCurrent={async () => (await api.readMemory(scope, history.path)).text}
          onClose={() => setHistory(null)}
          onRestored={(backup) => {
            setHistory(null);
            setNote(backup ? `Restored. Previous version backed up: ${backup}` : "Restored.");
            onReload();
            setTimeout(() => setNote(null), 6000);
          }}
        />
      )}
      {editing && (
        <TextFileEditor
          key={editing.path}
          editing={editing}
          onSave={(text) => api.saveMemory(scope, editing.path, text)}
          onClose={() => setEditing(null)}
          onSaved={(backup) => {
            setEditing(null);
            setNote(backup ? `Saved. Backup: ${backup}` : "Saved.");
            onReload();
            setTimeout(() => setNote(null), 6000);
          }}
        />
      )}
    </div>
  );
}
