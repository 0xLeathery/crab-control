import type { HookEntry } from "./api";
import { isMasked } from "./settings-edit";

export const HOOK_TYPES = ["command", "http", "prompt", "agent"] as const;

export interface HookForm {
  hookType: string;
  matcher: string;
  command: string;
  url: string;
  prompt: string;
  model: string;
  timeout: string;
}

export interface HookSpec {
  hookType: string;
  command?: string;
  url?: string;
  prompt?: string;
  model?: string;
  timeout?: number;
}

export function emptyHookForm(): HookForm {
  return { hookType: "command", matcher: "", command: "", url: "", prompt: "", model: "", timeout: "" };
}

export function hookSpecFromForm(f: HookForm): { spec?: HookSpec; error?: string } {
  const spec: HookSpec = { hookType: f.hookType };
  if (f.hookType === "command") {
    if (!f.command.trim()) return { error: "Command is required" };
    spec.command = f.command.trim();
  } else if (f.hookType === "http") {
    const url = f.url.trim();
    if (!/^https?:\/\//.test(url)) return { error: "URL must start with http:// or https://" };
    spec.url = url;
  } else if (f.hookType === "prompt" || f.hookType === "agent") {
    if (!f.prompt.trim()) return { error: "Prompt is required" };
    spec.prompt = f.prompt.trim();
    if (f.model.trim()) spec.model = f.model.trim();
  } else {
    return { error: `Unsupported hook type: ${f.hookType}` };
  }
  if (f.timeout.trim()) {
    const secs = Number(f.timeout);
    if (!Number.isInteger(secs) || secs <= 0) return { error: "Timeout must be a whole number of seconds" };
    spec.timeout = secs;
  }
  if (isMasked(spec)) return { error: "Contains a masked value — edit the raw settings file instead" };
  return { spec };
}

export function hookFormFromEntry(h: HookEntry): HookForm {
  return {
    hookType: h.hookType,
    matcher: h.matcher ?? "",
    command: h.command ?? "",
    url: h.url ?? "",
    prompt: h.prompt ?? "",
    model: h.model ?? "",
    timeout: h.timeout != null ? String(h.timeout) : "",
  };
}

export function hookSummary(h: HookEntry): string {
  if (h.hookType === "http") return h.url ?? "";
  if (h.hookType === "prompt" || h.hookType === "agent") {
    return [h.prompt, h.model].filter(Boolean).join(" · ");
  }
  return h.command ?? "";
}
