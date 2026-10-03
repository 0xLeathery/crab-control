//! Phase 2 — safe writes for settings files. Every write goes through:
//!   1. resolve + guard  (only editable layer files; never managed/read-only)
//!   2. validate         (must parse as JSON; invalid input is rejected)
//!   3. backup           (timestamped `<file>.backup.<epoch-ms>`, keep last 5)
//!   4. atomic write     (temp file in same dir + rename)
//!
//! Raw text is written verbatim once validated, so the user's exact formatting
//! and key order are preserved.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[cfg(test)]
use crate::model::ScopeKind;
use crate::model::{Layer, Scope};
use crate::settings::layer_path;

const KEEP_BACKUPS: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawFile {
    pub path: String,
    pub display_path: String,
    pub exists: bool,
    pub read_only: bool,
    pub text: String,
    /// True if the parsed content contains values that look like secrets — the
    /// UI warns before showing the unmasked editor.
    pub has_secrets: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResult {
    pub valid: bool,
    pub error: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub ok: bool,
    pub backup_path: Option<String>,
    pub display_backup: Option<String>,
    pub bytes: usize,
    pub error: Option<String>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Validate that text parses as JSON; report line/column on failure.
pub fn validate_json(text: &str) -> ValidateResult {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(_) => ValidateResult {
            valid: true,
            error: None,
            line: None,
            column: None,
        },
        Err(e) => ValidateResult {
            valid: false,
            error: Some(e.to_string()),
            line: Some(e.line()),
            column: Some(e.column()),
        },
    }
}

/// Scan parsed JSON for secret-looking content (keys or values).
fn contains_secrets(v: &serde_json::Value, key_hint: Option<&str>) -> bool {
    use serde_json::Value;
    match v {
        Value::String(s) => {
            key_hint.map(crate::secrets::is_secret_key).unwrap_or(false)
                || crate::secrets::looks_like_secret(s)
        }
        Value::Array(a) => a.iter().any(|x| contains_secrets(x, key_hint)),
        Value::Object(m) => m
            .iter()
            .any(|(k, val)| crate::secrets::is_secret_key(k) || contains_secrets(val, Some(k))),
        _ => false,
    }
}

/// Read the *raw, unmasked* text of an editable settings file (for the editor).
/// Only editable layer files are permitted; credential files are refused.
pub fn read_raw(scope: &Scope, layer: Layer) -> Result<RawFile, String> {
    let (path, read_only) =
        layer_path(scope, layer).ok_or_else(|| "layer not available for this scope".to_string())?;
    if is_forbidden(&path) {
        return Err("refusing to read a credentials file".into());
    }
    let exists = path.exists();
    let text = if exists {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let has_secrets = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .map(|v| contains_secrets(&v, None))
        .unwrap_or(false);
    Ok(RawFile {
        display_path: crate::util::tildify(&path),
        path: path.display().to_string(),
        exists,
        read_only,
        text,
        has_secrets,
    })
}

fn is_forbidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(crate::secrets::is_forbidden_file)
        .unwrap_or(false)
}

/// Back up an existing file and prune to the newest KEEP_BACKUPS.
fn backup(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("bad path")?
        .to_string();
    let dir = path.parent().ok_or("no parent dir")?;
    // Keep the integer `.backup.<epoch-ms>` convention, but guarantee a unique
    // name even when two saves land in the same millisecond (bump the suffix).
    let mut ts = now_ms();
    let mut backup_path = dir.join(format!("{file_name}.backup.{ts}"));
    while backup_path.exists() {
        ts += 1;
        backup_path = dir.join(format!("{file_name}.backup.{ts}"));
    }
    std::fs::copy(path, &backup_path).map_err(|e| format!("backup failed: {e}"))?;

    // Prune older backups of this file.
    let prefix = format!("{file_name}.backup.");
    let mut backups: Vec<(u128, PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if let Some(ts) = name.strip_prefix(&prefix) {
                    if let Ok(n) = ts.parse::<u128>() {
                        backups.push((n, p));
                    }
                }
            }
        }
    }
    backups.sort_by_key(|b| std::cmp::Reverse(b.0)); // newest first
    for (_, old) in backups.into_iter().skip(KEEP_BACKUPS) {
        let _ = std::fs::remove_file(old);
    }

    Ok(Some(backup_path))
}

fn save_err(msg: String) -> SaveResult {
    SaveResult {
        ok: false,
        backup_path: None,
        display_backup: None,
        bytes: 0,
        error: Some(msg),
    }
}

/// Save validated raw text to an editable settings file, atomically, with a
/// backup. Refuses managed/read-only files and invalid JSON.
pub fn save_settings(scope: &Scope, layer: Layer, content: &str) -> SaveResult {
    let (path, read_only) = match layer_path(scope, layer) {
        Some(v) => v,
        None => return save_err("layer not available for this scope".into()),
    };
    save_to_path(&path, read_only, content)
}

