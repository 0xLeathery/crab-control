//! List and restore the `<file>.backup.<epoch-ms>` copies writer.rs keeps.
//! Restoring writes through the normal pipeline, so the version being
//! replaced is itself backed up and a restore can be undone.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::writer::SaveResult;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub display_path: String,
    /// Epoch milliseconds from the file name.
    pub saved_at: u64,
    pub bytes: u64,
}

/// Backups live beside the real file; for a symlinked CLAUDE.md that is the
/// link's target, since that's where writer.rs writes.
fn resolved(target: &Path) -> PathBuf {
    let is_link = std::fs::symlink_metadata(target)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    if is_link {
        std::fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf())
    } else {
        target.to_path_buf()
    }
}

/// `Some(ms)` if `candidate` is exactly `<dir of target>/<target name>.backup.<ms>`.
fn backup_stamp(target: &Path, candidate: &Path) -> Option<u64> {
    let name = target.file_name()?.to_str()?;
    if candidate.parent()? != target.parent()? {
        return None;
    }
    let rest = candidate.file_name()?.to_str()?.strip_prefix(name)?;
    let digits = rest.strip_prefix(".backup.")?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

pub fn list_backups(target: &Path) -> Vec<BackupEntry> {
    let target = resolved(target);
    let Some(dir) = target.parent() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<BackupEntry> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let saved_at = backup_stamp(&target, &p)?;
            Some(BackupEntry {
                display_path: crate::util::tildify(&p),
                bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                path: p.display().to_string(),
                saved_at,
            })
        })
        .collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.saved_at));
    out
}

fn checked_backup(target: &Path, backup: &str) -> Result<PathBuf, String> {
    let target = resolved(target);
    let candidate = PathBuf::from(backup);
    let plain = candidate
        .components()
        .all(|c| !matches!(c, std::path::Component::ParentDir));
    if plain && backup_stamp(&target, &candidate).is_some() && candidate.is_file() {
        Ok(candidate)
    } else {
        Err(format!("not a backup of {}", target.display()))
    }
}

pub fn read_backup(target: &Path, backup: &str) -> Result<String, String> {
    let path = checked_backup(target, backup)?;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Restore `backup` over `target`. `json` routes through the settings writer
/// (which validates JSON); otherwise the text writer is used.
pub fn restore_backup(target: &Path, backup: &str, read_only: bool, json: bool) -> SaveResult {
    if read_only {
        return crate::writer::save_err("this file is read-only".into());
    }
    let content = match read_backup(target, backup) {
        Ok(c) => c,
        Err(e) => return crate::writer::save_err(e),
    };
    if json {
        crate::writer::save_to_path(target, false, &content)
    } else {
        crate::writer::save_text_to_path(target, &content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "cc-backups-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn lists_only_this_files_backups_newest_first() {
        let d = tmp();
        let target = d.join("settings.json");
        std::fs::write(&target, "{}").unwrap();
        std::fs::write(d.join("settings.json.backup.100"), "{\"a\":1}").unwrap();
        std::fs::write(d.join("settings.json.backup.300"), "{\"a\":3}").unwrap();
        std::fs::write(d.join("settings.json.backup.200"), "{\"a\":2}").unwrap();
        std::fs::write(d.join("settings.json.backup.nope"), "x").unwrap();
        std::fs::write(d.join("settings.local.json.backup.400"), "{}").unwrap();
        let got: Vec<u64> = list_backups(&target).iter().map(|b| b.saved_at).collect();
        assert_eq!(got, vec![300, 200, 100]);
        assert_eq!(list_backups(&target)[0].bytes, 7);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn read_refuses_anything_but_this_files_backup() {
        let d = tmp();
        let target = d.join("settings.json");
        std::fs::write(&target, "{}").unwrap();
        let good = d.join("settings.json.backup.100");
        std::fs::write(&good, "{\"a\":1}").unwrap();
        std::fs::write(d.join("other.json.backup.100"), "{}").unwrap();
        assert_eq!(
            read_backup(&target, &good.display().to_string()).unwrap(),
            "{\"a\":1}"
        );
        for bad in [
            d.join("other.json.backup.100"),
            d.join("settings.json"),
            d.join("sub/settings.json.backup.100"),
            d.join("../settings.json.backup.100"),
            d.join("settings.json.backup.12x"),
        ] {
            assert!(
                read_backup(&target, &bad.display().to_string()).is_err(),
                "{bad:?}"
            );
        }
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn restore_writes_backup_content_and_backs_up_current() {
        let d = tmp();
        let target = d.join("settings.json");
        std::fs::write(&target, "{\"now\":true}\n").unwrap();
        let old = d.join("settings.json.backup.100");
        std::fs::write(&old, "{\"old\":true}\n").unwrap();
        let r = restore_backup(&target, &old.display().to_string(), false, true);
        assert!(r.ok, "{:?}", r.error);
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "{\"old\":true}\n"
        );
        // The replaced version is now a backup too, so the restore is undoable.
        assert!(list_backups(&target)
            .iter()
            .any(|b| std::fs::read_to_string(&b.path).unwrap() == "{\"now\":true}\n"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn restore_refuses_read_only_and_invalid_backups() {
        let d = tmp();
        let target = d.join("settings.json");
        std::fs::write(&target, "{}").unwrap();
        let old = d.join("settings.json.backup.100");
        std::fs::write(&old, "{}").unwrap();
        assert!(!restore_backup(&target, &old.display().to_string(), true, true).ok);
        assert!(
            !restore_backup(
                &target,
                &d.join("x.backup.1").display().to_string(),
                false,
                true
            )
            .ok
        );
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn restore_text_files_without_json_check() {
        let d = tmp();
        let target = d.join("CLAUDE.md");
        std::fs::write(&target, "new\n").unwrap();
        let old = d.join("CLAUDE.md.backup.5");
        std::fs::write(&old, "# old { not json\n").unwrap();
        let r = restore_backup(&target, &old.display().to_string(), false, false);
        assert!(r.ok, "{:?}", r.error);
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            "# old { not json\n"
        );
        std::fs::remove_dir_all(&d).ok();
    }
}
