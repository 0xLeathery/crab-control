import { describe, expect, it } from "vitest";
import {
  needsTrustWarning,
  pluginActionLabel,
  isPluginServer,
  joinArgs,
  splitArgs,
  defaultWriteLayer,
  editableLayers,
  fmtTime,
  mcpScopeFlag,
  permissionRules,
  relativeTime,
  statusClass,
} from "./helpers";

describe("defaultWriteLayer", () => {
  it("writes to the project layer in project scope, else user", () => {
    expect(defaultWriteLayer({ kind: "project", path: "/p" })).toBe("project");
    expect(defaultWriteLayer({ kind: "global" })).toBe("user");
  });
});

describe("fmtTime", () => {
  it("renders missing or zero times as a dash", () => {
    expect(fmtTime(null)).toBe("—");
    expect(fmtTime(undefined)).toBe("—");
    expect(fmtTime(0)).toBe("—");
    expect(fmtTime("nope")).toBe("—");
  });
  it("formats epoch ms, including numeric strings", () => {
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(fmtTime(ms)).toBe(new Date(ms).toLocaleString());
    expect(fmtTime(String(ms))).toBe(new Date(ms).toLocaleString());
  });
});

describe("statusClass", () => {
  it.each([
    [null, "muted"],
    ["✓ Connected", "ok"],
    ["Failed to connect", "error"],
    ["Needs authentication", "warn"],
    ["pending", "warn"],
    ["error", "error"],
    ["something else", "muted"],
  ])("%s → %s", (status, cls) => {
    expect(statusClass(status)).toBe(cls);
  });
});

describe("mcpScopeFlag", () => {
  it.each([
    ["claude.ai", "claudeai"],
    ["user", "user"],
    ["local", "local"],
    ["project (.mcp.json)", "project"],
    ["Project config (shared via .mcp.json)", "project"],
    ["", "user"],
    ["unknown", "user"],
  ])("%s → %s", (scope, flag) => {
    expect(mcpScopeFlag({ scope })).toBe(flag);
  });
});

describe("bugs", () => {
  it.each(["Disconnected", "✗ Not connected"])("%s is not shown as ok", (status) => {
    expect(statusClass(status)).not.toBe("ok");
  });

  // `claude mcp get` reports scope as a sentence; its other words mention
  // "project" even for user/local servers.
  it.each([
    ["User config (available in all your projects)", "user"],
    ["Local config (private to you in this project)", "local"],
    ["Project config (shared via .mcp.json)", "project"],
  ])("%s → %s", (scope, flag) => {
    expect(mcpScopeFlag({ scope })).toBe(flag);
  });
});

describe("permissionRules", () => {
  const file = (layer: string, readOnly: boolean, content: unknown) =>
    ({ layer, readOnly, content, label: layer, path: "", displayPath: "", present: true, error: null }) as any;

  it("flattens allow/deny/ask per layer in file order", () => {
    const files = [
      file("user", false, { permissions: { deny: ["Read(.env)"], allow: ["Bash(ls)", "WebFetch"] } }),
      file("project", false, { theme: "dark" }),
      file("managed", true, { permissions: { ask: ["Bash(rm:*)"] } }),
      file("project-local", false, null),
    ];
    expect(permissionRules(files)).toEqual([
      { layer: "user", list: "allow", rule: "Bash(ls)", readOnly: false },
      { layer: "user", list: "allow", rule: "WebFetch", readOnly: false },
      { layer: "user", list: "deny", rule: "Read(.env)", readOnly: false },
      { layer: "managed", list: "ask", rule: "Bash(rm:*)", readOnly: true },
    ]);
  });

  it("ignores malformed lists", () => {
    expect(permissionRules([file("user", false, { permissions: { allow: "Bash" } })])).toEqual([]);
  });
});

describe("editableLayers", () => {
  it("lists layers that are not read-only", () => {
    const files = [
      { layer: "user", readOnly: false },
      { layer: "managed", readOnly: true },
      { layer: "project", readOnly: false },
    ] as any;
    expect(editableLayers(files)).toEqual(["user", "project"]);
  });
});

describe("relativeTime", () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0);
  it.each([
    [now - 20_000, "just now"],
    [now - 5 * 60_000, "5 min ago"],
    [now - 3 * 3_600_000, "3 h ago"],
    [now - 2 * 86_400_000, "2 days ago"],
    [now - 86_400_000, "1 day ago"],
  ])("%s → %s", (ms, label) => {
    expect(relativeTime(ms, now)).toBe(label);
  });
});

describe("joinArgs / splitArgs", () => {
  it("round-trips args with spaces and quotes", () => {
    const args = ["-y", "my server", "--name=it's", 'say "hi"', ""];
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });
  it("splits plain and quoted text", () => {
    expect(splitArgs(`a  "b c" 'd e' f\\ g`)).toEqual(["a", "b c", "d e", "f g"]);
    expect(joinArgs(["a", "b c"])).toBe(`a "b c"`);
  });
});

describe("isPluginServer", () => {
  it("spots plugin servers by scope or CLI name", () => {
    expect(isPluginServer({ name: "db", scope: "plugin" })).toBe(true);
    expect(isPluginServer({ name: "plugin:deploy:db", scope: "unknown" })).toBe(true);
    expect(isPluginServer({ name: "gh", scope: "User config" })).toBe(false);
  });
});

describe("plugin actions", () => {
  it("warns about third-party code only when adding code", () => {
    expect(needsTrustWarning("install")).toBe(true);
    expect(needsTrustWarning("marketplace-add")).toBe(true);
    expect(needsTrustWarning("update")).toBe(true);
    expect(needsTrustWarning("uninstall")).toBe(false);
    expect(needsTrustWarning("marketplace-remove")).toBe(false);
  });
  it("names each action for its confirm button", () => {
    expect(pluginActionLabel("install")).toBe("Install");
    expect(pluginActionLabel("marketplace-update")).toBe("Update marketplace");
    expect(pluginActionLabel("uninstall")).toBe("Uninstall");
  });
});
