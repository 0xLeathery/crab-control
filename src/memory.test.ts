import { describe, expect, it } from "vitest";
import { creatableTargets, isEditableItem, memoryStarter, ruleTemplate } from "./memory";

const t = (name: string, source: string, exists: boolean) =>
  ({ name, source, exists, path: `/p/${name}`, displayPath: name }) as any;

describe("creatableTargets", () => {
  it("offers only the standard files that don't exist yet", () => {
    const targets = [t("CLAUDE.md", "user", true), t("CLAUDE.md", "project", false), t("CLAUDE.local.md", "project-local", false)];
    expect(creatableTargets(targets).map((x) => `${x.source}:${x.name}`)).toEqual([
      "project:CLAUDE.md",
      "project-local:CLAUDE.local.md",
    ]);
  });
});

describe("memoryStarter", () => {
  it("starts a project CLAUDE.md with the sections the docs recommend", () => {
    const s = memoryStarter(t("CLAUDE.md", "project", false));
    expect(s).toMatch(/^# /);
    expect(s).toMatch(/build|test/i);
    expect(s).toMatch(/\/init/);
  });
  it("reminds that CLAUDE.local.md should be gitignored", () => {
    expect(memoryStarter(t("CLAUDE.local.md", "project-local", false))).toMatch(/\.gitignore/);
  });
  it("frames the user file as personal preferences for every project", () => {
    expect(memoryStarter(t("CLAUDE.md", "user", false))).toMatch(/every project/i);
  });
});

describe("ruleTemplate", () => {
  it("adds paths frontmatter only when patterns are given", () => {
    expect(ruleTemplate("testing", "")).toBe("# testing\n\n- \n");
    expect(ruleTemplate("api", " src/api/**/*.ts , lib/*.ts ")).toBe(
      '---\npaths:\n  - "src/api/**/*.ts"\n  - "lib/*.ts"\n---\n\n# api\n\n- \n'
    );
  });
});

describe("isEditableItem", () => {
  it("allows user and project items, not plugin ones", () => {
    expect(isEditableItem({ source: "user" } as any)).toBe(true);
    expect(isEditableItem({ source: "project" } as any)).toBe(true);
    expect(isEditableItem({ source: "plugin:fmt@mkt" } as any)).toBe(false);
  });
});
