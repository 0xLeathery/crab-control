// Backup history for one file: list the copies writer.rs keeps, diff one
// against the current file, and restore it (which backs up the current one).
import { useEffect, useState } from "react";
import { BackupEntry, BackupTarget, Scope, api } from "./api";
import { DiffModal } from "./editor";
import { relativeTime } from "./helpers";
import { Empty, Icon } from "./ui";

export function HistoryModal({
  scope,
  target,
  title,
  loadCurrent,
  onClose,
  onRestored,
}: {
  scope: Scope;
  target: BackupTarget;
  title: string;
  loadCurrent: () => Promise<string>;
  onClose: () => void;
  onRestored: (backup?: string | null) => void;
}) {
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ entry: BackupEntry; current: string; old: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listBackups(scope, target)
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, [scope, target]);

  const open = async (entry: BackupEntry) => {
    setError(null);
    try {
      const [current, old] = await Promise.all([
        loadCurrent(),
        api.readBackup(scope, target, entry.path),
      ]);
      setDiff({ entry, current, old });
    } catch (e) {
      setError(String(e));
    }
  };

  const restore = async () => {
    if (!diff) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.restoreBackup(scope, target, diff.entry.path);
      if (res.ok) onRestored(res.displayBackup);
      else setError(res.error ?? "restore failed");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (diff) {
    return (
      <DiffModal
        subtitle={`Restore ${title} from ${relativeTime(diff.entry.savedAt)} (current version is backed up first)`}
        path={diff.entry.displayPath}
        oldText={diff.current}
        newText={diff.old}
        busy={busy}
        error={error}
        confirmLabel="Restore this version"
        onConfirm={restore}
        onCancel={() => setDiff(null)}
      />
    );
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>History · {title}</strong>
        </div>
        <div className="modal-sub">
          Crab Control keeps the last 5 versions of each file it saves. Contents are shown
          unmasked.
        </div>
        <div style={{ padding: "10px 16px" }}>
          {error && (
            <div className="warnbar">
              <Icon name="dot" size={12} /> {error}
            </div>
          )}
          {!entries ? (
            <Empty>Reading backups…</Empty>
          ) : entries.length === 0 ? (
            <Empty>No backups yet. One is made each time this file is saved here.</Empty>
          ) : (
            entries.map((b) => (
              <div className="row" key={b.path}>
                <div className="grow">
                  <div className="nm">
                    {relativeTime(b.savedAt)}
                    <span className="badge">{new Date(b.savedAt).toLocaleString()}</span>
                  </div>
                  <div className="path">
                    {b.displayPath} · {b.bytes} bytes
                  </div>
                </div>
                <button className="btn" onClick={() => open(b)}>
                  Compare & restore…
                </button>
              </div>
            ))
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
