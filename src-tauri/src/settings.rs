//! Settings-layer discovery: read every layer for a scope, mask secrets, and
//! compute the effective value of each top-level key with full provenance.

use std::path::PathBuf;

use serde_json::Value;

use crate::model::*;
use crate::secrets::{mask_command, mask_url, mask_value};
use crate::util::{claude_dir, read_json, tildify};

/// Managed/enterprise settings path for the current OS (read-only).
pub fn managed_path() -> PathBuf {
    if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/ClaudeCode/managed-settings.json")
    } else if cfg!(target_os = "windows") {
        PathBuf::from("C:\\ProgramData\\ClaudeCode\\managed-settings.json")
    } else {
        PathBuf::from("/etc/claude-code/managed-settings.json")
    }
}

struct LayerSpec {
    layer: Layer,
    path: PathBuf,
    read_only: bool,
}

/// The ordered (low → high precedence) layer specs for a scope.
fn layer_specs(scope: &Scope) -> Vec<LayerSpec> {
    let cdir = claude_dir();
    let mut specs = vec![
        LayerSpec {
            layer: Layer::User,
            path: cdir.join("settings.json"),
            read_only: false,
        },
        LayerSpec {
            layer: Layer::UserLocal,
            path: cdir.join("settings.local.json"),
            read_only: false,
        },
    ];

    if scope.kind == ScopeKind::Project {
        if let Some(p) = &scope.path {
            let proj = PathBuf::from(p).join(".claude");
            specs.push(LayerSpec {
                layer: Layer::Project,
                path: proj.join("settings.json"),
                read_only: false,
            });
            specs.push(LayerSpec {
                layer: Layer::ProjectLocal,
                path: proj.join("settings.local.json"),
                read_only: false,
            });
        }
    }

    // Managed always highest precedence, always read-only.
    specs.push(LayerSpec {
        layer: Layer::Managed,
        path: managed_path(),
        read_only: true,
    });

    specs
}

/// Resolve the file path + read-only flag for a single layer in a scope.
/// Returns None if that layer doesn't apply to the scope.
pub fn layer_path(scope: &Scope, layer: Layer) -> Option<(PathBuf, bool)> {
    layer_specs(scope)
        .into_iter()
        .find(|s| s.layer == layer)
        .map(|s| (s.path, s.read_only))
}

pub fn get_settings(scope: &Scope) -> SettingsDomain {
    let specs = layer_specs(scope);
    let mut files: Vec<LayerFile> = Vec::new();

    for spec in &specs {
        let (content, error) = match read_json(&spec.path) {
            Ok(Some(v)) => (Some(mask_value(&v, None)), None),
            Ok(None) => (None, None),
            Err(e) => (None, Some(e)),
        };
        files.push(LayerFile {
            layer: spec.layer,
            label: spec.layer.label().to_string(),
            path: spec.path.display().to_string(),
            display_path: tildify(&spec.path),
            present: spec.path.exists(),
            read_only: spec.read_only,
            content,
            error,
        });
    }

    let effective = compute_effective(&files);
    SettingsDomain { files, effective }
}

/// Last-writer-wins at top-level-key granularity, ascending precedence.
/// (Claude Code concatenates some list values like permissions across layers;
/// the per-layer files remain visible so that nuance isn't hidden.)
fn compute_effective(files: &[LayerFile]) -> Vec<EffectiveSetting> {
    use std::collections::BTreeSet;

    // Collect, per key, the ordered list of (layer, value) contributions.
    let mut order: Vec<String> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut contributions: std::collections::HashMap<String, Vec<(Layer, Value)>> =
        std::collections::HashMap::new();

    for f in files {
        let Some(Value::Object(map)) = &f.content else {
            continue;
        };
        for (k, v) in map {
            if k == "$schema" {
                continue;
            }
            if seen.insert(k.clone()) {
                order.push(k.clone());
            }
            contributions
                .entry(k.clone())
                .or_default()
                .push((f.layer, v.clone()));
        }
    }

    let mut out = Vec::new();
    for key in order {
        let contribs = contributions.remove(&key).unwrap_or_default();
        if contribs.is_empty() {
            continue;
        }
        let (source, value) = contribs.last().cloned().unwrap();
        let overridden = contribs[..contribs.len() - 1]
            .iter()
            .map(|(layer, value)| OverriddenValue {
                layer: *layer,
                value: value.clone(),
            })
            .collect();
        out.push(EffectiveSetting {
            key,
            value,
            source,
            overridden,
        });
    }
    out
}

