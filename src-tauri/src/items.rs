//! Discovery of file-backed items: agents, slash commands, and skills.
//! Sources: user (~/.claude), project (<proj>/.claude), and installed plugins.

use std::path::{Path, PathBuf};

use crate::model::*;
use crate::util::{claude_dir, read_text, tildify};

const PREVIEW_CAP: usize = 4000;

/// Parse a leading `--- ... ---` YAML-ish frontmatter block for `name` and
/// `description`. Intentionally tiny — no YAML dependency — but handles the
/// multi-line forms skills commonly use: `>` / `|` block scalars and plain
/// values continued on indented lines.
fn parse_frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let trimmed = text.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    let after = &trimmed[3..];
    let Some(end) = after.find("\n---") else {
        return (None, None);
    };
    let lines: Vec<&str> = after[..end]
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .collect();
    let mut name = None;
    let mut description = None;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        i += 1;
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if line.starts_with([' ', '\t']) {
            continue;
        }
        // Indented (or blank) lines that follow belong to this key.
        let mut cont = Vec::new();
        while i < lines.len() && (lines[i].starts_with([' ', '\t']) || lines[i].trim().is_empty()) {
            cont.push(lines[i].trim());
            i += 1;
        }
        let slot = match key.trim() {
            "name" => &mut name,
            "description" => &mut description,
            _ => continue,
        };
        *slot = Some(join_value(value.trim(), &cont));
    }
    (name, description)
}

fn join_value(value: &str, cont: &[&str]) -> String {
    let parts = cont.iter().copied().filter(|l| !l.is_empty());
    if value.starts_with('|') {
        parts.collect::<Vec<_>>().join("\n")
    } else if value.starts_with('>') {
        parts.collect::<Vec<_>>().join(" ")
    } else {
        let joined = std::iter::once(value)
            .chain(parts)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        clean_value(&joined)
    }
}

fn clean_value(s: &str) -> String {
    let s = s.trim();
    let s = s.trim_matches('"').trim_matches('\'');
    s.to_string()
}

fn preview_of(text: &str) -> String {
    if text.len() <= PREVIEW_CAP {
        text.to_string()
    } else {
        let mut end = PREVIEW_CAP;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n…", &text[..end])
    }
}

/// Recursively collect `*.md` files (excluding SKILL.md, handled separately).
fn collect_md(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_md(&path, out);
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            if path.file_name().map(|n| n == "SKILL.md").unwrap_or(false) {
                continue;
            }
            out.push(path);
        }
    }
}

fn item_from_md(path: &Path, source: &str, name_fallback_from_stem: bool) -> Item {
    let text = read_text(path).unwrap_or_default();
    let (fm_name, description) = parse_frontmatter(&text);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let name = match fm_name {
        Some(n) if !n.is_empty() => n,
        _ if name_fallback_from_stem => stem,
        _ => stem,
    };
    Item {
        name,
        description,
        source: source.to_string(),
        path: path.display().to_string(),
        display_path: tildify(path),
        preview: Some(preview_of(&text)),
        line_count: None,
    }
}

fn scan_md_dir(dir: &Path, source: &str) -> Vec<Item> {
    let mut files = Vec::new();
    if dir.is_dir() {
        collect_md(dir, &mut files);
    }
    files.sort();
    files
        .iter()
        .map(|p| item_from_md(p, source, true))
        .collect()
}

/// Scan a skills root: each immediate subdir with a SKILL.md is one skill.
#[cfg(test)]
pub fn scan_md_dir_for_test(dir: &Path) -> Vec<Item> {
    scan_md_dir(dir, "test")
}

fn scan_skills_dir(dir: &Path, source: &str) -> Vec<Item> {
    let mut items = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return items;
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    for d in dirs {
        let skill_file = d.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        let text = read_text(&skill_file).unwrap_or_default();
        let (fm_name, description) = parse_frontmatter(&text);
        let name = fm_name
            .filter(|n| !n.is_empty())
            .or_else(|| d.file_name().and_then(|n| n.to_str()).map(String::from))
            .unwrap_or_default();
        items.push(Item {
            name,
            description,
            source: source.to_string(),
            path: skill_file.display().to_string(),
            display_path: tildify(&skill_file),
            preview: Some(preview_of(&text)),
            line_count: None,
        });
    }
    items
}

