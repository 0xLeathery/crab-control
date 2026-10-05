// Shared UI primitives: a single minimal line-icon set, badges, JSON viewer.
import { Layer, LAYER_LABEL } from "./api";

type IconName =
  | "overview"
  | "settings"
  | "mcp"
  | "plugins"
  | "agents"
  | "commands"
  | "hooks"
  | "skills"
  | "memory"
  | "tips"
  | "chevron"
  | "lock"
  | "search"
  | "refresh"
  | "dot"
  | "folder"
  | "globe"
  | "style"
  | "keyboard"
  | "statusbar";

const PATHS: Record<IconName, string> = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 006 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003.4 14H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010 4.6V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9",
  mcp: "M5 7h14M5 12h14M5 17h9M3 7h.01M3 12h.01M3 17h.01",
  plugins:
    "M10 3v4M14 3v4M6 7h12v5a6 6 0 01-6 6 6 6 0 01-6-6zM12 18v3",
  agents:
    "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  commands: "M4 17l6-6-6-6M12 19h8",
  hooks: "M18 6V4a2 2 0 00-2-2h0a2 2 0 00-2 2v10a4 4 0 11-8 0M18 6a3 3 0 11-6 0",
  tips: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z",
  memory: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
  skills: "M12 2l2.4 7.4H22l-6 4.5 2.3 7.1-6.3-4.6L5.7 21 8 14 2 9.4h7.6z",
  chevron: "M6 9l6 6 6-6",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 018 0v4",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  refresh: "M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5",
  dot: "M12 12h.01",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  style: "M4 20l6-16h4l6 16M7.5 13h9",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  statusbar: "M3 4h18v16H3zM3 15h18M7 18h4",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 000 18 14 14 0 000-18",
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// Brand mark: a little crab on a leash.
export function CrabMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* leash + handle loop */}
      <path
        d="M16.5 9.2c2.3-1.1 3.8-2.7 4.1-5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.65"
      />
      <circle cx="21.4" cy="3.2" r="1.1" stroke="currentColor" strokeWidth="1.3" />
      {/* legs */}
      <path
        d="M6 15l-3 1M6.6 16.6l-2.5 1.9M17.4 16.6l2.5 1.9M18 15l3 1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* claws */}
      <path
        d="M6.2 13.2c-2.3-.3-3.9-1.5-4.2-3.4.95.2 1.5.75 1.8 1.5.2-.95-.1-1.8-.75-2.5 1.7.35 2.95 1.6 3.15 3.4z"
        fill="currentColor"
      />
      <path
        d="M17.8 13.2c2.3-.3 3.9-1.5 4.2-3.4-.95.2-1.5.75-1.8 1.5-.2-.95.1-1.8.75-2.5-1.7.35-2.95 1.6-3.15 3.4z"
        fill="currentColor"
      />
      {/* body */}
      <ellipse cx="12" cy="14" rx="6.2" ry="4" fill="currentColor" />
      {/* eye stalks */}
      <path
        d="M10 10.6V8.4M14 10.6V8.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="7.9" r="1.5" fill="currentColor" />
      <circle cx="14" cy="7.9" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function LayerBadge({ layer }: { layer: Layer }) {
  const cls = layer === "managed" ? "badge lock" : "badge layer";
  return (
    <span className={cls} title={`Source: ${LAYER_LABEL[layer]}`}>
      {layer === "managed" && <Icon name="lock" size={11} />}
      {LAYER_LABEL[layer]}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Lightweight JSON syntax highlighter for read-only display.
export function JsonView({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  const esc = escapeHtml(json);
  const html = esc.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(\.\d*)?([eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "n";
      if (/^"/.test(match)) cls = /:$/.test(match) ? "k" : "s";
      else if (/true|false/.test(match)) cls = "b";
      else if (/null/.test(match)) cls = "null";
      return `<span class="${cls}">${match}</span>`;
    }
  );
  return <pre className="json" dangerouslySetInnerHTML={{ __html: html }} />;
}

// Compact inline value (single line) for the effective-settings table.
export function InlineValue({ value }: { value: unknown }) {
  let s: string;
  if (typeof value === "string") s = JSON.stringify(value);
  else s = JSON.stringify(value);
  if (s && s.length > 140) s = s.slice(0, 140) + "…";
  return <span className="eff-val">{s}</span>;
}