/// Hooks defined across settings layers, flattened for display.
/// Hooks declared in one settings file. `hooks.<Event>` is an array of
/// `{ matcher?, hooks: [{ type, command }] }`; commands are masked.
pub fn hooks_in(content: &Value, layer: Layer) -> Vec<HookEntry> {
    let mut entries = Vec::new();
    let Some(Value::Object(hooks)) = content.get("hooks") else {
        return entries;
    };
    for (event, groups) in hooks {
        let Some(groups) = groups.as_array() else {
            continue;
        };
        for (group_index, group) in groups.iter().enumerate() {
            let matcher = group
                .get("matcher")
                .and_then(|m| m.as_str())
                .map(String::from);
            let entry = |hook_index, h: Option<&Value>| {
                let text = |k: &str| h.and_then(|h| h.get(k)).and_then(Value::as_str);
                HookEntry {
                    event: event.clone(),
                    matcher: matcher.clone(),
                    hook_type: match h {
                        Some(_) => text("type").unwrap_or("command").to_string(),
                        None => "unknown".into(),
                    },
                    command: text("command").map(mask_command),
                    url: text("url").map(mask_url),
                    prompt: text("prompt").map(mask_command),
                    model: text("model").map(String::from),
                    timeout: h.and_then(|h| h.get("timeout")).and_then(Value::as_u64),
                    source: layer,
                    group_index,
                    hook_index,
                }
            };
            match group.get("hooks").and_then(|h| h.as_array()) {
                Some(list) => {
                    for (hook_index, h) in list.iter().enumerate() {
                        entries.push(entry(hook_index, Some(h)));
                    }
                }
                None => entries.push(entry(0, None)),
            }
        }
    }
    entries
}

pub fn get_hooks(scope: &Scope) -> Vec<HookEntry> {
    let domain = get_settings(scope);
    let mut entries = Vec::new();
    for file in &domain.files {
        if let Some(content) = &file.content {
            entries.extend(hooks_in(content, file.layer));
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hooks_in_reports_positions_and_masks_commands() {
        let v: Value = serde_json::from_str(
            r#"{"hooks":{"PostToolUse":[
                {"matcher":"Edit","hooks":[
                    {"type":"command","command":"fmt.sh"},
                    {"type":"command","command":"curl -s https://x.dev --token abc123plain"}]},
                {"matcher":"Write","hooks":[{"type":"command","command":"w.sh"}]}]}}"#,
        )
        .unwrap();
        let hooks = hooks_in(&v, Layer::User);
        let got: Vec<(usize, usize, Option<String>, Option<String>)> = hooks
            .iter()
            .map(|h| {
                (
                    h.group_index,
                    h.hook_index,
                    h.matcher.clone(),
                    h.command.clone(),
                )
            })
            .collect();
        let s = |x: &str| Some(x.to_string());
        assert_eq!(
            got,
            vec![
                (0, 0, s("Edit"), s("fmt.sh")),
                (0, 1, s("Edit"), s("curl -s https://x.dev --token ••••")),
                (1, 0, s("Write"), s("w.sh")),
            ]
        );
        assert!(hooks
            .iter()
            .all(|h| h.event == "PostToolUse" && h.source == Layer::User));
    }

    #[test]
    fn hooks_in_reports_other_hook_types_masked() {
        let v: Value = serde_json::from_str(
            r#"{"hooks":{"Stop":[{"hooks":[
                {"type":"http","url":"https://h.dev/x?key=sk_live_abcdefgh12345678","timeout":5},
                {"type":"prompt","prompt":"Done?","model":"haiku"},
                {"type":"agent","prompt":"Check tests"}]}]}}"#,
        )
        .unwrap();
        let h = hooks_in(&v, Layer::Project);
        assert_eq!(h[0].hook_type, "http");
        let url = h[0].url.clone().unwrap();
        assert!(
            url.starts_with("https://h.dev/x?key=") && !url.contains("abcdefgh"),
            "{url}"
        );
        assert_eq!(h[0].timeout, Some(5));
        assert_eq!(h[1].prompt.as_deref(), Some("Done?"));
        assert_eq!(h[1].model.as_deref(), Some("haiku"));
        assert_eq!(h[2].hook_type, "agent");
        assert_eq!(h[2].prompt.as_deref(), Some("Check tests"));
        assert!(h[2].command.is_none() && h[2].model.is_none());
    }
}
