//! Read and edit CLAUDE.md memory files. Writes are limited to the memory
//! locations Claude Code loads and go through writer's backup + atomic write.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::writer::SaveResult;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTarget {
    pub name: String,
    pub source: String,
    pub path: String,
    pub display_path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub path: String,
    pub display_path: String,
    pub exists: bool,
    pub text: String,
}

/// The standard memory files Claude Code loads (whether or not they exist yet).
fn standard_paths(cdir: &Path, project: Option<&Path>) -> Vec<(String, String, PathBuf)> {
    let mut out = vec![("CLAUDE.md".into(), "user".into(), cdir.join("CLAUDE.md"))];
    if let Some(p) = project {
        out.push(("CLAUDE.md".into(), "project".into(), p.join("CLAUDE.md")));
        out.push((
            ".claude/CLAUDE.md".into(),
            "project".into(),
            p.join(".claude/CLAUDE.md"),
        ));
        out.push((
            "CLAUDE.local.md".into(),
            "project-local".into(),
            p.join("CLAUDE.local.md"),
        ));
    }
    out
}

pub fn memory_targets(cdir: &Path, project: Option<&Path>) -> Vec<MemoryTarget> {
    standard_paths(cdir, project)
        .into_iter()
        .map(|(name, source, path)| MemoryTarget {
            name,
            source,
            display_path: crate::util::tildify(&path),
            exists: path.exists(),
            path: path.display().to_string(),
        })
        .collect()
}

/// Accept a standard memory file, or an existing `*.md` under a `rules/`
/// directory (no `..` components). Anything else is refused.
pub fn resolve_memory_path(
    cdir: &Path,
    project: Option<&Path>,
    requested: &str,
) -> Result<PathBuf, String> {
    let req = PathBuf::from(requested);
    if standard_paths(cdir, project)
        .iter()
        .any(|(_, _, p)| *p == req)
    {
        return Ok(req);
    }
    let mut rule_dirs = vec![cdir.join("rules")];
    if let Some(p) = project {
        rule_dirs.push(p.join(".claude/rules"));
    }
    let plain = req
        .components()
        .all(|c| !matches!(c, std::path::Component::ParentDir));
    let is_md = req.extension().is_some_and(|e| e == "md");
    if plain && is_md && req.is_file() && rule_dirs.iter().any(|d| req.starts_with(d)) {
        return Ok(req);
    }
    Err(format!(
        "not a memory file Crab Control can edit: {requested}"
    ))
}

