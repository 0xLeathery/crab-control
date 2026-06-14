//! Settings-layer discovery: read every layer for a scope, mask secrets, and
//! compute the effective value of each top-level key with full provenance.

use std::path::PathBuf;

use serde_json::Value;

use crate::model::*;
use crate::secrets::mask_value;
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
pub fn get_hooks(scope: &Scope) -> Vec<HookEntry> {
    let domain = get_settings(scope);
    let mut entries = Vec::new();

    for file in &domain.files {
        let Some(Value::Object(map)) = &file.content else {
            continue;
        };
        let Some(Value::Object(hooks)) = map.get("hooks") else {
            continue;
        };
        for (event, matchers) in hooks {
            // hooks.<Event> is an array of { matcher?, hooks: [{ type, command }] }
            let Some(arr) = matchers.as_array() else {
                continue;
            };
            for entry in arr {
                let matcher = entry
                    .get("matcher")
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string());
                let inner = entry.get("hooks").and_then(|h| h.as_array());
                if let Some(list) = inner {
                    for h in list {
                        entries.push(HookEntry {
                            event: event.clone(),
                            matcher: matcher.clone(),
                            hook_type: h
                                .get("type")
                                .and_then(|t| t.as_str())
                                .unwrap_or("command")
                                .to_string(),
                            command: h
                                .get("command")
                                .and_then(|c| c.as_str())
                                .map(|s| s.to_string()),
                            source: file.layer,
                        });
                    }
                } else {
                    entries.push(HookEntry {
                        event: event.clone(),
                        matcher: matcher.clone(),
                        hook_type: "unknown".to_string(),
                        command: None,
                        source: file.layer,
                    });
                }
            }
        }
    }
    entries
}
