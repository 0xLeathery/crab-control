import { describe, expect, it } from "vitest";
import { configTips, TipInput } from "./tips";

const file = (layer: string, content: unknown, readOnly = false) =>
  ({ layer, content, readOnly, label: layer, path: "", displayPath: "", present: true, error: null }) as any;

// A config that follows every recommendation: no tips expected.
function healthy(): TipInput {
  return {
    scope: { kind: "project", path: "/p" },
    settings: {
      files: [
        file("user", {
          permissions: { allow: ["Bash(npm test)"], deny: ["Read(./.env)", "Read(./.env.*)"] },
        }),
        file("project", { theme: "dark" }),
      ],
      effective: [],
    },
    hooks: [
      {
        event: "PostToolUse",
        hookType: "command",
        command: "${CLAUDE_PROJECT_DIR}/.claude/hooks/fmt.sh",
        source: "project",
        groupIndex: 0,
        hookIndex: 0,
      },
    ],
    mcp: [
      { name: "gh", scope: "project (.mcp.json)", transport: "stdio", status: "Connected", source: ".mcp.json", inlineSecrets: false },
    ],
    items: {
      agents: [],
      commands: [],
      skills: [],
      outputStyles: [],
      memory: [{ name: "CLAUDE.md", source: "project", path: "", displayPath: "", lineCount: 80 }],
    },
  } as TipInput;
}

const ids = (input: TipInput) => configTips(input).map((t) => t.id);

describe("configTips", () => {
  it("gives no tips for a config that follows the docs", () => {
    expect(ids(healthy())).toEqual([]);
  });

  it("every tip links to the Claude Code docs", () => {
    const input = healthy();
    input.settings!.files = [file("project", { permissions: { defaultMode: "bypassPermissions" } })];
    input.items!.memory = [];
    const tips = configTips(input);
    expect(tips.length).toBeGreaterThan(2);
    for (const t of tips) expect(t.docUrl).toMatch(/^https:\/\/code\.claude\.com\/docs\/en\//);
  });

  it("suggests denying .env reads when no deny rule covers them", () => {
    const input = healthy();
    input.settings!.files[0].content = { permissions: { allow: ["Bash(ls)"] } };
    expect(ids(input)).toContain("deny-env");
  });

  it("warns about bypassPermissions, and that project files can't set it", () => {
    const input = healthy();
    input.settings!.files[1].content = { permissions: { defaultMode: "bypassPermissions" } };
    expect(ids(input)).toEqual(expect.arrayContaining(["bypass-mode", "mode-ignored-in-project"]));
    input.settings!.files[1].content = {};
    input.settings!.files[0].content = {
      permissions: { defaultMode: "bypassPermissions", allow: ["x"], deny: ["Read(.env)"] },
    };
    expect(ids(input)).toEqual(["bypass-mode"]);
  });

  it("suggests an allowlist when there are no allow rules", () => {
    const input = healthy();
    input.settings!.files[0].content = { permissions: { deny: ["Read(./.env)"] } };
    expect(ids(input)).toEqual(["no-allow-rules"]);
  });

  it("flags inline secrets only in shared project MCP config", () => {
    const input = healthy();
    input.mcp = [
      { ...input.mcp![0], inlineSecrets: true },
      { ...input.mcp![0], name: "mine", scope: "local", inlineSecrets: true },
    ];
    const tip = configTips(input).find((t) => t.id === "mcp-inline-secrets");
    expect(tip?.body).toContain("gh");
    expect(tip?.body).not.toContain("mine");
  });

  it("flags failing MCP servers", () => {
    const input = healthy();
    input.mcp = [{ ...input.mcp![0], status: "✗ Failed to connect" }];
    expect(ids(input)).toEqual(["mcp-failing"]);
  });

  it("suggests /init when a project has no CLAUDE.md, but not in global scope", () => {
    const input = healthy();
    input.items!.memory = [{ name: "CLAUDE.md", source: "user", path: "", displayPath: "", lineCount: 5 }];
    expect(ids(input)).toEqual(["no-project-claude-md"]);
    input.scope = { kind: "global" };
    expect(ids(input)).toEqual([]);
  });

  it("flags memory files over 200 lines", () => {
    const input = healthy();
    input.items!.memory[0].lineCount = 450;
    const tip = configTips(input).find((t) => t.id === "long-claude-md");
    expect(tip?.body).toContain("450");
  });

  it("flags hooks that use relative script paths", () => {
    const input = healthy();
    input.hooks![0].command = "./scripts/fmt.sh";
    expect(ids(input)).toEqual(["hook-relative-path"]);
  });

  it("skips checks whose data hasn't loaded", () => {
    expect(ids({ scope: { kind: "global" }, settings: null, hooks: null, mcp: null, items: null })).toEqual([]);
  });

  it("orders security, then reliability, then productivity", () => {
    const input = healthy();
    input.settings!.files[0].content = {};
    input.hooks![0].command = "./x.sh";
    const sev = configTips(input).map((t) => t.severity);
    expect(sev).toEqual([...sev].sort((a, b) => order(a) - order(b)));
    expect(sev[0]).toBe("security");
  });
});

const order = (s: string) => ["security", "reliability", "productivity"].indexOf(s);