pub fn read_memory(
    cdir: &Path,
    project: Option<&Path>,
    requested: &str,
) -> Result<MemoryFile, String> {
    let path = resolve_memory_path(cdir, project, requested)?;
    let exists = path.exists();
    let text = if exists {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    Ok(MemoryFile {
        display_path: crate::util::tildify(&path),
        path: path.display().to_string(),
        exists,
        text,
    })
}

pub fn save_memory(
    cdir: &Path,
    project: Option<&Path>,
    requested: &str,
    content: &str,
) -> SaveResult {
    match resolve_memory_path(cdir, project, requested) {
        Ok(path) => crate::writer::save_text_to_path(&path, content),
        Err(e) => crate::writer::save_err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "cc-memory-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn setup() -> (PathBuf, PathBuf, PathBuf) {
        let root = tmp("t");
        let cdir = root.join("home/.claude");
        let proj = root.join("proj");
        std::fs::create_dir_all(cdir.join("rules")).unwrap();
        std::fs::create_dir_all(proj.join(".claude/rules/api")).unwrap();
        std::fs::write(proj.join("CLAUDE.md"), "# Project\n").unwrap();
        std::fs::write(proj.join(".claude/rules/api/http.md"), "# HTTP\n").unwrap();
        std::fs::write(cdir.join("rules/style.md"), "terse\n").unwrap();
        std::fs::write(cdir.join("settings.json"), "{}").unwrap();
        (root, cdir, proj)
    }

    fn s(p: &Path) -> String {
        p.display().to_string()
    }

    #[test]
    fn targets_list_standard_files_with_existence() {
        let (root, cdir, proj) = setup();
        let got: Vec<(String, String, bool)> = memory_targets(&cdir, Some(&proj))
            .into_iter()
            .map(|t| (t.source, t.name, t.exists))
            .collect();
        assert_eq!(
            got,
            vec![
                ("user".into(), "CLAUDE.md".into(), false),
                ("project".into(), "CLAUDE.md".into(), true),
                ("project".into(), ".claude/CLAUDE.md".into(), false),
                ("project-local".into(), "CLAUDE.local.md".into(), false),
            ]
        );
        assert_eq!(memory_targets(&cdir, None).len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn guard_allows_only_memory_locations() {
        let (root, cdir, proj) = setup();
        let p = Some(proj.as_path());
        for ok in [
            cdir.join("CLAUDE.md"),
            proj.join("CLAUDE.md"),
            proj.join(".claude/CLAUDE.md"),
            proj.join("CLAUDE.local.md"),
            cdir.join("rules/style.md"),
            proj.join(".claude/rules/api/http.md"),
        ] {
            assert!(resolve_memory_path(&cdir, p, &s(&ok)).is_ok(), "{ok:?}");
        }
        for bad in [
            cdir.join("settings.json"),
            cdir.join(".credentials.json"),
            proj.join("README.md"),
            proj.join(".claude/rules/../../README.md"),
            proj.join(".claude/rules/new.md"),
            cdir.join("rules/notes.txt"),
        ] {
            assert!(resolve_memory_path(&cdir, p, &s(&bad)).is_err(), "{bad:?}");
        }
        // Project files are off-limits in global scope.
        assert!(resolve_memory_path(&cdir, None, &s(&proj.join("CLAUDE.md"))).is_err());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_returns_full_text() {
        let (root, cdir, proj) = setup();
        let long = "x\n".repeat(5000);
        std::fs::write(proj.join("CLAUDE.md"), &long).unwrap();
        let f = read_memory(&cdir, Some(&proj), &s(&proj.join("CLAUDE.md"))).unwrap();
        assert!(f.exists);
        assert_eq!(f.text, long);
        let missing = read_memory(&cdir, Some(&proj), &s(&proj.join("CLAUDE.local.md"))).unwrap();
        assert!(!missing.exists);
        assert_eq!(missing.text, "");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn save_writes_markdown_with_backup_and_creates_files() {
        let (root, cdir, proj) = setup();
        let target = s(&proj.join("CLAUDE.md"));
        // Not JSON — must still save.
        let r = save_memory(&cdir, Some(&proj), &target, "# Rules\n{ not json\n");
        assert!(r.ok, "{:?}", r.error);
        assert!(r.backup_path.is_some(), "existing file is backed up");
        assert_eq!(
            std::fs::read_to_string(proj.join("CLAUDE.md")).unwrap(),
            "# Rules\n{ not json\n"
        );
        // Creating a new standard file (and its parent dir).
        let r = save_memory(
            &cdir,
            Some(&proj),
            &s(&cdir.join("CLAUDE.md")),
            "be terse\n",
        );
        assert!(r.ok, "{:?}", r.error);
        assert!(cdir.join("CLAUDE.md").exists());
        // Refused outside the guard.
        assert!(!save_memory(&cdir, Some(&proj), &s(&proj.join("README.md")), "x").ok);
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn save_writes_through_a_symlinked_claude_md() {
        let (root, cdir, proj) = setup();
        let real = root.join("dotfiles/CLAUDE.md");
        std::fs::create_dir_all(real.parent().unwrap()).unwrap();
        std::fs::write(&real, "old\n").unwrap();
        std::os::unix::fs::symlink(&real, cdir.join("CLAUDE.md")).unwrap();
        let r = save_memory(&cdir, Some(&proj), &s(&cdir.join("CLAUDE.md")), "new\n");
        assert!(r.ok, "{:?}", r.error);
        assert!(std::fs::symlink_metadata(cdir.join("CLAUDE.md"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "new\n");
        std::fs::remove_dir_all(&root).ok();
    }
}
