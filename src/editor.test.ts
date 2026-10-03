import { describe, expect, it } from "vitest";
import { lineDiff } from "./editor";

describe("lineDiff", () => {
  it("marks identical text as context only", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual([
      { type: "ctx", text: "a" },
      { type: "ctx", text: "b" },
    ]);
  });

  it("reports a changed line as delete then add", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual([
      { type: "ctx", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "B" },
      { type: "ctx", text: "c" },
    ]);
  });

  it("handles pure additions and removals at the ends", () => {
    expect(lineDiff("a", "a\nb")).toEqual([
      { type: "ctx", text: "a" },
      { type: "add", text: "b" },
    ]);
    expect(lineDiff("x\na", "a")).toEqual([
      { type: "del", text: "x" },
      { type: "ctx", text: "a" },
    ]);
  });
});
