// Keybindings file and status line script: files Claude Code reads that
// aren't settings. Both edit through the Rust writer (diff → backup → save).
import { useEffect, useState } from "react";
import { MemoryFile, Scope, StatusLine, api } from "../api";
import { KEYBINDINGS_TEMPLATE, keybindingsError } from "../extras";
import { HistoryModal } from "../history";
import { Editing, TextFileEditor } from "../text-editor";
import { Empty, Icon } from "../ui";
import { Loading } from "./common";

function useNote() {
  const [note, setNote] = useState<string | null>(null);
  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 6000);
  };
  const bar = note && (
    <div className="okbar">
      <Icon name="dot" size={12} /> {note}
    </div>
  );
  return { flash, bar };
}

const saved = (backup?: string | null) => (backup ? `Saved. Backup: ${backup}` : "Saved.");

export function KeybindingsPanel() {
  const [file, setFile] = useState<MemoryFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [history, setHistory] = useState(false);
  const { flash, bar } = useNote();

  const load = () =>
    api
      .readKeybindings()
      .then(setFile)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, []);

  const edit = () =>
    file &&
    setEditing({
      path: file.displayPath,
      title: "keybindings.json",
      original: file.text,
      text: file.exists ? file.text : KEYBINDINGS_TEMPLATE,
    });

  return (
    <div className="panel">
      <h1>Keybindings</h1>
      <div className="sub">
        Custom keyboard shortcuts in <span className="mono">~/.claude/keybindings.json</span>. Claude
        Code picks up changes without a restart. Set an action to <span className="mono">null</span> to
        unbind a default.
      </div>
      {bar}
      {error && <div className="warnbar">{error}</div>}
      {!file ? (
        <Loading label="Reading keybindings…" />
      ) : (
        <>
          <div className="toolbar">
            <button className="btn primary" onClick={edit}>
              {file.exists ? "Edit" : "Create keybindings.json"}
            </button>
            {file.exists && (
              <button className="btn" onClick={() => setHistory(true)}>
                History
              </button>
            )}
          </div>
          {file.exists ? (
            <pre className="preview">{file.text}</pre>
          ) : (
            <Empty>No keybindings file — Claude Code uses its defaults.</Empty>
          )}
        </>
      )}
      {editing && (
        <TextFileEditor
          editing={editing}
          validate={keybindingsError}
          warnOverLines={0}
          onSave={(text) => api.saveKeybindings(text)}
          onClose={() => setEditing(null)}
          onSaved={(backup) => {
            setEditing(null);
            flash(saved(backup));
            load();
          }}
        />
      )}
      {history && (
        <HistoryModal
          scope={{ kind: "global" }}
          target={{ kind: "keybindings" }}
          title="keybindings.json"
          loadCurrent={async () => (await api.readKeybindings()).text}
          onClose={() => setHistory(false)}
          onRestored={(backup) => {
            setHistory(false);
            flash(saved(backup));
            load();
          }}
        />
      )}
    </div>
  );
}

export function StatusLinePanel({ scope }: { scope: Scope }) {
  const [status, setStatus] = useState<StatusLine | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [history, setHistory] = useState(false);
  const { flash, bar } = useNote();

  const load = () =>
    api
      .readStatusline(scope)
      .then(setStatus)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const script = status?.script;
  return (
    <div className="panel">
      <h1>Status line</h1>
      <div className="sub">
        The command behind <span className="mono">statusLine</span> receives session JSON on stdin and
        prints the bar. Set the command itself under Settings.
      </div>
      {bar}
      {error && <div className="warnbar">{error}</div>}
      {status === undefined ? (
        <Loading label="Reading status line…" />
      ) : status === null ? (
        <Empty>No status line configured. Add a statusLine setting to show one.</Empty>
      ) : (
        <>
          <div className="row">
            <div className="grow">
              <div className="nm">Command</div>
              <div className="path">{status.command}</div>
            </div>
          </div>
          {script ? (
            <>
              <div className="toolbar">
                <button
                  className="btn primary"
                  onClick={() =>
                    setEditing({
                      path: script.displayPath,
                      title: script.displayPath.split("/").pop() ?? "script",
                      original: script.text,
                      text: script.text,
                    })
                  }
                >
                  Edit script
                </button>
                <button className="btn" onClick={() => setHistory(true)}>
                  History
                </button>
              </div>
              <pre className="preview">{script.text}</pre>
            </>
          ) : (
            <Empty>
              The command doesn&apos;t run a script inside a .claude/ folder, so there is no file to
              edit here.
            </Empty>
          )}
        </>
      )}
      {editing && (
        <TextFileEditor
          editing={editing}
          warnOverLines={0}
          onSave={(text) => api.saveStatuslineScript(scope, text)}
          onClose={() => setEditing(null)}
          onSaved={(backup) => {
            setEditing(null);
            flash(saved(backup));
            load();
          }}
        />
      )}
      {history && script && (
        <HistoryModal
          scope={scope}
          target={{ kind: "statusline" }}
          title={script.displayPath}
          loadCurrent={async () => (await api.readStatusline(scope))?.script?.text ?? ""}
          onClose={() => setHistory(false)}
          onRestored={(backup) => {
            setHistory(false);
            flash(saved(backup));
            load();
          }}
        />
      )}
    </div>
  );
}
