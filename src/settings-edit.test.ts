import { describe, expect, it } from "vitest";
import { controlKind, isMasked, parseInput, settingRows } from "./settings-edit";

describe("controlKind", () => {
  it.each([
    [{ type: "boolean" }, undefined, "bool"],
    [{ type: "string", enum: ["a", "b"] }, undefined, "enum"],
    [{ type: "string" }, undefined, "string"],
    [{ type: "number" }, undefined, "number"],
    [{ type: "integer" }, undefined, "integer"],
    [{ type: ["integer", "null"] }, undefined, "integer"],
    [{ type: "array", items: { type: "string" } }, undefined, "json"],
    [{ type: "object" }, undefined, "json"],
    [{ anyOf: [{ type: "string" }, { type: "object" }] }, undefined, "json"],
    [undefined, true, "bool"],
    [undefined, 3, "number"],
    [undefined, "x", "string"],
    [undefined, { a: 1 }, "json"],
    [undefined, undefined, "json"],
  ])("%j / %j → %s", (prop, value, kind) => {
    expect(controlKind(prop as any, value)).toBe(kind);
  });
});

describe("parseInput", () => {
  it("parses numbers and rejects junk", () => {
    expect(parseInput("number", "1.5")).toEqual({ ok: true, value: 1.5 });
    expect(parseInput("number", " ").ok).toBe(false);
    expect(parseInput("number", "abc").ok).toBe(false);
  });
  it("requires whole numbers for integers", () => {
    expect(parseInput("integer", "30")).toEqual({ ok: true, value: 30 });
    expect(parseInput("integer", "1.5").ok).toBe(false);
  });
  it("keeps strings as typed", () => {
    expect(parseInput("string", " opus ")).toEqual({ ok: true, value: " opus " });
  });
  it("parses JSON and reports errors", () => {
    expect(parseInput("json", '{"a": [1]}')).toEqual({ ok: true, value: { a: [1] } });
    const bad = parseInput("json", "{nope");
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.error).toBeTruthy();
  });
  it("rejects masked values so they can't overwrite real secrets", () => {
    expect(parseInput("string", "sk-••••").ok).toBe(false);
    expect(parseInput("json", '{"KEY":"••••"}').ok).toBe(false);
  });
});

describe("isMasked", () => {
  it("finds the mask anywhere in a value", () => {
    expect(isMasked("abc")).toBe(false);
    expect(isMasked({ env: { A: "1", B: ["x", "••••"] } })).toBe(true);
    expect(isMasked(42)).toBe(false);
  });
});

describe("settingRows", () => {
  const props = {
    model: { type: "string", description: "Model to use" },
    cleanupPeriodDays: { type: "integer", description: "Days to keep transcripts" },
    verbose: { type: "boolean" },
  };
  const effective = [
    { key: "model", value: "opus", source: "user", overridden: [] },
    { key: "customThing", value: 1, source: "project", overridden: [] },
  ] as any;

  it("lists set keys, including ones the schema doesn't know", () => {
    const rows = settingRows(props, effective, { showUnset: false, filter: "" });
    expect(rows.map((r) => [r.key, r.set])).toEqual([
      ["customThing", true],
      ["model", true],
    ]);
  });

  it("adds every unset schema key on request", () => {
    const rows = settingRows(props, effective, { showUnset: true, filter: "" });
    expect(rows.map((r) => r.key)).toEqual(["cleanupPeriodDays", "customThing", "model", "verbose"]);
    const unset = rows.find((r) => r.key === "verbose")!;
    expect(unset.set).toBe(false);
    expect(unset.value).toBeUndefined();
  });

  it("filters by key or description", () => {
    const rows = settingRows(props, effective, { showUnset: true, filter: "transcripts" });
    expect(rows.map((r) => r.key)).toEqual(["cleanupPeriodDays"]);
  });
});
