// Pure logic behind the settings editor: which control a key gets, how input
// is parsed, and which keys are listed (set ones plus every schema key).
import type { EffectiveSetting, Layer } from "./api";

export type ControlKind = "bool" | "enum" | "string" | "number" | "integer" | "json";
export type Parsed = { ok: true; value: unknown } | { ok: false; error: string };
export interface SettingRow {
  key: string;
  prop: any;
  set: boolean;
  value: unknown;
  source?: Layer;
}

const MASK = "•";

export function controlKind(prop: any, value: unknown): ControlKind {
  if (Array.isArray(prop?.enum) && prop.enum.length) return "enum";
  if (prop && !prop.anyOf && !prop.oneOf) {
    const types: string[] = Array.isArray(prop.type) ? prop.type : prop.type ? [prop.type] : [];
    const t = types.find((x) => x !== "null");
    if (t === "boolean") return "bool";
    if (t === "string") return "string";
    if (t === "number") return "number";
    if (t === "integer") return "integer";
    if (t) return "json";
  }
  if (prop) return "json";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "json";
}

export function isMasked(v: unknown): boolean {
  if (typeof v === "string") return v.includes(MASK);
  if (Array.isArray(v)) return v.some(isMasked);
  if (v && typeof v === "object") return Object.values(v).some(isMasked);
  return false;
}

export function parseInput(kind: ControlKind, raw: string): Parsed {
  let value: unknown;
  if (kind === "number" || kind === "integer") {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n)) return { ok: false, error: "Enter a number" };
    if (kind === "integer" && !Number.isInteger(n)) return { ok: false, error: "Enter a whole number" };
    value = n;
  } else if (kind === "json") {
    try {
      value = JSON.parse(raw);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  } else if (kind === "bool") {
    value = raw === "true";
  } else {
    value = raw;
  }
  if (isMasked(value)) {
    return { ok: false, error: "Contains masked secrets (••••). Edit this file in the Files view." };
  }
  return { ok: true, value };
}

export function settingRows(
  props: Record<string, any>,
  effective: EffectiveSetting[],
  { showUnset, filter }: { showUnset: boolean; filter: string }
): SettingRow[] {
  const rows = new Map<string, SettingRow>();
  for (const s of effective) {
    rows.set(s.key, { key: s.key, prop: props[s.key], set: true, value: s.value, source: s.source });
  }
  if (showUnset) {
    for (const [key, prop] of Object.entries(props)) {
      if (!rows.has(key)) rows.set(key, { key, prop, set: false, value: undefined });
    }
  }
  const f = filter.trim().toLowerCase();
  return [...rows.values()]
    .filter(
      (r) =>
        !f ||
        r.key.toLowerCase().includes(f) ||
        String(r.prop?.description ?? "").toLowerCase().includes(f)
    )
    .sort((a, b) => a.key.localeCompare(b.key));
}
