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
        });
    }
    items
}

/// Enumerate installed plugin install paths as (label, path).
fn plugin_roots() -> Vec<(String, PathBuf)> {
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

pub fn get_items(scope: &Scope) -> ItemsDomain {
    let cdir = claude_dir();
    let mut agents = Vec::new();
    let mut commands = Vec::new();
    let mut skills = Vec::new();

    // User scope (always shown).
    agents.extend(scan_md_dir(&cdir.join("agents"), "user"));
    commands.extend(scan_md_dir(&cdir.join("commands"), "user"));
    skills.extend(scan_skills_dir(&cdir.join("skills"), "user"));

    // Project scope.
    if scope.kind == ScopeKind::Project {
        if let Some(p) = &scope.path {
            let pdir = PathBuf::from(p).join(".claude");
            agents.extend(scan_md_dir(&pdir.join("agents"), "project"));
            commands.extend(scan_md_dir(&pdir.join("commands"), "project"));
            skills.extend(scan_skills_dir(&pdir.join("skills"), "project"));
        }
    }

    // Plugin-provided.
    for (label, root) in plugin_roots() {
        agents.extend(scan_md_dir(&root.join("agents"), &label));
        commands.extend(scan_md_dir(&root.join("commands"), &label));
        skills.extend(scan_skills_dir(&root.join("skills"), &label));
    }

    ItemsDomain {
        agents,
        commands,
        skills,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
