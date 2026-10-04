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
    if crate::secrets::contains_mask(&value) {
        return Err(
            "value contains masked secrets (••••); edit this file in the raw editor".into(),
        );
    }
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

const PERMISSION_LISTS: &[&str] = &["allow", "deny", "ask"];

/// Add or remove one rule in `permissions.<list>`. Empty lists/objects left
/// behind by a removal are dropped so the file stays tidy.
pub fn apply_permission_rule(
    v: &mut Value,
    list: &str,
    rule: &str,
    add: bool,
) -> Result<(), String> {
    if !PERMISSION_LISTS.contains(&list) {
        return Err(format!("unknown permission list: {list}"));
    }
    let rule = rule.trim();
    if rule.is_empty() {
        return Err("rule is empty".into());
    }
    if add {
        let perms = object_entry(v, "permissions");
        let arr = ensure_array(perms, list);
        if !arr.iter().any(|x| x.as_str() == Some(rule)) {
            arr.push(Value::String(rule.to_string()));
        }
    } else if let Some(perms) = v.get_mut("permissions") {
        if let Some(Value::Array(arr)) = perms.get_mut(list) {
            arr.retain(|x| x.as_str() != Some(rule));
        }
        prune_empty(perms, list);
        prune_empty(v, "permissions");
    }
    Ok(())
}

pub fn preview_permission_rule(
    scope: &Scope,
    layer: Layer,
    list: &str,
    rule: &str,
    add: bool,
) -> Result<MutationPreview, String> {
    // Validate up front so a bad request never reaches the preview.
    apply_permission_rule(&mut Value::Object(Default::default()), list, rule, true)?;
    let note = format!(
        "{} permissions.{list} rule {}",
        if add { "Add" } else { "Remove" },
        rule.trim()
    );
    let (list, rule) = (list.to_string(), rule.to_string());
    build_preview(scope, layer, note, move |v| {
        let _ = apply_permission_rule(v, &list, &rule, add);
    })
}

/// Append a command hook to `hooks.<event>`, joining the group that has the
/// same matcher if there is one.
pub fn apply_hook_add(
    v: &mut Value,
    event: &str,
    matcher: Option<&str>,
    command: &str,
    timeout: Option<u64>,
) -> Result<(), String> {
    let event = event.trim();
    let command = command.trim();
    if event.is_empty() || command.is_empty() {
        return Err("event and command are required".into());
    }
    let matcher = matcher.map(str::trim).filter(|m| !m.is_empty());
    let mut hook = serde_json::Map::new();
    hook.insert("type".into(), Value::String("command".into()));
    hook.insert("command".into(), Value::String(command.to_string()));
    if let Some(t) = timeout {
        hook.insert("timeout".into(), Value::from(t));
    }
    let groups = ensure_array(object_entry(v, "hooks"), event);
    let existing = groups
        .iter_mut()
        .find(|g| g.get("matcher").and_then(Value::as_str) == matcher);
    match existing {
        Some(group) => ensure_array(group, "hooks").push(Value::Object(hook)),
        None => {
            let mut group = serde_json::Map::new();
            if let Some(m) = matcher {
                group.insert("matcher".into(), Value::String(m.to_string()));
            }
            group.insert("hooks".into(), Value::Array(vec![Value::Object(hook)]));
            groups.push(Value::Object(group));
        }
    }
    Ok(())
}

/// Remove the `hook`-th hook of the `group`-th matcher group of an event,
/// pruning the group/event/`hooks` key if that leaves them empty.
pub fn apply_hook_remove(
    v: &mut Value,
    event: &str,
    group: usize,
    hook: usize,
) -> Result<(), String> {
    let missing = || format!("hook {event}[{group}][{hook}] not found");
    let hooks = v.get_mut("hooks").ok_or_else(missing)?;
    let groups = hooks
        .get_mut(event)
        .and_then(Value::as_array_mut)
        .ok_or_else(missing)?;
    let list = groups
        .get_mut(group)
        .and_then(|g| g.get_mut("hooks"))
        .and_then(Value::as_array_mut)
        .ok_or_else(missing)?;
    if hook >= list.len() {
        return Err(missing());
    }
    list.remove(hook);
    if list.is_empty() {
        groups.remove(group);
    }
    prune_empty(hooks, event);
    prune_empty(v, "hooks");
    Ok(())
}

pub fn preview_hook_add(
    scope: &Scope,
    layer: Layer,
    event: &str,
    matcher: Option<String>,
    command: &str,
    timeout: Option<u64>,
) -> Result<MutationPreview, String> {
    let mut probe = Value::Object(Default::default());
    apply_hook_add(&mut probe, event, matcher.as_deref(), command, timeout)?;
    let note = format!("Add {} hook", event.trim());
    let (event, command) = (event.to_string(), command.to_string());
    build_preview(scope, layer, note, move |v| {
        let _ = apply_hook_add(v, &event, matcher.as_deref(), &command, timeout);
    })
}

pub fn preview_hook_remove(
    scope: &Scope,
    layer: Layer,
    event: &str,
    group: usize,
    hook: usize,
) -> Result<MutationPreview, String> {
    let (_, mut probe, _) = current(scope, layer)?;
    apply_hook_remove(&mut probe, event, group, hook)?;
    let note = format!("Remove {event} hook");
    let event = event.to_string();
    build_preview(scope, layer, note, move |v| {
        let _ = apply_hook_remove(v, &event, group, hook);
    })
}

