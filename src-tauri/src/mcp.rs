//! MCP server discovery. The `claude` CLI is the source of truth for live
//! state (`claude mcp list` / `claude mcp get`); file sources (`.mcp.json`,
//! `~/.claude.json`) are merged in for completeness.
//!
//! A GUI app launched from Finder does NOT inherit the user's shell PATH, so we
//! resolve the `claude` binary deliberately rather than trusting PATH.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde_json::Value;

use crate::model::*;
use crate::secrets::{mask_command, mask_url};
use crate::util::{claude_dir, home, read_json};

static CLAUDE_BIN: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Locate the `claude` binary. Order: env override, login-shell lookup
/// (so we get the user's real PATH), then a list of common install locations.
pub fn resolve_claude() -> Option<PathBuf> {
    CLAUDE_BIN.get_or_init(resolve_claude_uncached).clone()
}

fn resolve_claude_uncached() -> Option<PathBuf> {
    // 1. Explicit override.
    if let Ok(p) = std::env::var("CLAUDE_CONTROL_CLAUDE_BIN") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    // 2. Ask the OS where `claude` is (handles the real user PATH).
    #[cfg(not(windows))]
    {
        // A GUI process has a minimal PATH, so ask a login shell.
        for shell in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
            if !PathBuf::from(shell).exists() {
                continue;
            }
            if let Ok(out) = Command::new(shell)
                .args(["-lc", "command -v claude"])
                .output()
            {
                if out.status.success() {
                    if let Some(first) = String::from_utf8_lossy(&out.stdout).lines().next() {
                        let p = PathBuf::from(first.trim());
                        if p.exists() {
                            return Some(p);
                        }
                    }
                }
            }
        }
        // Common absolute locations.
        let h = home();
        let candidates = [
            PathBuf::from("/Applications/cmux.app/Contents/Resources/bin/claude"),
            h.join(".local/bin/claude"),
            h.join(".claude/local/claude"),
            PathBuf::from("/opt/homebrew/bin/claude"),
            PathBuf::from("/usr/local/bin/claude"),
            PathBuf::from("/usr/bin/claude"),
        ];
        if let Some(p) = candidates.into_iter().find(|p| p.exists()) {
            return Some(p);
        }
    }

    #[cfg(windows)]
    {
        // `where` resolves the full path (e.g. claude.cmd) from PATH.
        if let Ok(out) = Command::new("where").arg("claude").output() {
            if out.status.success() {
                if let Some(first) = String::from_utf8_lossy(&out.stdout).lines().next() {
                    let p = PathBuf::from(first.trim());
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
        // npm global install location.
        if let Ok(appdata) = std::env::var("APPDATA") {
            for f in ["npm\\claude.cmd", "npm\\claude.exe", "npm\\claude"] {
                let p = PathBuf::from(&appdata).join(f);
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }

    // 3. Last resort: trust PATH (works when `claude` is a plain executable).
    if Command::new("claude")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some(PathBuf::from("claude"));
    }

    None
}

/// Run `claude <args>` and return combined stdout (falling back to stderr).
pub fn claude_output(args: &[&str]) -> Result<String, String> {
    let bin = resolve_claude().ok_or_else(|| "claude CLI not found".to_string())?;
    let out = Command::new(&bin)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run claude: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if stdout.trim().is_empty() {
        Ok(String::from_utf8_lossy(&out.stderr).to_string())
    } else {
        Ok(stdout)
    }
}

/// Run `claude <args>` and return (success, combined output). Checks exit code
/// so callers can distinguish real success from a CLI error message.
fn claude_run(args: &[&str]) -> Result<(bool, String), String> {
    let bin = resolve_claude().ok_or_else(|| "claude CLI not found".to_string())?;
    let out = Command::new(&bin)
        .args(args)
        .stdin(Stdio::null()) // no TTY → never hang on an interactive prompt
        .output()
        .map_err(|e| format!("failed to run claude: {e}"))?;
    let text = if out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stderr).to_string()
    } else {
        String::from_utf8_lossy(&out.stdout).to_string()
    };
    Ok((out.status.success(), strip_ansi(&text).trim().to_string()))
}

/// Remove an MCP server via the CLI. `claude mcp remove` only supports the
/// local/user/project scopes — claude.ai-account servers can't be removed here.
pub fn remove(name: &str, scope_flag: &str) -> Result<String, String> {
    if scope_flag == "claudeai" {
        return Err(
            "\"claude.ai\" servers come from your connected claude.ai account and can't be \
             removed from here. Disconnect them in claude.ai, or use Claude Code's /mcp menu."
                .into(),
        );
    }
    let mut args = vec!["mcp", "remove", name];
    if matches!(scope_flag, "local" | "user" | "project") {
        args.push("-s");
        args.push(scope_flag);
    }
    let (success, out) = claude_run(&args)?;
    if success {
        Ok(if out.is_empty() {
            format!("Removed {name}.")
        } else {
            out
        })
    } else {
        Err(if out.is_empty() {
            "claude mcp remove failed".into()
        } else {
            out
        })
    }
}

fn strip_ansi(s: &str) -> String {
    // UTF-8-safe: iterate by char so multi-byte glyphs (✔ ✗ ⏸) survive.
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // ANSI escape — consume until an ASCII letter terminator.
            while let Some(&n) = chars.peek() {
                chars.next();
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn transport_for(target: &str) -> &'static str {
    let t = target.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        // Heuristic: many SSE endpoints end in /sse.
        if t.ends_with("/sse") {
            "sse"
        } else {
            "http"
        }
    } else {
        "stdio"
    }
}

fn mask_target(target: &str) -> String {
    let t = target.trim();
    if t.starts_with("http") {
        mask_url(t)
    } else {
        mask_command(t)
    }
}

fn normalize_status(raw: &str) -> String {
    let s = raw
        .trim()
        .trim_start_matches(['✔', '✓', '✗', '!', '⏸', '·', '-', ' ']);
    s.trim().to_string()
}

/// Parse the `claude mcp list` text into servers.
fn parse_list(text: &str) -> Vec<McpServer> {
    let mut servers = Vec::new();
    for raw_line in text.lines() {
        let line = strip_ansi(raw_line);
        let line = line.trim();
        if line.is_empty() || line.ends_with(':') || line.starts_with("Checking") {
            continue;
        }
        // NAME: TARGET - STATUS    (NAME may contain spaces; TARGET may be a URL)
        let Some((name, rest)) = line.split_once(": ") else {
            continue;
        };
        let (target, status) = match rest.rsplit_once(" - ") {
            Some((t, s)) => (t.trim(), Some(normalize_status(s))),
            None => (rest.trim(), None),
        };
        servers.push(McpServer {
            name: name.trim().to_string(),
            scope: "unknown".to_string(),
            transport: transport_for(target).to_string(),
            target: Some(mask_target(target)),
            status,
            source: "claude mcp list".to_string(),
        });
    }
    servers
}

/// Enrich one server's scope/transport via `claude mcp get <name>`.
fn enrich(server: &mut McpServer) {
    let Ok(text) = claude_output(&["mcp", "get", &server.name]) else {
        return;
    };
    for raw in text.lines() {
        let line = strip_ansi(raw);
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Scope:") {
            server.scope = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("Type:") {
            let t = rest.trim().to_lowercase();
            if !t.is_empty() {
                server.transport = t;
            }
        } else if let Some(rest) = line.strip_prefix("Transport:") {
            let t = rest.trim().to_lowercase();
            if !t.is_empty() {
                server.transport = t;
            }
        }
    }
}

/// Read MCP servers defined in a JSON `mcpServers` object.
fn servers_from_map(map: &Value, scope: &str, source: &str, out: &mut Vec<McpServer>) {
    let Some(obj) = map.as_object() else {
        return;
    };
    for (name, def) in obj {
        let url = def.get("url").and_then(|u| u.as_str());
        let command = def.get("command").and_then(|c| c.as_str());
        let typ = def
            .get("type")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());
        let (transport, target) = if let Some(u) = url {
            (
                typ.clone().unwrap_or_else(|| transport_for(u).to_string()),
                Some(mask_url(u)),
            )
        } else if let Some(c) = command {
            let args = def
                .get("args")
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            let full = if args.is_empty() {
                c.to_string()
            } else {
                format!("{c} {args}")
            };
            (
                typ.clone().unwrap_or_else(|| "stdio".to_string()),
                Some(full),
            )
        } else {
            (typ.unwrap_or_else(|| "unknown".to_string()), None)
        };
        let target = target.map(|t| {
            if t.starts_with("http") {
                t
            } else {
                mask_command(&t)
            }
        });
        out.push(McpServer {
            name: name.clone(),
            scope: scope.to_string(),
            transport,
            target,
            status: None,
            source: source.to_string(),
        });
    }
}

