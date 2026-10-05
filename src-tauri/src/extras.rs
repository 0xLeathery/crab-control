//! Config files Claude Code reads that live outside settings: the
//! keybindings file and the script a `statusLine` command runs.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::writer::SaveResult;

/// Check the shape Claude Code expects: `{ "bindings": [ { "context": "...",
/// "bindings": { "<keys>": "<action>" | null } } ] }`.
pub fn validate_keybindings(v: &Value) -> Result<(), String> {
    let blocks = v
        .get("bindings")
        .and_then(Value::as_array)
        .ok_or("expected an object with a \"bindings\" array")?;
    for (i, block) in blocks.iter().enumerate() {
        if block.get("context").and_then(Value::as_str).is_none() {
            return Err(format!("bindings[{i}] needs a \"context\" string"));
        }
        let map = block
            .get("bindings")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("bindings[{i}].bindings must be an object of key → action"))?;
        if let Some((k, _)) = map.iter().find(|(_, a)| !(a.is_string() || a.is_null())) {
            return Err(format!(
                "bindings[{i}].bindings[\"{k}\"] must be an action name or null"
            ));
        }
    }
    Ok(())
}

fn expand_home(token: &str, home: &Path) -> PathBuf {
    for prefix in ["~/", "$HOME/", "${HOME}/"] {
        if let Some(rest) = token.strip_prefix(prefix) {
            return home.join(rest);
        }
    }
    PathBuf::from(token)
}

/// The script file a status line command runs, if it is one we may edit: an
/// existing file under one of `bases` (the user or project `.claude/` dir).
pub fn statusline_script(command: &str, home: &Path, bases: &[PathBuf]) -> Option<PathBuf> {
    let bases: Vec<PathBuf> = bases.iter().filter_map(|b| b.canonicalize().ok()).collect();
    command
        .split_whitespace()
        .map(|t| t.trim_matches(|c| c == '"' || c == '\''))
        .map(|t| expand_home(t, home))
        .filter(|p| {
            p.is_absolute()
                && p.components()
                    .all(|c| !matches!(c, std::path::Component::ParentDir))
                && p.is_file()
        })
        .find(|p| {
            p.canonicalize()
                .is_ok_and(|real| bases.iter().any(|b| real.starts_with(b)))
        })
}

/// A text file shown in an editor (same shape as a memory file).
pub use crate::memory::MemoryFile as TextFile;

fn read_text(path: &Path) -> Result<TextFile, String> {
    let exists = path.exists();
    let text = if exists {
        std::fs::read_to_string(path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    Ok(TextFile {
        path: path.display().to_string(),
        display_path: crate::util::tildify(path),
        exists,
        text,
    })
}

pub fn keybindings_path(cdir: &Path) -> PathBuf {
    cdir.join("keybindings.json")
}

pub fn read_keybindings(cdir: &Path) -> Result<TextFile, String> {
    read_text(&keybindings_path(cdir))
}

pub fn save_keybindings(cdir: &Path, content: &str) -> SaveResult {
    match serde_json::from_str::<Value>(content) {
        Ok(v) => {
            if let Err(e) = validate_keybindings(&v) {
                return crate::writer::save_err(e);
            }
        }
        Err(e) => return crate::writer::save_err(format!("invalid JSON: {e}")),
    }
    crate::writer::save_to_path(&keybindings_path(cdir), false, content)
}

/// The configured status line command (masked) and, when it runs a script
/// under `.claude/`, that script.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusLine {
    pub command: String,
    pub script: Option<TextFile>,
}

pub fn statusline(command: &str, home: &Path, bases: &[PathBuf]) -> Result<StatusLine, String> {
    let script = match statusline_script(command, home, bases) {
        Some(p) => Some(read_text(&p)?),
        None => None,
    };
    Ok(StatusLine {
        command: crate::secrets::mask_command(command),
        script,
    })
}

pub fn save_statusline_script(
    command: &str,
    home: &Path,
    bases: &[PathBuf],
    content: &str,
) -> SaveResult {
    match statusline_script(command, home, bases) {
        Some(p) => crate::writer::save_text_to_path(&p, content),
        None => crate::writer::save_err("the status line doesn't run an editable script".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keybindings_shape_is_validated() {
        let ok = json!({
            "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
            "bindings": [{ "context": "Chat", "bindings": { "ctrl+e": "chat:externalEditor", "ctrl+s": null } }]
        });
        assert!(validate_keybindings(&ok).is_ok());
        assert!(validate_keybindings(&json!({ "bindings": [] })).is_ok());
        for bad in [
            json!([]),
            json!({}),
            json!({ "bindings": {} }),
            json!({ "bindings": [{ "bindings": {} }] }),
            json!({ "bindings": [{ "context": "Chat", "bindings": [] }] }),
            json!({ "bindings": [{ "context": "Chat", "bindings": { "ctrl+e": 3 } }] }),
        ] {
            assert!(validate_keybindings(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn finds_editable_statusline_scripts() {
        let root = std::env::temp_dir().join(format!(
            "cc-statusline-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let home = root.join("home");
        let cdir = home.join(".claude");
        std::fs::create_dir_all(&cdir).unwrap();
        std::fs::write(cdir.join("statusline.sh"), "echo hi\n").unwrap();
        std::fs::write(root.join("elsewhere.sh"), "echo\n").unwrap();
        let bases = vec![cdir.clone()];
        let want = Some(cdir.join("statusline.sh"));
        assert_eq!(
            statusline_script("~/.claude/statusline.sh", &home, &bases),
            want
        );
        assert_eq!(
            statusline_script("bash ~/.claude/statusline.sh --x", &home, &bases),
            want
        );
        assert_eq!(
            statusline_script("$HOME/.claude/statusline.sh", &home, &bases),
            want
        );
        let abs = format!("{}", cdir.join("statusline.sh").display());
        assert_eq!(statusline_script(&abs, &home, &bases), want);
        // Inline commands, missing files and files outside .claude/ are not editable.
        assert_eq!(statusline_script("jq -r '.model'", &home, &bases), None);
        assert_eq!(
            statusline_script("~/.claude/missing.sh", &home, &bases),
            None
        );
        let outside = format!("{}", root.join("elsewhere.sh").display());
        assert_eq!(statusline_script(&outside, &home, &bases), None);
        let sneaky = "~/.claude/../../elsewhere.sh";
        assert_eq!(statusline_script(sneaky, &home, &bases), None);
        std::fs::remove_dir_all(&root).ok();
    }
}
