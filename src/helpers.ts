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