fn object_entry<'a>(v: &'a mut Value, key: &str) -> &'a mut Value {
    if !v.is_object() {
        *v = Value::Object(Default::default());
    }
    let entry = v
        .as_object_mut()
        .unwrap()
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Default::default()));
    if !entry.is_object() {
        *entry = Value::Object(Default::default());
    }
    entry
}

/// Remove `key` from an object if its value is an empty array or object.
fn prune_empty(v: &mut Value, key: &str) {
    if let Value::Object(map) = v {
        let empty = match map.get(key) {
            Some(Value::Array(a)) => a.is_empty(),
            Some(Value::Object(o)) => o.is_empty(),
            _ => false,
        };
        if empty {
            map.remove(key);
        }
    }
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
    fn set_key_refuses_masked_values() {
        let (scope, proj) = temp_project();
        let layer = default_write_layer(&scope);
        let masked = serde_json::json!({ "API_KEY": "sk-••••••(23)" });
        let err = preview_set_key(&scope, layer, vec!["env".into()], masked).unwrap_err();
        assert!(err.contains("masked"), "{err}");
        assert!(preview_set_key(
            &scope,
            layer,
            vec!["model".into()],
            Value::String("••••".into())
        )
        .is_err());
        assert!(preview_set_key(
            &scope,
            layer,
            vec!["model".into()],
            Value::String("opus".into())
        )
        .is_ok());
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

    fn parse(t: &str) -> Value {
        serde_json::from_str(t).unwrap()
    }

    #[test]
    fn permission_rule_add_dedups_and_remove_cleans_up() {
        let mut v = parse(r#"{"theme":"dark","permissions":{"allow":["Bash(ls)"]}}"#);
        apply_permission_rule(&mut v, "allow", "Bash(npm test)", true).unwrap();
        apply_permission_rule(&mut v, "allow", "Bash(npm test)", true).unwrap();
        apply_permission_rule(&mut v, "deny", "Read(./.env)", true).unwrap();
        assert_eq!(
            v["permissions"],
            parse(r#"{"allow":["Bash(ls)","Bash(npm test)"],"deny":["Read(./.env)"]}"#)
        );
        apply_permission_rule(&mut v, "deny", "Read(./.env)", false).unwrap();
        assert_eq!(
            v["permissions"],
            parse(r#"{"allow":["Bash(ls)","Bash(npm test)"]}"#)
        );
        assert_eq!(v["theme"], "dark");
    }

    #[test]
    fn permission_rule_rejects_bad_input() {
        let mut v = parse("{}");
        assert!(apply_permission_rule(&mut v, "maybe", "Bash(ls)", true).is_err());
        assert!(apply_permission_rule(&mut v, "allow", "  ", true).is_err());
        assert_eq!(v, parse("{}"));
    }

    #[test]
    fn permission_rule_preview_writes_to_layer() {
        let (scope, proj) = temp_project();
        let p = preview_permission_rule(&scope, Layer::Project, "ask", "WebFetch", true).unwrap();
        assert!(
            p.new_text.contains("\"ask\": [\n      \"WebFetch\""),
            "{}",
            p.new_text
        );
        assert!(p.new_text.contains("\"theme\": \"dark\""));
        std::fs::remove_dir_all(&proj).ok();
    }

    #[test]
    fn hook_add_groups_by_matcher() {
        let mut v = parse("{}");
        apply_hook_add(&mut v, "PostToolUse", Some("Edit"), "fmt.sh", None).unwrap();
        apply_hook_add(&mut v, "PostToolUse", Some("Edit"), "lint.sh", Some(30)).unwrap();
        apply_hook_add(&mut v, "Stop", None, "notify.sh", None).unwrap();
        assert_eq!(
            v["hooks"],
            parse(
                r#"{
                "PostToolUse": [{"matcher":"Edit","hooks":[
                    {"type":"command","command":"fmt.sh"},
                    {"type":"command","command":"lint.sh","timeout":30}]}],
                "Stop": [{"hooks":[{"type":"command","command":"notify.sh"}]}]
            }"#
            )
        );
        assert!(apply_hook_add(&mut v, "Stop", None, " ", None).is_err());
        assert!(apply_hook_add(&mut v, "", None, "x", None).is_err());
    }

    #[test]
    fn hook_remove_by_position_prunes_empty_groups() {
        let mut v = parse(
            r#"{"hooks":{"PostToolUse":[{"matcher":"Edit","hooks":[
                {"type":"command","command":"a"},{"type":"command","command":"b"}]}],
              "Stop":[{"hooks":[{"type":"command","command":"c"}]}]}}"#,
        );
        apply_hook_remove(&mut v, "PostToolUse", 0, 0).unwrap();
        assert_eq!(
            v["hooks"]["PostToolUse"],
            parse(r#"[{"matcher":"Edit","hooks":[{"type":"command","command":"b"}]}]"#)
        );
        apply_hook_remove(&mut v, "Stop", 0, 0).unwrap();
        assert!(v["hooks"].get("Stop").is_none(), "{v}");
        assert!(apply_hook_remove(&mut v, "Stop", 0, 0).is_err());
        assert!(apply_hook_remove(&mut v, "PostToolUse", 0, 5).is_err());
    }
}
