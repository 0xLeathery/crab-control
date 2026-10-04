import { describe, expect, it } from "vitest";
import { creatableTargets, memoryStarter } from "./memory";

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
