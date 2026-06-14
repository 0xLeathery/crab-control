//! Small filesystem + path helpers shared across discovery modules.
//! Everything here is read-only in Phase 1.

use std::path::{Path, PathBuf};

/// The user's home directory. We avoid pulling in the `dirs` crate and read
/// the environment directly (this app only targets the local user's machine).
pub fn home() -> PathBuf {
    if let Ok(h) = std::env::var("HOME") {
        if !h.is_empty() {
            return PathBuf::from(h);
        }
    }
    // Fallbacks for completeness; HOME is always present on macOS/Linux.
    if let Ok(up) = std::env::var("USERPROFILE") {
        return PathBuf::from(up);
    }
    PathBuf::from("/")
}

pub fn claude_dir() -> PathBuf {
    home().join(".claude")
}

/// Replace a leading home path with `~` for compact display.
pub fn tildify(path: &Path) -> String {
    let h = home();
    if let Ok(rest) = path.strip_prefix(&h) {
        if rest.as_os_str().is_empty() {
            return "~".to_string();
        }
        return format!("~/{}", rest.display());
    }
    path.display().to_string()
}

/// Read a UTF-8 text file, returning None on any error (missing, unreadable).
/// Refuses to read credential files (defense in depth).
pub fn read_text(path: &Path) -> Option<String> {
    if is_forbidden(path) {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn is_forbidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(crate::secrets::is_forbidden_file)
        .unwrap_or(false)
}

/// Read + parse a JSON file, preserving key order (serde_json preserve_order).
/// Returns Err(message) when the file exists but is not valid JSON, so the UI
/// can surface a parse error instead of silently showing nothing.
pub fn read_json(path: &Path) -> Result<Option<serde_json::Value>, String> {
    if is_forbidden(path) {
        return Ok(None);
    }
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("{e}"))?;
    if text.trim().is_empty() {
        return Ok(Some(serde_json::Value::Object(Default::default())));
    }
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(v) => Ok(Some(v)),
        Err(e) => Err(format!("invalid JSON: {e}")),
    }
}
