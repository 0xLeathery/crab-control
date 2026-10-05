import { useState } from "react";
import { Item, Scope, api } from "../api";
import { ConfirmModal } from "../editor";
import { HistoryModal } from "../history";
import { isEditableItem } from "../memory";
import { Editing, TextFileEditor } from "../text-editor";
import { Empty, Icon } from "../ui";
import { ItemKind, NewItemModal } from "../create";
import { Loading } from "./common";

/* ---------- Items (agents / commands / skills) ---------- */

function ItemRow({
  item,
  scope,
  onChanged,
}: {
  item: Item;
  scope: Scope;
  onChanged: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [history, setHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = isEditableItem(item);

  const edit = async () => {
    setError(null);
    try {
      const text = await api.readItem(scope, item.path);
      setEditing({ path: item.path, title: item.name, original: text, text });
    } catch (e) {
      setError(String(e));
    }
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const where = await api.deleteItem(scope, item.path);
      setConfirmDelete(false);
      onChanged(`Moved ${item.name} to ${where}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className="grow">
          <div className="nm">
            {item.name}
            <span className="badge layer">{item.source}</span>
            {!editable && (
              <span className="badge lock" title="Plugin items are managed by the plugin">
                <Icon name="lock" size={11} /> plugin
              </span>
            )}
          </div>
          {item.description && <div className="desc">{item.description}</div>}
          <div className="path">{item.displayPath}</div>
        </div>
        {item.preview && (
          <button className="btn" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Preview"}
          </button>
        )}
        {editable && (
          <>
            <button className="btn" onClick={() => setHistory(true)}>
              History
            </button>
            <button className="btn" onClick={edit}>
              Edit
            </button>
            <button className="btn" onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          </>
        )}
      </div>
      {error && !confirmDelete && (
        <div className="warnbar" style={{ marginTop: 8 }}>
          <Icon name="dot" size={12} /> {error}
        </div>
      )}
      {open && item.preview && (
        <pre className="preview" style={{ marginTop: 10 }}>
          {item.preview}
        </pre>
      )}
      {editing && (
        <TextFileEditor
          editing={editing}
          onSave={(text) => api.saveItem(scope, item.path, text)}
          onClose={() => setEditing(null)}
          onSaved={(backup) => {
            setEditing(null);
            onChanged(backup ? `Saved. Backup: ${backup}` : "Saved.");
          }}
        />
      )}
      {history && (
        <HistoryModal
          scope={scope}
          target={{ kind: "item", path: item.path }}
          title={item.name}
          loadCurrent={() => api.readItem(scope, item.path)}
          onClose={() => setHistory(false)}
          onRestored={(backup) => {
            setHistory(false);
            onChanged(backup ? `Restored. Previous version backed up: ${backup}` : "Restored.");
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${item.name}?`}
          body={
            <>
              It moves to a <span className="mono">.crab-trash</span> folder beside your{" "}
              {item.path.includes("/skills/") ? "skills (the whole skill folder)" : "files"}, where
              Claude Code ignores it. Move it back to restore it.
            </>
          }
          confirmLabel="Move to trash"
          danger
          busy={busy}
          error={error}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
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
  /** Omit for read-only lists (no "New" button). */
  kind?: ItemKind;
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

      {kind && (
        <div className="toolbar">
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="commands" size={13} /> &nbsp;New {kind.replace("-", " ")} ({where})
          </button>
        </div>
      )}

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
        list.map((i) => (
          <ItemRow
            key={i.path}
            item={i}
            scope={scope}
            onChanged={(msg) => {
              setNote(msg);
              onReload();
              setTimeout(() => setNote(null), 6000);
            }}
          />
        ))
      )}

      {creating && kind && (
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
