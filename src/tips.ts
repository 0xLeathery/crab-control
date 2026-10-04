// Config hints grounded in the Claude Code docs. Each rule looks at what the
// app has loaded and, when it fires, links the doc section it paraphrases.
import type { HookEntry, ItemsDomain, McpServer, Scope, SettingsDomain } from "./api";
import { permissionRules, statusClass } from "./helpers";

export type TipSeverity = "security" | "reliability" | "productivity";
export interface Tip {
  id: string;
  severity: TipSeverity;
  title: string;
  body: string;
  docUrl: string;
}
export interface TipInput {
  scope: Scope;
  settings: SettingsDomain | null;
  hooks: HookEntry[] | null;
  mcp: McpServer[] | null;
  items: ItemsDomain | null;
}

const DOCS = "https://code.claude.com/docs/en";
const SEVERITY_ORDER: TipSeverity[] = ["security", "reliability", "productivity"];
const MEMORY_LINE_TARGET = 200;

const list = (names: string[]) => names.map((n) => `“${n}”`).join(", ");

export function configTips({ scope, settings, hooks, mcp, items }: TipInput): Tip[] {
  const tips: Tip[] = [];

  if (settings) {
    const rules = permissionRules(settings.files);
    if (!rules.some((r) => r.list === "deny" && r.rule.includes(".env"))) {
      tips.push({
        id: "deny-env",
        severity: "security",
        title: "Stop Claude from reading .env files",
        body:
          "No deny rule covers .env files. Add Read(./.env) and Read(./.env.*) to permissions.deny " +
          "(the Permissions page can do this) so Claude's file tools can't read your secrets.",
        docUrl: `${DOCS}/permissions#read-and-edit`,
      });
    }

    const modes = settings.files.map((f) => ({
      layer: f.layer,
      mode: (f.content as any)?.permissions?.defaultMode,
    }));
    if (modes.some((m) => m.mode === "bypassPermissions")) {
      tips.push({
        id: "bypass-mode",
        severity: "security",
        title: "bypassPermissions skips every permission prompt",
        body:
          "permissions.defaultMode is bypassPermissions, which also allows writes to protected paths " +
          "like .git and .claude. The docs say to use it only in isolated containers or VMs.",
        docUrl: `${DOCS}/permissions#permission-modes`,
      });
    }
    const ignored = modes.filter(
      (m) =>
        (m.layer === "project" || m.layer === "project-local") &&
        (m.mode === "auto" || m.mode === "bypassPermissions")
    );
    if (ignored.length) {
      tips.push({
        id: "mode-ignored-in-project",
        severity: "reliability",
        title: `defaultMode "${ignored[0].mode}" has no effect in project settings`,
        body:
          "auto and bypassPermissions don't take effect from project or local settings. " +
          "Set them in user settings, or pass --permission-mode for one session.",
        docUrl: `${DOCS}/settings#a-value-you-set-is-ignored`,
      });
    }

    if (!rules.some((r) => r.list === "allow")) {
      tips.push({
        id: "no-allow-rules",
        severity: "productivity",
        title: "Pre-approve the commands you run all the time",
        body:
          "There are no allow rules, so Claude asks before every lint, test or build. " +
          "Allow the safe ones, e.g. Bash(npm run lint) and Bash(npm run test *).",
        docUrl: `${DOCS}/settings#edit-a-settings-file`,
      });
    }
  }

  if (mcp) {
    const shared = mcp.filter((s) => s.inlineSecrets && s.scope.toLowerCase().includes("project"));
    if (shared.length) {
      tips.push({
        id: "mcp-inline-secrets",
        severity: "security",
        title: "Keep secrets out of the shared .mcp.json",
        body:
          `${list(shared.map((s) => s.name))} put literal values in env or headers, and .mcp.json is ` +
          "committed for your team. Use ${VAR} or ${VAR:-default} expansion so each person supplies their own.",
        docUrl: `${DOCS}/mcp#environment-variable-expansion-in-mcp-json`,
      });
    }
    const failing = mcp.filter((s) => statusClass(s.status) === "error");
    if (failing.length) {
      tips.push({
        id: "mcp-failing",
        severity: "reliability",
        title: "Some MCP servers aren't connecting",
        body:
          `${list(failing.map((s) => s.name))} failed to connect, so their tools aren't available. ` +
          "Check `claude mcp list` for the error, or disable servers you no longer use.",
        docUrl: `${DOCS}/mcp#managing-your-servers`,
      });
    }
  }

  if (hooks) {
    const relative = hooks.filter((h) => /^\.\.?\//.test(h.command?.trim() ?? ""));
    if (relative.length) {
      tips.push({
        id: "hook-relative-path",
        severity: "reliability",
        title: "Reference hook scripts from the project root",
        body:
          `${relative.length} hook${relative.length > 1 ? "s use" : " uses"} a relative script path, which breaks ` +
          "if the working directory changes. Use ${CLAUDE_PROJECT_DIR}/path/to/script instead.",
        docUrl: `${DOCS}/hooks#reference-scripts-by-path`,
      });
    }
  }

  if (items) {
    const memory = items.memory ?? [];
    const projectMd = memory.some(
      (m) => m.source === "project" && (m.name === "CLAUDE.md" || m.name === ".claude/CLAUDE.md")
    );
    if (scope.kind === "project" && !projectMd) {
      tips.push({
        id: "no-project-claude-md",
        severity: "productivity",
        title: "Give this project a CLAUDE.md",
        body:
          "Run /init in Claude Code to generate one with your build commands, test steps and conventions, " +
          "then refine it. (Skip this if the repo already uses AGENTS.md.)",
        docUrl: `${DOCS}/memory#set-up-a-project-claude-md`,
      });
    }
    const long = memory.filter((m) => (m.lineCount ?? 0) > MEMORY_LINE_TARGET);
    if (long.length) {
      tips.push({
        id: "long-claude-md",
        severity: "productivity",
        title: "Trim long memory files",
        body:
          `${long.map((m) => `“${m.name}” (${m.lineCount} lines)`).join(", ")}. ` +
          `The docs suggest under ${MEMORY_LINE_TARGET} lines: longer files use more context and are followed ` +
          "less reliably. Move part-specific guidance into path-scoped .claude/rules/ or skills.",
        docUrl: `${DOCS}/memory#write-effective-instructions`,
      });
    }
  }

  return tips.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}
