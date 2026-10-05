// Pure helpers used by the panels — kept here so they can be unit-tested.
import type { Layer, LayerFile, McpServer, Scope } from "./api";

export type PermissionList = "allow" | "deny" | "ask";
export interface PermissionRule {
  layer: Layer;
  list: PermissionList;
  rule: string;
  readOnly: boolean;
}

export function defaultWriteLayer(scope: Scope): Layer {
  return scope.kind === "project" ? "project" : "user";
}

export function fmtTime(ms?: string | number | null): string {
  if (ms == null) return "—";
  const n = typeof ms === "string" ? Number(ms) : ms;
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Date(n).toLocaleString();
}

export function statusClass(status?: string | null): string {
  if (!status) return "muted";
  const s = status.toLowerCase();
  const notConnected = s.includes("disconnect") || s.includes("not connect");
  if (s.includes("connect") && !s.includes("fail") && !notConnected) return "ok";
  if (s.includes("auth") || s.includes("pending")) return "warn";
  if (s.includes("fail") || s.includes("error")) return "error";
  return "muted";
}

export function mcpScopeFlag(s: Pick<McpServer, "scope">): string {
  const sc = (s.scope || "").toLowerCase();
  if (sc.includes("claude.ai") || sc.includes("claudeai")) return "claudeai";
  // `claude mcp get` says e.g. "User config (available in all your projects)",
  // so the leading word decides before any substring match.
  const first = sc.trim().split(/\s+/)[0];
  if (first === "user" || first === "local" || first === "project") return first;
  if (sc.includes("project")) return "project";
  if (sc.includes("local")) return "local";
  if (sc.includes("user")) return "user";
  return "user";
}

const PERMISSION_LISTS: PermissionList[] = ["allow", "deny", "ask"];

export function permissionRules(files: LayerFile[]): PermissionRule[] {
  const out: PermissionRule[] = [];
  for (const f of files) {
    const perms = (f.content as any)?.permissions;
    if (!perms || typeof perms !== "object") continue;
    for (const list of PERMISSION_LISTS) {
      const rules = perms[list];
      if (!Array.isArray(rules)) continue;
      for (const rule of rules) {
        if (typeof rule === "string") out.push({ layer: f.layer, list, rule, readOnly: f.readOnly });
      }
    }
  }
  return out;
}

export function editableLayers(files: Pick<LayerFile, "layer" | "readOnly">[]): Layer[] {
  return files.filter((f) => !f.readOnly).map((f) => f.layer);
}

export function relativeTime(ms: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Args as one editable line; args with spaces or quotes get quoted. */
export function joinArgs(args: string[]): string {
  return args
    .map((a) => (/^[^\s"'\\]+$/.test(a) ? a : `"${a.replace(/[\\"]/g, (c) => "\\" + c)}"`))
    .join(" ");
}

/** Shell-like split honouring "double", 'single' quotes and backslash escapes. */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inToken = false;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
    } else if (quote === '"') {
      if (c === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) cur += text[++i];
      else if (c === '"') quote = null;
      else cur += c;
    } else if (/\s/.test(c)) {
      if (inToken) out.push(cur);
      cur = "";
      inToken = false;
    } else {
      inToken = true;
      if (c === "\\" && i + 1 < text.length) cur += text[++i];
      else if (c === '"' || c === "'") quote = c;
      else cur += c;
    }
  }
  if (inToken) out.push(cur);
  return out;
}

/** Plugin-provided servers belong to the plugin; they're shown read-only. */
export function isPluginServer(s: Pick<McpServer, "name" | "scope">): boolean {
  return s.scope === "plugin" || s.name.startsWith("plugin:");
}

export type PluginActionKind =
  | "install"
  | "uninstall"
  | "update"
  | "marketplace-add"
  | "marketplace-remove"
  | "marketplace-update";

/** Actions that fetch code (hooks, MCP servers, commands) that then runs as you. */
export function needsTrustWarning(a: PluginActionKind): boolean {
  return a === "install" || a === "update" || a === "marketplace-add";
}

const ACTION_LABELS: Record<PluginActionKind, string> = {
  install: "Install",
  uninstall: "Uninstall",
  update: "Update",
  "marketplace-add": "Add marketplace",
  "marketplace-remove": "Remove marketplace",
  "marketplace-update": "Update marketplace",
};

export function pluginActionLabel(a: PluginActionKind): string {
  return ACTION_LABELS[a];
}