pub fn get_mcp(scope: &Scope) -> Vec<McpServer> {
    let mut servers = match claude_output(&["mcp", "list"]) {
        Ok(text) => parse_list(&text),
        Err(_) => Vec::new(),
    };

    // Enrich each with scope/transport in parallel (bounded by server count).
    let handles: Vec<_> = servers
        .drain(..)
        .map(|mut s| {
            std::thread::spawn(move || {
                enrich(&mut s);
                s
            })
        })
        .collect();
    let mut servers: Vec<McpServer> = handles.into_iter().filter_map(|h| h.join().ok()).collect();

    // Merge file-defined servers the CLI didn't surface.
    let mut file_servers: Vec<McpServer> = Vec::new();

    // Top-level user mcpServers in ~/.claude.json.
    if let Ok(Some(v)) = read_json(&home().join(".claude.json")) {
        if let Some(m) = v.get("mcpServers") {
            servers_from_map(m, "user", "~/.claude.json", &mut file_servers);
        }
        // Per-project block for the active scope.
        if let Scope {
            kind: ScopeKind::Project,
            path: Some(p),
        } = scope
        {
            if let Some(proj) = v.get("projects").and_then(|x| x.get(p)) {
                if let Some(m) = proj.get("mcpServers") {
                    servers_from_map(m, "local", "~/.claude.json (project)", &mut file_servers);
                }
            }
        }
    }

    // Project .mcp.json (committed, shared servers).
    if let Scope {
        kind: ScopeKind::Project,
        path: Some(p),
    } = scope
    {
        let mcp_json = PathBuf::from(p).join(".mcp.json");
        if let Ok(Some(v)) = read_json(&mcp_json) {
            if let Some(m) = v.get("mcpServers") {
                servers_from_map(m, "project (.mcp.json)", ".mcp.json", &mut file_servers);
            }
        }
    }
    let _ = claude_dir(); // (reserved for future file sources)

    for fs in file_servers {
        if !servers.iter().any(|s| s.name == fs.name) {
            servers.push(fs);
        }
    }

    servers.sort_by_key(|a| a.name.to_lowercase());
    servers
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn file_defined_stdio_args_are_masked() {
        let map = json!({
            "gh": { "command": "npx", "args": ["-y", "gh-mcp", "--token", "abc123plain"] },
            "pat": { "command": "srv", "args": ["ghp_abcdefghijklmnopqrst"] }
        });
        let mut out = Vec::new();
        servers_from_map(&map, "user", "test", &mut out);
        let targets: Vec<String> = out.iter().filter_map(|s| s.target.clone()).collect();
        let joined = targets.join(" | ");
        assert!(!joined.contains("abc123plain"), "leaked: {joined}");
        assert!(!joined.contains("abcdefghijklmnopqrst"), "leaked: {joined}");
        assert!(joined.contains("npx -y gh-mcp --token ••••"), "{joined}");
    }

    #[test]
    fn cli_list_stdio_targets_are_masked() {
        let servers = parse_list("gh: npx -y gh-mcp --api-key abc123plain - ✓ Connected\n");
        assert_eq!(servers.len(), 1);
        assert_eq!(
            servers[0].target.as_deref(),
            Some("npx -y gh-mcp --api-key ••••")
        );
        assert_eq!(servers[0].status.as_deref(), Some("Connected"));
    }
}
