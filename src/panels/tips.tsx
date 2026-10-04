import { useState } from "react";
import { Tip, TipSeverity } from "../tips";
import { Empty } from "../ui";

const BADGE: Record<TipSeverity, string> = {
  security: "error",
  reliability: "warn",
  productivity: "accent",
};

function DocLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  return (
    <div className="path">
      <span className="mono">{url}</span>{" "}
      <button className="btn" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

export function TipsPanel({
  tips,
  mcpLoaded,
  filter,
}: {
  tips: Tip[];
  mcpLoaded: boolean;
  filter: string;
}) {
  const f = filter.trim().toLowerCase();
  const list = tips.filter(
    (t) => !f || t.title.toLowerCase().includes(f) || t.body.toLowerCase().includes(f)
  );
  return (
    <div className="panel">
      <h1>Tips</h1>
      <div className="sub">
        Suggestions for this configuration, based on the Claude Code docs. Each links the section it
        comes from.
      </div>
      {!mcpLoaded && <div className="sub">Checking MCP servers…</div>}
      {list.length === 0 ? (
        <Empty>{f ? "No tips match the filter." : "Nothing to suggest — this config follows the docs."}</Empty>
      ) : (
        list.map((t) => (
          <div className="row" key={t.id}>
            <div className="grow">
              <div className="nm">
                <span className={`badge ${BADGE[t.severity]}`}>{t.severity}</span> {t.title}
              </div>
              <div className="sub">{t.body}</div>
              <DocLink url={t.docUrl} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
