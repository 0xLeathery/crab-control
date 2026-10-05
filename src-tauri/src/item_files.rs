//! Edit and delete agents, commands and skills. Only files under a user or
//! project `.claude/` base are touched — plugin-provided items live elsewhere
//! and stay read-only. Saves go through writer.rs (backup + atomic write);
//! deletes move the item into `<base>/.crab-trash/<ms>/` so it can be put back.

use std::path::PathBuf;

use crate::writer::SaveResult;

#[derive(Debug, Clone, PartialEq)]
pub struct ItemPath {
    pub path: PathBuf,
    pub base: PathBuf,
    /// For a skill, its directory (deleted as a unit); otherwise the file.
    pub unit: PathBuf,
}

/// Accept an existing `.md` under `<base>/agents/` or `<base>/commands/`
/// (any depth), or exactly `<base>/skills/<name>/SKILL.md`.
pub fn resolve_item_path(bases: &[PathBuf], requested: &str) -> Result<ItemPath, String> {
    let path = PathBuf::from(requested);
    let refuse = || format!("not an agent, command or skill Crab Control can edit: {requested}");
    let plain = path
        .components()
        .all(|c| !matches!(c, std::path::Component::ParentDir));
    if !plain || !path.is_file() || path.extension().is_none_or(|e| e != "md") {
        return Err(refuse());
    }
    for base in bases {
        let Ok(rel) = path.strip_prefix(base) else {
            continue;
        };
        let parts: Vec<_> = rel.components().collect();
        let first = parts.first().and_then(|c| c.as_os_str().to_str());
        match first {
            Some("agents") | Some("commands") if parts.len() >= 2 => {
                return Ok(ItemPath {
                    unit: path.clone(),
                    path,
                    base: base.clone(),
                });
            }
            Some("skills") if parts.len() == 3 && parts[2].as_os_str() == "SKILL.md" => {
                return Ok(ItemPath {
                    unit: path.parent().unwrap().to_path_buf(),
                    path,
                    base: base.clone(),
                });
            }
            _ => {}
        }
    }
    Err(refuse())
}

pub fn read_item(bases: &[PathBuf], requested: &str) -> Result<String, String> {
    let p = resolve_item_path(bases, requested)?;
    std::fs::read_to_string(&p.path).map_err(|e| e.to_string())
}

pub fn save_item(bases: &[PathBuf], requested: &str, content: &str) -> SaveResult {
    match resolve_item_path(bases, requested) {
        Ok(p) => crate::writer::save_text_to_path(&p.path, content),
        Err(e) => crate::writer::save_err(e),
    }
}

/// Move the item (a skill's whole directory) to
/// `<base>/.crab-trash/<ms>/<same relative path>` and return where it went.
pub fn delete_item(bases: &[PathBuf], requested: &str) -> Result<String, String> {
    let p = resolve_item_path(bases, requested)?;
    let rel = p.unit.strip_prefix(&p.base).map_err(|e| e.to_string())?;
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = p.base.join(".crab-trash").join(ms.to_string()).join(rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create trash: {e}"))?;
    }
    std::fs::rename(&p.unit, &dest).map_err(|e| format!("move to trash failed: {e}"))?;
    Ok(crate::util::tildify(&dest))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn setup() -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "cc-items-edit-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let user = root.join("home/.claude");
        let proj = root.join("proj/.claude");
        for d in [
            user.join("agents/team"),
            user.join("commands"),
            user.join("skills/review/scripts"),
            proj.join("agents"),
            root.join("home/.claude/plugins/cache/p/agents"),
        ] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(
            user.join("agents/team/reviewer.md"),
            "---\nname: reviewer\n---\nReview.\n",
        )
        .unwrap();
        std::fs::write(user.join("commands/ship.md"), "Ship it\n").unwrap();
        std::fs::write(
            user.join("skills/review/SKILL.md"),
            "---\nname: review\n---\n",
        )
        .unwrap();
        std::fs::write(user.join("skills/review/scripts/run.sh"), "echo hi\n").unwrap();
        std::fs::write(proj.join("agents/local.md"), "Local agent\n").unwrap();
        std::fs::write(
            root.join("home/.claude/plugins/cache/p/agents/plug.md"),
            "plugin\n",
        )
        .unwrap();
        std::fs::write(user.join("settings.json"), "{}").unwrap();
        (root, user, proj)
    }

    fn s(p: &Path) -> String {
        p.display().to_string()
    }

    #[test]
    fn guard_allows_only_user_and_project_items() {
        let (root, user, proj) = setup();
        let bases = vec![user.clone(), proj.clone()];
        for ok in [
            user.join("agents/team/reviewer.md"),
            user.join("commands/ship.md"),
            user.join("skills/review/SKILL.md"),
            proj.join("agents/local.md"),
        ] {
            assert!(resolve_item_path(&bases, &s(&ok)).is_ok(), "{ok:?}");
        }
        for bad in [
            root.join("home/.claude/plugins/cache/p/agents/plug.md"),
            user.join("settings.json"),
            user.join("skills/review/scripts/run.sh"),
            user.join("agents/missing.md"),
            user.join("agents/team/../../settings.json"),
            user.join("CLAUDE.md"),
        ] {
            assert!(resolve_item_path(&bases, &s(&bad)).is_err(), "{bad:?}");
        }
        let skill = resolve_item_path(&bases, &s(&user.join("skills/review/SKILL.md"))).unwrap();
        assert_eq!(skill.unit, user.join("skills/review"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn save_overwrites_with_backup() {
        let (root, user, proj) = setup();
        let bases = vec![user.clone(), proj];
        let target = s(&user.join("commands/ship.md"));
        assert_eq!(read_item(&bases, &target).unwrap(), "Ship it\n");
        let r = save_item(&bases, &target, "Ship it carefully\n");
        assert!(r.ok, "{:?}", r.error);
        assert!(r.backup_path.is_some());
        assert_eq!(
            std::fs::read_to_string(user.join("commands/ship.md")).unwrap(),
            "Ship it carefully\n"
        );
        assert!(!save_item(&bases, &s(&user.join("settings.json")), "{}").ok);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_moves_to_trash_outside_scanned_dirs() {
        let (root, user, proj) = setup();
        let bases = vec![user.clone(), proj];
        delete_item(&bases, &s(&user.join("agents/team/reviewer.md"))).unwrap();
        assert!(!user.join("agents/team/reviewer.md").exists());
        // A whole skill directory moves as a unit, resources included.
        delete_item(&bases, &s(&user.join("skills/review/SKILL.md"))).unwrap();
        assert!(!user.join("skills/review").exists());
        let trash = user.join(".crab-trash");
        let stamps: Vec<_> = std::fs::read_dir(&trash).unwrap().flatten().collect();
        assert!(!stamps.is_empty());
        let mut found_agent = false;
        let mut found_script = false;
        for st in stamps {
            found_agent |= st.path().join("agents/team/reviewer.md").exists();
            found_script |= st.path().join("skills/review/scripts/run.sh").exists();
        }
        assert!(found_agent && found_script);
        // Nothing under agents/ or skills/ still points at them.
        assert!(crate::items::scan_md_dir_for_test(&user.join("agents")).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}
