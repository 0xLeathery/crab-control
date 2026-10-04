/* ---------- small helpers ---------- */

export function Loading({ label }: { label: string }) {
  return (
    <div className="empty">
      <span className="spin" /> &nbsp;{label}
    </div>
  );
}
