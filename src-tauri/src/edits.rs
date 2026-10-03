//! Structured edits (plugin/MCP toggles, schema-form field edits). Each
//! operation produces a *preview* — the target layer plus old and new file
//! text — which the UI shows as a diff for confirmation, then commits through
//! the same `writer::save_settings` safety pipeline (backup → validate →
//! atomic write). This keeps exactly one write path.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;

use crate::model::{Layer, Scope, ScopeKind};
use crate::settings::layer_path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreview {
    pub layer: Layer,
    pub layer_label: String,
    pub display_path: String,
    pub old_text: String,
    pub new_text: String,
    pub note: String,
}

/// Default writable layer for a scope (where structured edits land).
pub fn default_write_layer(scope: &Scope) -> Layer {
    match scope.kind {
        ScopeKind::Project => Layer::Project,
        ScopeKind::Global => Layer::User,
    }
}

fn pretty(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".into());
    s.push('\n');
    s
}

/// Load the current parsed value + raw text of an editable layer file.
fn current(scope: &Scope, layer: Layer) -> Result<(PathBuf, Value, String), String> {
    let (path, read_only) =
        layer_path(scope, layer).ok_or_else(|| "layer not available for this scope".to_string())?;
    if read_only {
        return Err("target layer is read-only".into());
    }
    let old_text = if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let value = if old_text.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str::<Value>(&old_text)
            .map_err(|e| format!("current file is not valid JSON: {e}"))?
    };
    Ok((path, value, old_text))
}

fn set_in(value: &mut Value, path: &[String], new: Value) {
    if path.is_empty() {
        return;
    }
    if !value.is_object() {
        *value = Value::Object(Default::default());
    }
    if let Value::Object(map) = value {
        if path.len() == 1 {
            map.insert(path[0].clone(), new);
        } else {
            let child = map
                .entry(path[0].clone())
                .or_insert_with(|| Value::Object(Default::default()));
            set_in(child, &path[1..], new);
        }
    }
}

fn remove_in(value: &mut Value, path: &[String]) {
    if path.is_empty() {
        return;
    }
    if let Value::Object(map) = value {
        if path.len() == 1 {
            map.remove(&path[0]);
        } else if let Some(child) = map.get_mut(&path[0]) {
            remove_in(child, &path[1..]);
        }
    }
}

fn build_preview(
    scope: &Scope,
    layer: Layer,
    note: String,
    mutate: impl FnOnce(&mut Value),
) -> Result<MutationPreview, String> {
    let (path, mut value, old_text) = current(scope, layer)?;
    mutate(&mut value);
    let new_text = pretty(&value);
    Ok(MutationPreview {
        layer,
        layer_label: layer.label().to_string(),
        display_path: crate::util::tildify(&path),
        old_text,
        new_text,
        note,
    })
}

/// Preview setting a (possibly nested) key to a JSON value.
pub fn preview_set_key(
    scope: &Scope,
    layer: Layer,
    key_path: Vec<String>,
    value: Value,
) -> Result<MutationPreview, String> {
    let note = format!("Set {}", key_path.join("."));
    build_preview(scope, layer, note, move |v| set_in(v, &key_path, value))
}

/// Preview removing a (possibly nested) key.
pub fn preview_remove_key(
    scope: &Scope,
    layer: Layer,
    key_path: Vec<String>,
) -> Result<MutationPreview, String> {
    let note = format!("Remove {}", key_path.join("."));
    build_preview(scope, layer, note, move |v| remove_in(v, &key_path))
}

/// Preview enabling/disabling a plugin via `enabledPlugins`.
pub fn preview_plugin_toggle(
    scope: &Scope,
    full_id: &str,
    enabled: bool,
) -> Result<MutationPreview, String> {
    let layer = default_write_layer(scope);
    let note = format!(
        "{} plugin {full_id}",
        if enabled { "Enable" } else { "Disable" }
    );
    let key = full_id.to_string();
    build_preview(scope, layer, note, move |v| {
        set_in(
            v,
            &["enabledPlugins".to_string(), key],
            Value::Bool(enabled),
        )
    })
}

/// Preview enabling/disabling a project `.mcp.json` server via the
/// enabled/disabled MCP-server settings lists.
pub fn preview_mcp_toggle(
    scope: &Scope,
    name: &str,
    enabled: bool,
) -> Result<MutationPreview, String> {
    let layer = default_write_layer(scope);
    let add_key = if enabled {
        "enabledMcpjsonServers"
    } else {
        "disabledMcpjsonServers"
    };
    let del_key = if enabled {
        "disabledMcpjsonServers"
    } else {
        "enabledMcpjsonServers"
    };
    let name = name.to_string();
    let note = format!(
        "{} MCP server {name}",
        if enabled { "Enable" } else { "Disable" }
    );
    build_preview(scope, layer, note, move |v| {
        // add to add_key list (dedup)
        let list = ensure_array(v, add_key);
        if !list.iter().any(|x| x.as_str() == Some(name.as_str())) {
            list.push(Value::String(name.clone()));
        }
        // remove from the opposite list
        if let Value::Object(map) = v {
            if let Some(Value::Array(other)) = map.get_mut(del_key) {
                other.retain(|x| x.as_str() != Some(name.as_str()));
            }
        }
    })
}

fn ensure_array<'a>(v: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    if !v.is_object() {
        *v = Value::Object(Default::default());
    }
    let map = v.as_object_mut().unwrap();
    let entry = map
        .entry(key.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if !entry.is_array() {
        *entry = Value::Array(Vec::new());
    }
    entry.as_array_mut().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project() -> (Scope, PathBuf) {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let proj = std::env::temp_dir().join(format!("cc-edits-{ms}"));
        std::fs::create_dir_all(proj.join(".claude")).unwrap();
        std::fs::write(
            proj.join(".claude/settings.json"),
            "{\n  \"theme\": \"dark\"\n}\n",
        )
        .unwrap();
        (
            Scope {
                kind: ScopeKind::Project,
                path: Some(proj.display().to_string()),
            },
            proj,
        )
    }

    #[test]
    fn plugin_toggle_preview_adds_key() {
        let (scope, proj) = temp_project();
        let p = preview_plugin_toggle(&scope, "foo@bar", false).unwrap();
        assert!(p.old_text.contains("\"theme\""));
        assert!(p.new_text.contains("\"enabledPlugins\""));
        assert!(p.new_text.contains("\"foo@bar\": false"));
        // Original key is preserved.
        assert!(p.new_text.contains("\"theme\": \"dark\""));
        std::fs::remove_dir_all(&proj).ok();
    }

    #[test]
    fn set_and_remove_nested_key() {
        let (scope, proj) = temp_project();
        let layer = default_write_layer(&scope);
        let set = preview_set_key(
            &scope,
            layer,
            vec!["model".into()],
            Value::String("opus".into()),
        )
        .unwrap();
        assert!(set.new_text.contains("\"model\": \"opus\""));

        let rm = preview_remove_key(&scope, layer, vec!["theme".into()]).unwrap();
        assert!(!rm.new_text.contains("\"theme\""));
        std::fs::remove_dir_all(&proj).ok();
    }

    #[test]
    fn mcp_toggle_moves_between_lists() {
        let (scope, proj) = temp_project();
        let dis = preview_mcp_toggle(&scope, "srv", false).unwrap();
        assert!(dis.new_text.contains("\"disabledMcpjsonServers\""));
        assert!(dis.new_text.contains("\"srv\""));
        std::fs::remove_dir_all(&proj).ok();
    }
}
