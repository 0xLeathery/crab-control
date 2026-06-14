// Raw-JSON editor + reusable confirm/diff components. All writes funnel through
// the safety flow: validate → diff → confirm → atomic save with backup.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layer, MutationPreview, RawFile, Scope, ValidateResult, api } from "./api";
import { Icon } from "./ui";

type DiffLine = { type: "ctx" | "add" | "del"; text: string };

// O(n*m) LCS line diff — fine for small settings files.
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ type: "ctx", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: A[i++] });
    } else {
      out.push({ type: "add", text: B[j++] });
    }
  }
  while (i < n) out.push({ type: "del", text: A[i++] });
  while (j < m) out.push({ type: "add", text: B[j++] });
  return out;
}

export function DiffModal({
  subtitle,
  path,
  oldText,
  newText,
  busy,
  error,
  confirmLabel = "Save changes",
  danger = false,
  onConfirm,
  onCancel,
}: {
  subtitle: string;
  path: string;
  oldText: string;
  newText: string;
  busy: boolean;
  error: string | null;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const diff = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);
  const changeCount = diff.filter((d) => d.type !== "ctx").length;
  return (
    <div className="modal-scrim" onClick={() => !busy && onCancel()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Confirm change</strong>
          <span className="muted mono" style={{ fontSize: 11.5 }}>
            {path}
          </span>
        </div>
        <div className="modal-sub">
          {subtitle} · {changeCount} line{changeCount === 1 ? "" : "s"} changed · backup kept
          (last 5) · atomic write.
        </div>
        <div className="diff">
          {diff.map((d, i) => (
            <div key={i} className={`dl ${d.type}`}>
              <span className="sign">
                {d.type === "add" ? "+" : d.type === "del" ? "-" : " "}
              </span>
              {d.text}
            </div>
          ))}
        </div>
        {error && (
          <div className="warnbar" style={{ margin: "0 16px 10px" }}>
            <Icon name="dot" size={12} /> {error}
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Simple confirmation (no diff) — used for CLI actions like MCP remove.
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger = false,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-scrim" onClick={() => !busy && onCancel()}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
        </div>
        <div className="modal-sub" style={{ borderBottom: "none", paddingTop: 8 }}>
          {body}
        </div>
        {error && (
          <div className="warnbar" style={{ margin: "0 16px 10px" }}>
            <Icon name="dot" size={12} /> {error}
          </div>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Shows a structured-mutation preview as a diff and commits it via save_settings.
export function PreviewConfirm({
  scope,
  preview,
  onDone,
  onCancel,
}: {
  scope: Scope;
  preview: MutationPreview;
  onDone: (backup?: string | null) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveSettings(scope, preview.layer, preview.newText);
      if (res.ok) onDone(res.displayBackup);
      else setError(res.error ?? "save failed");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DiffModal
      subtitle={`${preview.note} → ${preview.layerLabel}`}
      path={preview.displayPath}
      oldText={preview.oldText}
      newText={preview.newText}
      busy={busy}
      error={error}
      onConfirm={confirm}
      onCancel={onCancel}
    />
  );
}

export function RawEditor({
  scope,
  layer,
  initial,
  onSaved,
  onClose,
}: {
  scope: Scope;
  layer: Layer;
  initial: RawFile;
  onSaved: (backup?: string | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial.text);
  const [validation, setValidation] = useState<ValidateResult>({ valid: true });
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const dirty = text !== initial.text;

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api.validateJson(text).then((v) => {
        if (!cancelled) setValidation(v);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text]);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const doSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.saveSettings(scope, layer, text);
      if (res.ok) {
        setConfirming(false);
        onSaved(res.displayBackup);
      } else {
        setError(res.error ?? "save failed");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor">
      {initial.hasSecrets && (
        <div className="warnbar" style={{ marginBottom: 10 }}>
          <Icon name="lock" size={12} /> This file contains values that look like
          secrets. They are shown unmasked here so you can edit — take care.
        </div>
      )}

      <textarea
        ref={taRef}
        className="code-area"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(28, Math.max(8, text.split("\n").length + 1))}
      />

      <div className="editor-bar">
        {validation.valid ? (
          <span className="badge ok">valid JSON</span>
        ) : (
          <span className="badge error">
            invalid: {validation.error?.split("\n")[0]}
            {validation.line != null && ` (line ${validation.line})`}
          </span>
        )}
        {dirty ? (
          <span className="badge warn">
            <span className="dot-amber" /> unsaved
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            no changes
          </span>
        )}
        <span className="spacer-flex" />
        <button className="btn" onClick={onClose} disabled={saving}>
          Close
        </button>
        <button className="btn" onClick={() => setText(initial.text)} disabled={!dirty || saving}>
          Revert
        </button>
        <button
          className="btn primary"
          onClick={() => setConfirming(true)}
          disabled={!dirty || !validation.valid || saving}
        >
          Review &amp; save…
        </button>
      </div>

      {error && (
        <div className="warnbar" style={{ marginTop: 10 }}>
          <Icon name="dot" size={12} /> {error}
        </div>
      )}

      {confirming && (
        <DiffModal
          subtitle={`Edit ${initial.displayPath.split("/").pop()}`}
          path={initial.displayPath}
          oldText={initial.text}
          newText={text}
          busy={saving}
          error={error}
          onConfirm={doSave}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
