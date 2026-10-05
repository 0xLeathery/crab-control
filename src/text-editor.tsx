// Shared full-text editor: edit → review diff → save (with backup).
import { useState } from "react";
import { SaveResult } from "./api";
import { DiffModal } from "./editor";

export interface Editing {
  path: string;
  title: string;
  original: string;
  text: string;
}

export function TextFileEditor({
  editing,
  onSave,
  onClose,
  onSaved,
  validate,
  warnOverLines = 200,
}: {
  editing: Editing;
  /** Return an error to block review (e.g. invalid JSON). */
  validate?: (text: string) => string | null;
  /** Warn past this many lines (the memory guidance); 0 turns it off. */
  warnOverLines?: number;
  /** Persist the text; the editor shows the diff and confirms first. */
  onSave: (text: string) => Promise<SaveResult>;
  onClose: () => void;
  onSaved: (backup?: string | null) => void;
}) {
  const [text, setText] = useState(editing.text);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = text.split("\n").length;
  const invalid = validate?.(text) ?? null;
  const long = warnOverLines > 0 && lines > warnOverLines;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await onSave(text);
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
          <div className={`fhint ${long || invalid ? "err" : ""}`}>
            {invalid ??
              `${lines} lines${long ? ` — the docs suggest keeping memory files under ${warnOverLines}` : ""}`}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={text === editing.original || !!invalid}
            onClick={() => setReviewing(true)}
          >
            Review changes…
          </button>
        </div>
      </div>
    </div>
  );
}
