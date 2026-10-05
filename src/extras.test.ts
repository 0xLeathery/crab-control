import { describe, expect, it } from "vitest";
import { keybindingsError, KEYBINDINGS_TEMPLATE, outputStyleTemplate } from "./extras";

describe("outputStyleTemplate", () => {
  it("writes the documented frontmatter", () => {
    const t = outputStyleTemplate("Diagrams first", "Lead with a diagram", true);
    expect(t).toBe(
      "---\nname: Diagrams first\ndescription: Lead with a diagram\nkeep-coding-instructions: true\n---\n\n"
    );
    expect(outputStyleTemplate("Writer", "", false)).toBe("---\nname: Writer\n---\n\n");
  });
});

describe("keybindingsError", () => {
  it("accepts the template and the documented shape", () => {
    expect(keybindingsError(KEYBINDINGS_TEMPLATE)).toBeNull();
    expect(
      keybindingsError('{"bindings":[{"context":"Chat","bindings":{"ctrl+e":"chat:externalEditor","ctrl+s":null}}]}')
    ).toBeNull();
  });
  it("explains what is wrong", () => {
    expect(keybindingsError("{")).toMatch(/JSON/);
    expect(keybindingsError("{}")).toMatch(/bindings/);
    expect(keybindingsError('{"bindings":[{"bindings":{}}]}')).toMatch(/context/);
    expect(keybindingsError('{"bindings":[{"context":"Chat","bindings":{"x":1}}]}')).toMatch(/action/);
  });
});
