import { useEffect, useState } from "react";
import { Item, MemoryTarget, Scope, api } from "../api";
import { DiffModal } from "../editor";
import { creatableTargets, memoryStarter } from "../memory";
import { Empty, Icon } from "../ui";
import { Loading } from "./common";
import { HistoryModal } from "../history";

interface Editing {
  path: string;
  title: string;
  original: string;
  text: string;
}

function MemoryEditor({
  scope,
  editing,
  onClose,
  onSaved,
}: {
  scope: Scope;
  editing: Editing;
  onClose: () => void;
  onSaved: (backup?: string | null) => void;
}) {
  const [text, setText] = useState(editing.text);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = text.split("\n").length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveMemory(scope, editing.path, text);
      if (res.ok) onSaved(res.displayBackup);
      else setError(res.error ?? "save failed");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (reviewing) {
    return (
      <DiffModal
        subtitle={editing.original ? `Edit ${editing.title}` : `Create ${editing.title}`}
        path={editing.path}
        oldText={editing.original}
        newText={text}
        busy={busy}
        error={error}
        onConfirm={save}
        onCancel={() => setReviewing(false)}
      />
    );
  }
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong className="mono">{editing.title}</strong>
        </div>
        <div className="modal-sub">{editing.path}</div>
        <div style={{ padding: "10px 16px 0" }}>
          <textarea
            className="code-area"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(30, Math.max(12, lines + 1))}
          />
          <div className={`fhint ${lines > 200 ? "err" : ""}`}>
            {lines} lines{lines > 200 ? " — the docs suggest keeping memory files under 200" : ""}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={text === editing.original}
            onClick={() => setReviewing(true)}
          >
            Review changes…
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
        <MemoryEditor
          key={editing.path}
          scope={scope}
          editing={editing}
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
