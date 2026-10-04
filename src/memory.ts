// Helpers for the CLAUDE.md editor. Starter text follows the memory docs:
// keep it to facts Claude needs every session, under ~200 lines.
import type { MemoryTarget } from "./api";

export function creatableTargets(targets: MemoryTarget[]): MemoryTarget[] {
  return targets.filter((t) => !t.exists);
}

export function memoryStarter(t: MemoryTarget): string {
  if (t.source === "user") {
    return [
      "# Personal preferences",
      "",
      "<!-- Applies to every project on this machine. Keep it short. -->",
      "",
      "- ",
      "",
    ].join("\n");
  }
  if (t.source === "project-local") {
    return [
      "# Personal notes for this project",
      "",
      "<!-- Just for you: add CLAUDE.local.md to .gitignore so it isn't committed. -->",
      "",
      "- ",
      "",
    ].join("\n");
  }
  return [
    "# Project instructions",
    "",
    "<!-- Shared with your team. Tip: running /init in Claude Code can draft this for you. -->",
    "",
    "## Build and test",
    "",
    "- ",
    "",
    "## Conventions",
    "",
    "- ",
    "",
  ].join("\n");
}
