//! Hooks and MCP servers that installed plugins contribute. They are shown
//! read-only: a plugin owns its files, and updates would overwrite edits.

use std::path::{Component, Path, PathBuf};

use serde_json::{Map, Value};

use crate::model::{HookEntry, Layer, McpServer};
use crate::util::read_json;

fn manifest(root: &Path) -> Value {
    read_json(&root.join(".claude-plugin/plugin.json"))
        .ok()
        .flatten()
        .unwrap_or(Value::Null)
}

/// A manifest path: must start with `./` and stay inside the plugin.
fn inside(root: &Path, rel: &str) -> Option<PathBuf> {
    let escapes = Path::new(rel)
        .components()
        .any(|c| matches!(c, Component::ParentDir));
    (rel.starts_with("./") && !escapes).then(|| root.join(rel))
}

/// Component keys take one value or an array of them.
fn entries(v: Option<&Value>) -> Vec<&Value> {
    match v {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(x) => vec![x],
        None => Vec::new(),
    }
}

fn read(path: Option<PathBuf>) -> Option<Value> {
    read_json(&path?).ok().flatten()
}

/// Hooks from `hooks/hooks.json` plus whatever `plugin.json` declares.
pub fn plugin_hooks(label: &str, root: &Path) -> Vec<HookEntry> {
    let mut files: Vec<Value> = read(Some(root.join("hooks/hooks.json")))
        .into_iter()
        .collect();
    for e in entries(manifest(root).get("hooks")) {
        match e {
            // Hook files carry a top-level "hooks" wrapper; inline maps don't.
            Value::String(rel) => files.extend(read(inside(root, rel))),
            Value::Object(_) => files.push(serde_json::json!({ "hooks": e })),
            _ => {}
        }
    }
    files
        .iter()
        .flat_map(|v| crate::settings::hooks_in(v, Layer::User))
        .map(|h| HookEntry {
            plugin: Some(label.to_string()),
            ..h
        })
        .collect()
}

/// A server map from a JSON file, with or without an `mcpServers` wrapper.
fn server_map(v: &Value) -> Option<&Map<String, Value>> {
    v.get("mcpServers").unwrap_or(v).as_object()
}

/// Servers from `.mcp.json` plus whatever `plugin.json` declares, named the
/// way the CLI lists them (`plugin:<plugin>:<server>`). Bundles are skipped.
pub fn plugin_mcp(label: &str, root: &Path) -> Vec<McpServer> {
    let mut map = Map::new();
    let mut merge = |m: &Map<String, Value>| {
        for (k, v) in m.iter().filter(|(_, v)| v.is_object()) {
            map.insert(k.clone(), v.clone());
        }
    };
    if let Some(v) = read(Some(root.join(".mcp.json"))) {
        server_map(&v).map(&mut merge);
    }
    for e in entries(manifest(root).get("mcpServers")) {
        match e {
            Value::String(rel) if rel.ends_with(".json") => {
                if let Some(v) = read(inside(root, rel)) {
                    server_map(&v).map(&mut merge);
                }
            }
            Value::Object(m) => merge(m),
            _ => {}
        }
    }
    let plugin = label
        .trim_start_matches("plugin:")
        .split('@')
        .next()
        .unwrap_or(label);
    let mut out = Vec::new();
    crate::mcp::servers_from_map(&Value::Object(map), "plugin", label, &mut out);
    for s in &mut out {
        s.name = format!("plugin:{plugin}:{}", s.name);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "cc-plugin-src-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let w = |rel: &str, s: &str| {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, s).unwrap();
        };
        w(
            "hooks/hooks.json",
            r#"{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[{"type":"command","command":"fmt.sh"}]}]}}"#,
        );
        w(
            "config/extra.json",
            r#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"notify.sh --token abc123plain"}]}]}}"#,
        );
        w(
            ".claude-plugin/plugin.json",
            r#"{"name":"deploy",
                "hooks":["./config/extra.json","../escape.json",
                         {"SessionStart":[{"hooks":[{"type":"prompt","prompt":"hi"}]}]}],
                "mcpServers":["./bundle.mcpb",{"api":{"type":"http","url":"https://api.dev/mcp"}}]}"#,
        );
        w(
            ".mcp.json",
            r#"{"mcpServers":{"db":{"command":"node","args":["db.js"],"env":{"PW":"secret"}}}}"#,
        );
        root
    }

    #[test]
    fn collects_plugin_hooks_from_file_and_manifest() {
        let root = plugin();
        let hooks = plugin_hooks("plugin:deploy@market", &root);
        let got: Vec<(String, String, Option<String>)> = hooks
            .iter()
            .map(|h| (h.event.clone(), h.hook_type.clone(), h.command.clone()))
            .collect();
        let s = |x: &str| Some(x.to_string());
        assert_eq!(
            got,
            vec![
                ("PostToolUse".into(), "command".into(), s("fmt.sh")),
                ("Stop".into(), "command".into(), s("notify.sh --token ••••")),
                ("SessionStart".into(), "prompt".into(), None),
            ]
        );
        assert!(hooks
            .iter()
            .all(|h| h.plugin.as_deref() == Some("plugin:deploy@market")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn collects_plugin_mcp_servers() {
        let root = plugin();
        let servers = plugin_mcp("plugin:deploy@market", &root);
        let names: Vec<&str> = servers.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["plugin:deploy:db", "plugin:deploy:api"]);
        assert!(servers.iter().all(|s| s.scope == "plugin"));
        assert!(servers[0].inline_secrets, "literal env value is flagged");
        assert_eq!(servers[1].transport, "http");
        std::fs::remove_dir_all(&root).ok();
    }
}
