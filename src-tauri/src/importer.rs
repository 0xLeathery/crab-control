//! Phase 3 — guarded snapshot import. A snapshot has secrets masked, so import
//! must NEVER write a masked value back. For each settings layer in the
//! snapshot, we overlay only the non-secret top-level keys onto the current
//! file, and surface the result as a per-file diff that the user confirms — the
//! actual write reuses `writer::save_settings`.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;

use crate::edits::MutationPreview;
use crate::model::{Layer, Scope};
use crate::settings::layer_path;
use crate::util::{home, tildify};

const MASK_CHAR: char = '•';

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRef {
    pub path: String,
    pub display_path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedKeys {
    pub file: String,
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlan {
    pub source_display: String,
    pub files: Vec<MutationPreview>,
    pub skipped: Vec<SkippedKeys>,
    pub note: String,
}

/// Find Crab Control snapshots in ~/Downloads and the home dir (newest first).
pub fn list_snapshots() -> Vec<SnapshotRef> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in [home().join("Downloads"), home()] {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("crab-control-snapshot-") && name.ends_with(".json") {
                    if seen.insert(p.clone()) {
                        out.push(SnapshotRef {
                            display_path: tildify(&p),
                            name: name.to_string(),
                            path: p.display().to_string(),
                        });
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

/// True if any string anywhere in the value contains the mask character — i.e.
/// the value carries a redacted secret and must not be written back.
fn contains_mask(v: &Value) -> bool {
    match v {
        Value::String(s) => s.contains(MASK_CHAR),
        Value::Array(a) => a.iter().any(contains_mask),
        Value::Object(m) => m.values().any(contains_mask),
        _ => false,
    }
}

fn pretty(v: &Value) -> String {
    let mut s = serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".into());
    s.push('\n');
    s
}

/// Build the per-file import plan for a snapshot against the current scope.
pub fn preview_import(scope: &Scope, path: &str) -> Result<ImportPlan, String> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("cannot read snapshot: {e}"))?;
    let snap: Value = serde_json::from_str(&text).map_err(|e| format!("invalid snapshot: {e}"))?;
    if snap.get("tool").and_then(|t| t.as_str()) != Some("crab-control") {
        return Err("this file is not a Crab Control snapshot".into());
    }
    let files_in = snap
        .get("settings")
        .and_then(|s| s.get("files"))
        .and_then(|f| f.as_array())
        .ok_or("snapshot has no settings to import")?;

    let mut files = Vec::new();
    let mut skipped = Vec::new();

    for f in files_in {
        let layer_str = f.get("layer").and_then(|l| l.as_str()).unwrap_or("");
        let layer: Layer = match serde_json::from_value(Value::String(layer_str.to_string())) {
            Ok(l) => l,
            Err(_) => continue,
        };
        // Only layers that are editable in the target scope (never managed).
        let (cur_path, read_only) = match layer_path(scope, layer) {
            Some(v) => v,
            None => continue,
        };
        if read_only {
            continue;
        }
        let Some(snap_content) = f.get("content").filter(|c| c.is_object()) else {
            continue;
        };
        let label = f
            .get("label")
            .and_then(|l| l.as_str())
            .unwrap_or(layer_str)
            .to_string();

        let old_text = if cur_path.exists() {
            std::fs::read_to_string(&cur_path).unwrap_or_default()
        } else {
            String::new()
        };
        let mut merged: Value = if old_text.trim().is_empty() {
            Value::Object(Default::default())
        } else {
            serde_json::from_str(&old_text).unwrap_or_else(|_| Value::Object(Default::default()))
        };
        if !merged.is_object() {
            merged = Value::Object(Default::default());
        }

        let mut file_skipped = Vec::new();
        if let (Value::Object(snap_map), Value::Object(out_map)) =
            (snap_content, &mut merged)
        {
            for (k, v) in snap_map {
                if k == "$schema" {
                    continue;
                }
                if contains_mask(v) {
                    file_skipped.push(k.clone()); // never write a masked secret
                    continue;
                }
                out_map.insert(k.clone(), v.clone());
            }
        }

        let new_text = pretty(&merged);
        if new_text != old_text {
            files.push(MutationPreview {
                layer,
                layer_label: label.clone(),
                display_path: tildify(&cur_path),
                old_text,
                new_text,
                note: format!("Import into {label}"),
            });
        }
        if !file_skipped.is_empty() {
            skipped.push(SkippedKeys {
                file: label,
                keys: file_skipped,
            });
        }
    }

    let note = if files.is_empty() {
        "Nothing to import — files already match (masked secrets are never written).".to_string()
    } else {
        format!("{} file(s) would change", files.len())
    };
    Ok(ImportPlan {
        source_display: tildify(&PathBuf::from(path)),
        files,
        skipped,
        note,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ScopeKind;

    #[test]
    fn import_applies_nonsecret_and_skips_masked() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let proj = std::env::temp_dir().join(format!("cc-import-{now}"));
        std::fs::create_dir_all(proj.join(".claude")).unwrap();
        std::fs::write(proj.join(".claude/settings.json"), "{\n  \"theme\": \"light\"\n}\n").unwrap();
        let scope = Scope {
            kind: ScopeKind::Project,
            path: Some(proj.display().to_string()),
        };

        // Snapshot: project layer sets theme=dark (ok) and env with a masked secret (skip).
        let snap = serde_json::json!({
            "tool": "crab-control",
            "settings": { "files": [
                { "layer": "project", "label": "Project", "content": {
                    "theme": "dark",
                    "env": { "API_KEY": "••••••(12)" }
                }}
            ]}
        });
        let snap_path = proj.join("snap.json");
        std::fs::write(&snap_path, serde_json::to_string(&snap).unwrap()).unwrap();

        let plan = preview_import(&scope, snap_path.to_str().unwrap()).unwrap();
        assert_eq!(plan.files.len(), 1);
        let p = &plan.files[0];
        assert!(p.new_text.contains("\"theme\": \"dark\""), "theme applied");
        assert!(!p.new_text.contains("env"), "masked env must be skipped");
        assert!(!p.new_text.contains('•'), "no masked value written");
        assert_eq!(plan.skipped.len(), 1);
        assert_eq!(plan.skipped[0].keys, vec!["env".to_string()]);

        std::fs::remove_dir_all(&proj).ok();
    }
}
