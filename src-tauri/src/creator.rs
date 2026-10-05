//! Phase 3 — creation flows + snapshot export.
//! - Scaffold new agents / commands / skills as files (no overwrite, atomic).
//! - Add an MCP server via `claude mcp add`.
//! - Export a masked, read-only snapshot of the config.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::model::{Scope, ScopeKind};
use crate::util::{claude_dir, home, tildify};

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Base `.claude` dir for the scope (user vs project).
fn base_dir(scope: &Scope) -> Result<PathBuf, String> {
    match scope.kind {
        ScopeKind::Global => Ok(claude_dir()),
        ScopeKind::Project => scope
            .path
            .as_ref()
            .map(|p| PathBuf::from(p).join(".claude"))
            .ok_or_else(|| "no project path".into()),
    }
}

/// Names must be a single safe path segment — no separators or traversal.
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("name is required".into());
    }
    if name.len() > 80 {
        return Err("name too long".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("name may only contain letters, numbers, '.', '-', '_'".into());
    }
    if name.starts_with('.') || name.contains("..") {
        return Err("invalid name".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    pub path: String,
    pub display_path: String,
}

/// Create a new agent/command/skill file. Refuses to overwrite an existing one.
pub fn create_item(
    scope: &Scope,
    kind: &str,
    name: &str,
    content: &str,
) -> Result<CreateResult, String> {
    validate_name(name)?;
    let base = base_dir(scope)?;
    let path = match kind {
        "agent" => base.join("agents").join(format!("{name}.md")),
        "command" => base.join("commands").join(format!("{name}.md")),
        "skill" => base.join("skills").join(name).join("SKILL.md"),
        "rule" => base.join("rules").join(format!("{name}.md")),
        _ => return Err(format!("unknown item kind: {kind}")),
    };
    if path.exists() {
        return Err(format!("already exists: {}", tildify(&path)));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create dir: {e}"))?;
    }
    // Atomic write (temp + rename) for consistency with the rest of the app.
    let tmp = path.with_file_name(format!(
        "{}.tmp.{}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("new"),
        now_ms()
    ));
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename failed: {e}")
    })?;
    Ok(CreateResult {
        display_path: tildify(&path),
        path: path.display().to_string(),
    })
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAddSpec {
    pub name: String,
    pub transport: String, // stdio | http | sse
    pub target: String,    // command (stdio) or url (http/sse)
    pub scope: String,     // local | user | project
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<String>, // "KEY=VALUE"
    #[serde(default)]
    pub headers: Vec<String>, // "Header: value"
}

/// Build the argv for `claude mcp add` from a spec (also used to preview it).
pub fn mcp_add_argv(spec: &McpAddSpec) -> Vec<String> {
    let mut a: Vec<String> = vec!["mcp".into(), "add".into()];
    let is_http = spec.transport == "http" || spec.transport == "sse";
    if is_http {
        a.push("--transport".into());
        a.push(spec.transport.clone());
    }
    a.push(spec.name.clone());
    if is_http {
        a.push(spec.target.clone());
        for h in &spec.headers {
            a.push("--header".into());
            a.push(h.clone());
        }
    }
    a.push("-s".into());
    a.push(spec.scope.clone());
    if !is_http {
        for e in &spec.env {
            a.push("-e".into());
            a.push(e.clone());
        }
        a.push("--".into());
        a.push(spec.target.clone());
        for arg in &spec.args {
            a.push(arg.clone());
        }
    }
    a
}

/// A human-readable `claude mcp add …` preview with secret values masked
/// (env values after `=`, header values after `:`).
pub fn mcp_add_display(spec: &McpAddSpec) -> String {
    let argv = mcp_add_argv(spec);
    let mut out: Vec<String> = vec!["claude".into()];
    let mut i = 0;
    while i < argv.len() {
        let tok = &argv[i];
        if tok == "-e" && i + 1 < argv.len() {
            let kv = &argv[i + 1];
            let masked = match kv.split_once('=') {
                Some((k, _)) => format!("{k}=••••"),
                None => kv.clone(),
            };
            out.push("-e".into());
            out.push(masked);
            i += 2;
            continue;
        }
        if tok == "--header" && i + 1 < argv.len() {
            let hv = &argv[i + 1];
            let masked = match hv.split_once(':') {
                Some((k, _)) => format!("{k}: ••••"),
                None => hv.clone(),
            };
            out.push("--header".into());
            out.push(format!("\"{masked}\""));
            i += 2;
            continue;
        }
        out.push(tok.clone());
        i += 1;
    }
    crate::secrets::mask_command(&out.join(" "))
}

/// Add an MCP server via the CLI.
pub fn mcp_add(spec: &McpAddSpec) -> Result<String, String> {
    if spec.name.trim().is_empty() || spec.target.trim().is_empty() {
        return Err("name and command/URL are required".into());
    }
    let argv = mcp_add_argv(spec);
    let refs: Vec<&str> = argv.iter().map(|s| s.as_str()).collect();
    let (success, out) = crate::mcp::claude_run(&refs)?;
    crate::mcp::cli_result(
        success,
        &crate::secrets::mask_command(&out),
        &format!("Added {}.", spec.name),
        "claude mcp add failed",
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub display_path: String,
    pub bytes: usize,
}

fn snapshots_dir() -> PathBuf {
    let dl = home().join("Downloads");
    if dl.is_dir() {
        dl
    } else {
        home()
    }
}

/// Export a masked, read-only snapshot of the config for the scope.
/// Secrets are masked (this is NOT a credential backup). Writes one JSON file
/// into `dest` (defaults to ~/Downloads, else home).
pub fn export_snapshot(scope: &Scope, dest: Option<PathBuf>) -> Result<ExportResult, String> {
    let settings = crate::settings::get_settings(scope); // already masked
    let plugins = crate::plugins::get_plugins(scope);
    let items = crate::items::get_items(scope);
    let hooks = crate::settings::get_hooks(scope);

    let scope_json = match scope.kind {
        ScopeKind::Global => json!({ "kind": "global" }),
        ScopeKind::Project => json!({ "kind": "project", "path": scope.path }),
    };

    let snapshot: Value = json!({
        "tool": "crab-control",
        "version": env!("CARGO_PKG_VERSION"),
        "exportedAtMs": now_ms().to_string(),
        "note": "Read-only config snapshot. Secrets are masked and will NOT round-trip.",
        "scope": scope_json,
        "settings": settings,
        "plugins": plugins,
        "items": items,
        "hooks": hooks,
    });

    let text = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    let dir = dest.unwrap_or_else(snapshots_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create dir: {e}"))?;
    let fname = format!("crab-control-snapshot-{}.json", now_ms());
    let path = dir.join(fname);
    std::fs::write(&path, text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    Ok(ExportResult {
        display_path: tildify(&path),
        path: path.display().to_string(),
        bytes: text.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_names() {
        assert!(validate_name("../evil").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name(".hidden").is_err());
        assert!(validate_name("good-name_1.2").is_ok());
    }

    #[test]
    fn creates_rule_files() {
        let dir = std::env::temp_dir().join(format!("cc-rule-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let scope = Scope {
            kind: ScopeKind::Project,
            path: Some(dir.display().to_string()),
        };
        let r = create_item(&scope, "rule", "testing", "# Testing\n").unwrap();
        assert!(r.path.ends_with(".claude/rules/testing.md"), "{}", r.path);
        assert!(create_item(&scope, "rule", "testing", "x").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn creates_command_and_refuses_overwrite() {
        let proj = std::env::temp_dir().join(format!("cc-create-{}", now_ms()));
        std::fs::create_dir_all(&proj).unwrap();
        let scope = Scope {
            kind: ScopeKind::Project,
            path: Some(proj.display().to_string()),
        };
        let r = create_item(&scope, "command", "hello", "# hello\n").unwrap();
        assert!(proj.join(".claude/commands/hello.md").exists());
        assert!(r.display_path.ends_with("hello.md"));
        // Second create must refuse.
        assert!(create_item(&scope, "command", "hello", "x").is_err());
        std::fs::remove_dir_all(&proj).ok();
    }

    #[test]
    fn export_writes_valid_masked_snapshot() {
        let dir = std::env::temp_dir().join(format!("cc-export-{}", now_ms()));
        let scope = Scope {
            kind: ScopeKind::Global,
            path: None,
        };
        let r = export_snapshot(&scope, Some(dir.clone())).unwrap();
        let text = std::fs::read_to_string(&r.path).unwrap();
        // Valid JSON, carries the tool tag, and never leaks a known raw secret.
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v.get("tool").and_then(|t| t.as_str()), Some("crab-control"));
        assert!(v.get("settings").is_some());
        assert!(!text.contains("ib_5c7753"), "snapshot leaked a raw secret!");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_add_display_masks_secret_args_and_url_credentials() {
        let stdio = McpAddSpec {
            name: "srv".into(),
            transport: "stdio".into(),
            target: "npx".into(),
            scope: "user".into(),
            args: vec!["gh-mcp".into(), "--token".into(), "abc123plain".into()],
            env: vec![],
            headers: vec![],
        };
        let d = mcp_add_display(&stdio);
        assert!(!d.contains("abc123plain"), "leaked: {d}");
        assert!(d.ends_with("-- npx gh-mcp --token ••••"), "{d}");

        let http = McpAddSpec {
            name: "h".into(),
            transport: "http".into(),
            target: "https://bob:hunter2pass@x.dev/mcp".into(),
            scope: "user".into(),
            args: vec![],
            env: vec![],
            headers: vec![],
        };
        let d = mcp_add_display(&http);
        assert!(!d.contains("hunter2"), "leaked: {d}");
    }

    #[test]
    fn builds_mcp_add_argv() {
        let stdio = McpAddSpec {
            name: "srv".into(),
            transport: "stdio".into(),
            target: "npx".into(),
            scope: "user".into(),
            args: vec!["my-mcp".into()],
            env: vec!["API_KEY=x".into()],
            headers: vec![],
        };
        let a = mcp_add_argv(&stdio);
        assert_eq!(
            a,
            vec![
                "mcp",
                "add",
                "srv",
                "-s",
                "user",
                "-e",
                "API_KEY=x",
                "--",
                "npx",
                "my-mcp"
            ]
        );

        let http = McpAddSpec {
            name: "h".into(),
            transport: "http".into(),
            target: "https://x/mcp".into(),
            scope: "user".into(),
            args: vec![],
            env: vec![],
            headers: vec!["Authorization: Bearer t".into()],
        };
        let a = mcp_add_argv(&http);
        assert_eq!(
            a,
            vec![
                "mcp",
                "add",
                "--transport",
                "http",
                "h",
                "https://x/mcp",
                "--header",
                "Authorization: Bearer t",
                "-s",
                "user"
            ]
        );
    }
}
