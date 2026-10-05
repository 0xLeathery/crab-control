import { describe, expect, it } from "vitest";
import { emptyHookForm, hookFormFromEntry, hookSpecFromForm, hookSummary } from "./hooks";
import type { HookEntry } from "./api";

const entry = (over: Partial<HookEntry>): HookEntry => ({
  event: "Stop",
  hookType: "command",
  source: "user",
  groupIndex: 0,
  hookIndex: 0,
  ...over,
});

describe("hookSpecFromForm", () => {
  it("builds a spec with only the fields for the chosen type", () => {
    const form = { ...emptyHookForm(), command: "fmt.sh", url: "https://x", timeout: "30" };
    expect(hookSpecFromForm(form)).toEqual({
      spec: { hookType: "command", command: "fmt.sh", timeout: 30 },
    });
    const prompt = { ...emptyHookForm(), hookType: "prompt", prompt: " ok? ", model: "haiku" };
    expect(hookSpecFromForm(prompt)).toEqual({
      spec: { hookType: "prompt", prompt: "ok?", model: "haiku" },
    });
  });

  it("reports what is missing or invalid", () => {
    expect(hookSpecFromForm(emptyHookForm()).error).toMatch(/command/i);
    expect(hookSpecFromForm({ ...emptyHookForm(), hookType: "http", url: "ftp://x" }).error).toMatch(/http/);
    expect(hookSpecFromForm({ ...emptyHookForm(), hookType: "agent" }).error).toMatch(/prompt/i);
    expect(hookSpecFromForm({ ...emptyHookForm(), command: "x", timeout: "1.5" }).error).toMatch(/timeout/i);
    expect(hookSpecFromForm({ ...emptyHookForm(), command: "curl ••••" }).error).toMatch(/masked/i);
  });
});

describe("hookFormFromEntry", () => {
  it("round-trips an entry into an editable form", () => {
    const f = hookFormFromEntry(entry({ hookType: "http", url: "https://h", timeout: 5, matcher: "Edit" }));
    expect(f).toMatchObject({ hookType: "http", url: "https://h", timeout: "5", matcher: "Edit" });
    expect(hookSpecFromForm(f).spec).toEqual({ hookType: "http", url: "https://h", timeout: 5 });
  });
});

describe("hookSummary", () => {
  it("shows the field that matters for each type", () => {
    expect(hookSummary(entry({ command: "a.sh" }))).toBe("a.sh");
    expect(hookSummary(entry({ hookType: "http", url: "https://h" }))).toBe("https://h");
    expect(hookSummary(entry({ hookType: "agent", prompt: "Check", model: "haiku" }))).toBe("Check · haiku");
  });
});