/// Enumerate installed plugin install paths as (label, path).
pub(crate) fn plugin_roots() -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let file = claude_dir().join("plugins").join("installed_plugins.json");
    let Ok(Some(v)) = crate::util::read_json(&file) else {
        return out;
    };
    let Some(plugins) = v.get("plugins").and_then(|p| p.as_object()) else {
        return out;
    };
    for (full_id, entries) in plugins {
        if let Some(arr) = entries.as_array() {
            for e in arr {
                if let Some(p) = e.get("installPath").and_then(|x| x.as_str()) {
                    out.push((format!("plugin:{full_id}"), PathBuf::from(p)));
                }
            }
        }
    }
    out
}

/// First non-empty body line (after any frontmatter), minus heading marks —
/// a stand-in description for memory files, which rarely have frontmatter.
fn first_line(text: &str) -> Option<String> {
    let body = match text.trim_start().strip_prefix("---") {
        Some(rest) => rest.find("\n---").map_or("", |end| &rest[end + 4..]),
        None => text,
    };
    body.lines()
        .map(|l| l.trim().trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .map(String::from)
}

fn memory_item(path: &Path, name: String, source: &str) -> Item {
    let text = read_text(path).unwrap_or_default();
    let description = parse_frontmatter(&text).1.or_else(|| first_line(&text));
    Item {
        name,
        description,
        source: source.to_string(),
        path: path.display().to_string(),
        display_path: tildify(path),
        preview: Some(preview_of(&text)),
        line_count: Some(text.lines().count()),
    }
}

/// `CLAUDE.md` memory files and `rules/` directories that Claude Code loads
/// into context: user-level always, project-level when a project is in scope.
pub fn scan_memory(cdir: &Path, project: Option<&Path>) -> Vec<Item> {
    let mut out = Vec::new();
    push_memory(&mut out, cdir, "CLAUDE.md", "user");
    push_rules(&mut out, cdir, "rules", "user");
    if let Some(p) = project {
        push_memory(&mut out, p, "CLAUDE.md", "project");
        push_memory(&mut out, p, ".claude/CLAUDE.md", "project");
        push_rules(&mut out, p, ".claude/rules", "project");
        push_memory(&mut out, p, "CLAUDE.local.md", "project-local");
    }
    out
}

/// The directory name Claude Code uses under `~/.claude/projects/`: the path
/// with every non-alphanumeric character replaced by `-`.
pub fn project_slug(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Auto memory is keyed by the git repository, so worktrees and
/// subdirectories share it; outside a repo, the project root.
fn memory_root(project: &Path) -> &Path {
    project
        .ancestors()
        .find(|a| a.join(".git").exists())
        .unwrap_or(project)
}

/// The organization-wide CLAUDE.md for this OS.
pub fn managed_claude_md() -> PathBuf {
    if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/ClaudeCode/CLAUDE.md")
    } else if cfg!(windows) {
        PathBuf::from(r"C:\Program Files\ClaudeCode\CLAUDE.md")
    } else {
        PathBuf::from("/etc/claude-code/CLAUDE.md")
    }
}

/// `scan_memory` plus the read-only sources: CLAUDE.md files in parent
/// directories, AGENTS.md, the managed policy file and auto memory.
pub fn scan_memory_in(cdir: &Path, project: Option<&Path>, managed: Option<&Path>) -> Vec<Item> {
    let mut out = Vec::new();
    let label = |dir: &Path, file: &str| match dir.file_name() {
        Some(n) => format!("{}/{file}", n.to_string_lossy()),
        None => format!("/{file}"),
    };
    if let Some(p) = project {
        // Root first, matching the order Claude Code concatenates them in.
        let parents: Vec<&Path> = p.ancestors().skip(1).collect();
        for dir in parents.iter().rev() {
            for f in ["CLAUDE.md", "CLAUDE.local.md"] {
                let path = dir.join(f);
                if path.is_file() {
                    out.push(memory_item(&path, label(dir, f), "parent"));
                }
            }
        }
        for dir in parents.iter().rev().copied().chain([p]) {
            for f in ["AGENTS.md", ".claude/AGENTS.md"] {
                let path = dir.join(f);
                if path.is_file() {
                    let name = if dir == p {
                        f.to_string()
                    } else {
                        label(dir, f)
                    };
                    out.push(memory_item(&path, name, "agents-md"));
                }
            }
        }
    }
    if let Some(m) = managed.filter(|m| m.is_file()) {
        out.push(memory_item(m, "CLAUDE.md".into(), "managed"));
    }
    if let Some(p) = project {
        let dir = cdir
            .join("projects")
            .join(project_slug(memory_root(p)))
            .join("memory");
        let mut files = Vec::new();
        collect_md(&dir, &mut files);
        // The MEMORY.md index first, then topic files.
        files.sort_by_key(|f| (!f.ends_with("MEMORY.md"), f.clone()));
        for f in files {
            let name = f
                .strip_prefix(&dir)
                .unwrap_or(&f)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(memory_item(&f, name, "auto-memory"));
        }
    }
    out
}

fn push_memory(out: &mut Vec<Item>, base: &Path, rel: &str, source: &str) {
    let path = base.join(rel);
    if path.is_file() {
        out.push(memory_item(&path, rel.to_string(), source));
    }
}

/// Every `*.md` under `base/rel`, named by its path relative to `base`.
fn push_rules(out: &mut Vec<Item>, base: &Path, rel: &str, source: &str) {
    let mut files = Vec::new();
    collect_md(&base.join(rel), &mut files);
    files.sort();
    for f in files {
        let name = f
            .strip_prefix(base)
            .unwrap_or(&f)
            .to_string_lossy()
            .replace('\\', "/");
        out.push(memory_item(&f, name, source));
    }
}

pub fn get_items(scope: &Scope) -> ItemsDomain {
    let cdir = claude_dir();
    let mut agents = Vec::new();
    let mut commands = Vec::new();
    let mut skills = Vec::new();
    let mut output_styles = Vec::new();
    let project = match (&scope.kind, &scope.path) {
        (ScopeKind::Project, Some(p)) => Some(PathBuf::from(p)),
        _ => None,
    };
    let mut memory = scan_memory(&cdir, project.as_deref());
    memory.extend(scan_memory_in(
        &cdir,
        project.as_deref(),
        Some(&managed_claude_md()),
    ));

    // User scope (always shown).
    agents.extend(scan_md_dir(&cdir.join("agents"), "user"));
    commands.extend(scan_md_dir(&cdir.join("commands"), "user"));
    skills.extend(scan_skills_dir(&cdir.join("skills"), "user"));
    output_styles.extend(scan_md_dir(&cdir.join("output-styles"), "user"));

    // Project scope.
    if scope.kind == ScopeKind::Project {
        if let Some(p) = &scope.path {
            let pdir = PathBuf::from(p).join(".claude");
            agents.extend(scan_md_dir(&pdir.join("agents"), "project"));
            commands.extend(scan_md_dir(&pdir.join("commands"), "project"));
            skills.extend(scan_skills_dir(&pdir.join("skills"), "project"));
            output_styles.extend(scan_md_dir(&pdir.join("output-styles"), "project"));
        }
    }

    // Plugin-provided.
    for (label, root) in plugin_roots() {
        agents.extend(scan_md_dir(&root.join("agents"), &label));
        commands.extend(scan_md_dir(&root.join("commands"), &label));
        skills.extend(scan_skills_dir(&root.join("skills"), &label));
        output_styles.extend(scan_md_dir(&root.join("output-styles"), &label));
    }

    ItemsDomain {
        agents,
        commands,
        skills,
        output_styles,
        memory,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "cc-items-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    #[test]
    fn scans_user_and_project_memory_files() {
        let root = tmp("memory");
        let cdir = root.join("home/.claude");
        let proj = root.join("proj");
        write(&cdir.join("CLAUDE.md"), "# My global rules\nbe terse\n");
        write(
            &cdir.join("rules/rust.md"),
            "---\ndescription: Rust style\n---\nuse clippy\n",
        );
        write(&proj.join("CLAUDE.md"), "Project notes\n");
        write(&proj.join(".claude/CLAUDE.md"), "# Nested\n");
        write(&proj.join("CLAUDE.local.md"), "\n\n## Personal\n");
        write(&proj.join(".claude/rules/api/http.md"), "# HTTP rules\n");
        write(&proj.join("README.md"), "not memory");

        let items = scan_memory(&cdir, Some(&proj));
        let got: Vec<(String, String, Option<String>)> = items
            .iter()
            .map(|i| (i.source.clone(), i.name.clone(), i.description.clone()))
            .collect();
        let d = |s: &str| Some(s.to_string());
        assert_eq!(
            got,
            vec![
                ("user".into(), "CLAUDE.md".into(), d("My global rules")),
                ("user".into(), "rules/rust.md".into(), d("Rust style")),
                ("project".into(), "CLAUDE.md".into(), d("Project notes")),
                ("project".into(), ".claude/CLAUDE.md".into(), d("Nested")),
                (
                    "project".into(),
                    ".claude/rules/api/http.md".into(),
                    d("HTTP rules")
                ),
                (
                    "project-local".into(),
                    "CLAUDE.local.md".into(),
                    d("Personal")
                ),
            ]
        );
        assert!(items[0].preview.as_deref().unwrap().contains("be terse"));
        assert_eq!(items[0].line_count, Some(2));

        // Global scope: user files only.
        assert_eq!(scan_memory(&cdir, None).len(), 2);
        std::fs::remove_dir_all(&root).ok();
    }

    fn fm(s: &str) -> (Option<String>, Option<String>) {
        parse_frontmatter(s)
    }

    #[test]
    fn single_line_values() {
        let (n, d) = fm("---\nname: review\ndescription: \"Reviews code\"\n---\nbody");
        assert_eq!(n.as_deref(), Some("review"));
        assert_eq!(d.as_deref(), Some("Reviews code"));
    }

    #[test]
    fn no_frontmatter() {
        assert_eq!(fm("# Just markdown"), (None, None));
    }

    #[test]
    fn folded_block_description() {
        let (n, d) = fm("---\nname: x\ndescription: >\n  First line\n  second line.\n---\n");
        assert_eq!(n.as_deref(), Some("x"));
        assert_eq!(d.as_deref(), Some("First line second line."));
    }

    #[test]
    fn literal_block_description_keeps_newlines() {
        let (_, d) = fm("---\ndescription: |-\n  Line one\n  Line two\nname: y\n---\n");
        assert_eq!(d.as_deref(), Some("Line one\nLine two"));
    }

    #[test]
    fn plain_multiline_continuation() {
        let (_, d) =
            fm("---\ndescription: Use when the user\n  asks for a review.\nname: z\n---\n");
        assert_eq!(d.as_deref(), Some("Use when the user asks for a review."));
    }

    #[test]
    fn quoted_value_spanning_lines() {
        let (_, d) = fm("---\ndescription: \"Use when\n  reviewing.\"\n---\n");
        assert_eq!(d.as_deref(), Some("Use when reviewing."));
    }

    #[test]
    fn crlf_line_endings() {
        let (n, d) = fm("---\r\nname: w\r\ndescription: >\r\n  a\r\n  b\r\n---\r\n");
        assert_eq!(n.as_deref(), Some("w"));
        assert_eq!(d.as_deref(), Some("a b"));
    }

    #[test]
    fn scans_parent_agents_managed_and_auto_memory() {
        let root = tmp("memory-extra");
        let cdir = root.join("home/.claude");
        let repo = root.join("repo");
        let proj = repo.join("sub");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        write(&repo.join("CLAUDE.md"), "Repo rules\n");
        write(&repo.join("CLAUDE.local.md"), "Mine\n");
        write(&proj.join("AGENTS.md"), "Agents file\n");
        write(&root.join("managed/CLAUDE.md"), "Org policy\n");
        let mem = cdir
            .join("projects")
            .join(project_slug(&repo))
            .join("memory");
        write(&mem.join("MEMORY.md"), "- [Role](user_role.md)\n");
        write(&mem.join("user_role.md"), "Senior dev\n");

        let items = scan_memory_in(&cdir, Some(&proj), Some(&root.join("managed/CLAUDE.md")));
        let got: Vec<(String, String)> = items
            .iter()
            .map(|i| (i.source.clone(), i.name.clone()))
            .collect();
        let e = |a: &str, b: &str| (a.to_string(), b.to_string());
        assert_eq!(
            got,
            vec![
                e("parent", "repo/CLAUDE.md"),
                e("parent", "repo/CLAUDE.local.md"),
                e("agents-md", "AGENTS.md"),
                e("managed", "CLAUDE.md"),
                e("auto-memory", "MEMORY.md"),
                e("auto-memory", "user_role.md"),
            ]
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn project_slug_matches_claude_code() {
        assert_eq!(
            project_slug(Path::new("/home/user/crab-control")),
            "-home-user-crab-control"
        );
        assert_eq!(
            project_slug(Path::new("/Users/a.b/my_app")),
            "-Users-a-b-my-app"
        );
    }
}
