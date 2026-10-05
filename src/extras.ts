// Pure helpers for output styles and the keybindings file.

export const KEYBINDINGS_TEMPLATE = `{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "$docs": "https://code.claude.com/docs/en/keybindings",
  "bindings": [
    {
      "context": "Chat",
      "bindings": {}
    }
  ]
}
`;

export function outputStyleTemplate(name: string, description: string, keepCoding: boolean): string {
  const lines = ["---", `name: ${name}`];
  if (description.trim()) lines.push(`description: ${description.trim()}`);
  if (keepCoding) lines.push("keep-coding-instructions: true");
  lines.push("---", "", "");
  return lines.join("\n");
}

/** Mirrors the backend check so the editor can flag problems as you type. */
export function keybindingsError(text: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return `Invalid JSON: ${(e as Error).message}`;
  }
  const blocks = (v as { bindings?: unknown })?.bindings;
  if (!v || typeof v !== "object" || Array.isArray(v) || !Array.isArray(blocks)) {
    return 'Expected an object with a "bindings" array';
  }
  for (const [i, b] of blocks.entries()) {
    if (typeof b?.context !== "string") return `bindings[${i}] needs a "context" string`;
    const map = b.bindings;
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      return `bindings[${i}].bindings must be an object of key → action`;
    }
    const bad = Object.entries(map).find(([, a]) => !(typeof a === "string" || a === null));
    if (bad) return `bindings[${i}].bindings["${bad[0]}"] must be an action name or null`;
  }
  return null;
}