/// Path-explicit core (testable without touching real config):
/// guard → validate → backup → atomic write.
pub(crate) fn save_to_path(path: &Path, read_only: bool, content: &str) -> SaveResult {
    if read_only {
        return save_err("this file is read-only (managed settings)".into());
    }
    if is_forbidden(path) {
        return save_err("refusing to write a credentials file".into());
    }

    // Validate before doing anything destructive.
    let v = validate_json(content);
    if !v.valid {
        return save_err(format!(
            "invalid JSON: {}",
            v.error.unwrap_or_else(|| "parse error".into())
        ));
    }

    // Backup existing file (and prune to KEEP_BACKUPS).
    let backup_path = match backup(path) {
        Ok(b) => b,
        Err(e) => return save_err(e),
    };

    // Ensure parent dir exists (e.g. creating .claude/settings.local.json).
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return save_err(format!("cannot create directory: {e}"));
        }
    }

    // Atomic write: temp file in same dir, then rename over the target.
    let tmp = path.with_file_name(format!(
        "{}.tmp.{}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("settings"),
        now_ms()
    ));
    if let Err(e) = std::fs::write(&tmp, content.as_bytes()) {
        return save_err(format!("write failed: {e}"));
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return save_err(format!("atomic rename failed: {e}"));
    }

    SaveResult {
        ok: true,
        display_backup: backup_path.as_deref().map(crate::util::tildify),
        backup_path: backup_path.map(|p| p.display().to_string()),
        bytes: content.len(),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_validates_backs_up_and_prunes() {
        // Work entirely in a temp dir — never the real config.
        let dir = std::env::temp_dir().join(format!("cc-writer-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");

        // Initial create.
        let r = save_to_path(&path, false, "{\n  \"a\": 1\n}\n");
        assert!(r.ok, "create failed: {:?}", r.error);
        assert!(path.exists());
        assert!(r.backup_path.is_none(), "no backup on first create");

        // Invalid JSON is rejected and does not modify the file.
        let before = std::fs::read_to_string(&path).unwrap();
        let bad = save_to_path(&path, false, "{ not json ");
        assert!(!bad.ok);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            before,
            "file untouched on invalid"
        );

        // Read-only is refused.
        assert!(!save_to_path(&path, true, "{}").ok);

        // Several valid edits → each backs up; pruned to 5.
        for i in 0..8 {
            let r = save_to_path(&path, false, &format!("{{\n  \"a\": {i}\n}}\n"));
            assert!(r.ok);
            assert!(r.backup_path.is_some());
        }
        let backups = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.contains("settings.json.backup."))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(backups, 5, "should keep exactly 5 backups, found {backups}");

        // Final content is the last write.
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"a\": 7"));

        // No leftover temp files.
        let temps = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.contains(".tmp."))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(temps, 0, "atomic temp files should be cleaned up");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prune_keeps_newest_backups() {
        let dir = std::env::temp_dir().join(format!("cc-writer-prune-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        std::fs::write(&path, "{}\n").unwrap();
        // Six old backups with known timestamps, oldest = 1.
        for ts in 1..=6 {
            std::fs::write(dir.join(format!("settings.json.backup.{ts}")), "{}").unwrap();
        }

        assert!(save_to_path(&path, false, "{\"a\": 1}\n").ok);

        let mut left: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .filter_map(|n| n.strip_prefix("settings.json.backup.").map(String::from))
            .collect();
        left.sort();
        // 7 backups exist after the save; the fresh (epoch-ms) one plus the
        // four newest seeded ones survive.
        assert_eq!(left.len(), 5, "kept: {left:?}");
        for gone in ["1", "2"] {
            assert!(
                !left.contains(&gone.to_string()),
                "{gone} should be pruned: {left:?}"
            );
        }
        for kept in ["3", "4", "5", "6"] {
            assert!(
                left.contains(&kept.to_string()),
                "{kept} should be kept: {left:?}"
            );
        }

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_settings_resolves_project_layer_and_refuses_managed() {
        let proj = std::env::temp_dir().join(format!("cc-proj-{}", now_ms()));
        std::fs::create_dir_all(&proj).unwrap();
        let scope = Scope {
            kind: ScopeKind::Project,
            path: Some(proj.display().to_string()),
        };

        // ProjectLocal resolves to <proj>/.claude/settings.local.json and writes.
        let r = save_settings(&scope, Layer::ProjectLocal, "{\n  \"x\": true\n}\n");
        assert!(r.ok, "{:?}", r.error);
        assert!(proj.join(".claude/settings.local.json").exists());

        // Managed must always be refused (read-only, never written).
        let m = save_settings(&scope, Layer::Managed, "{}");
        assert!(!m.ok, "managed settings must be refused");

        std::fs::remove_dir_all(&proj).ok();
    }

    #[test]
    fn refuses_credentials_file() {
        let dir = std::env::temp_dir().join(format!("cc-cred-test-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(".credentials.json");
        let r = save_to_path(&path, false, "{}");
        assert!(!r.ok, "must refuse credential files");
        assert!(!path.exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
