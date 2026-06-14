// Guarded snapshot import: pick a snapshot, preview a per-file plan (masked
// secrets are skipped), then apply each file via the normal diff/confirm/save.
import { useEffect, useState } from "react";
import { ImportPlan, MutationPreview, Scope, SnapshotRef, api } from "./api";
import { Icon } from "./ui";
import { PreviewConfirm } from "./editor";

export function ImportModal({
  scope,
  onClose,
  onApplied,
}: {
  scope: Scope;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotRef[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<MutationPreview | null>(null);

  useEffect(() => {
    api
      .listSnapshots()
      .then((s) => {
        setSnapshots(s);
        if (s[0]) setSelected(s[0].path);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const preview = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setPlan(null);
    setApplied(new Set());
    try {
      setPlan(await api.previewImport(scope, selected));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Import snapshot</strong>
          <span className="muted" style={{ fontSize: 11.5 }}>
            masked secrets are never written
          </span>
        </div>

        <div className="form">
          {snapshots === null ? (
            <div className="muted">Looking for snapshots…</div>
          ) : snapshots.length === 0 ? (
            <div className="muted">
              No snapshots found in ~/Downloads. Export one first (Overview → Export
              snapshot).
            </div>
          ) : (
            <label className="fld">
              <span>Snapshot</span>
              <select
                className="select"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setPlan(null);
                }}
              >
                {snapshots.map((s) => (
                  <option key={s.path} value={s.path}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {plan && (
            <>
              <div className="fhint">{plan.note}</div>
              {plan.skipped.length > 0 && (
                <div className="warnbar" style={{ marginBottom: 0 }}>
                  <Icon name="lock" size={12} /> Skipped masked secret keys:{" "}
                  {plan.skipped
                    .map((s) => `${s.file} (${s.keys.join(", ")})`)
                    .join("; ")}
                </div>
              )}
              {plan.files.map((f, i) => {
                const key = f.layer + f.displayPath;
                const done = applied.has(key);
                return (
                  <div className="row" key={i} style={{ marginBottom: 6 }}>
                    <div className="grow">
                      <div className="nm">
                        {f.layerLabel}
                        {done && <span className="badge ok">applied</span>}
                      </div>
                      <div className="path">{f.displayPath}</div>
                    </div>
                    <button
                      className="btn primary"
                      disabled={done}
                      onClick={() => setConfirming(f)}
                    >
                      {done ? "Done" : "Review & apply"}
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {error && (
            <div className="warnbar">
              <Icon name="dot" size={12} /> {error}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            className="btn primary"
            onClick={preview}
            disabled={busy || !selected}
          >
            {busy ? "Reading…" : plan ? "Re-preview" : "Preview import"}
          </button>
        </div>
      </div>

      {confirming && (
        <PreviewConfirm
          scope={scope}
          preview={confirming}
          onCancel={() => setConfirming(null)}
          onDone={() => {
            const key = confirming.layer + confirming.displayPath;
            setApplied((a) => new Set(a).add(key));
            setConfirming(null);
            onApplied();
          }}
        />
      )}
    </div>
  );
}
