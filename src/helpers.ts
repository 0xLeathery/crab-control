// Pure helpers used by the panels — kept here so they can be unit-tested.
import type { Layer, McpServer, Scope } from "./api";

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
  if (s.includes("connect") && !s.includes("fail")) return "ok";
  if (s.includes("auth") || s.includes("pending")) return "warn";
  if (s.includes("fail") || s.includes("error")) return "error";
  return "muted";
}

export function mcpScopeFlag(s: Pick<McpServer, "scope">): string {
  const sc = (s.scope || "").toLowerCase();
  if (sc.includes("claude.ai") || sc.includes("claudeai")) return "claudeai";
  if (sc.includes("project")) return "project";
  if (sc.includes("local")) return "local";
  if (sc.includes("user")) return "user";
  return "user";
}
