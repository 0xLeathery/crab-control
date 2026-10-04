import { useState } from "react";
import { Item, Scope } from "../api";
import { Empty, Icon } from "../ui";
import { NewItemModal } from "../create";
import { Loading } from "./common";

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
  /** Omit for read-only lists (no "New" button). */
  kind?: "agent" | "command" | "skill";
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
            <Icon name="commands" size={13} /> &nbsp;New {kind} ({where})
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
        list.map((i) => <ItemRow key={i.path} item={i} />)
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
