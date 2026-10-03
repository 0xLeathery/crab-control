// PostToolUse hook: run rustfmt on a Rust file Claude just edited.
// Uses node (already a project prerequisite) so it works without jq.
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const file = JSON.parse(input).tool_input?.file_path ?? "";
if (file.endsWith(".rs")) {
  try {
    execFileSync("rustfmt", ["--edition", "2021", file], { stdio: "ignore" });
  } catch {
    // rustfmt missing or the file doesn't parse yet; clippy/CI will catch it.
  }
}
