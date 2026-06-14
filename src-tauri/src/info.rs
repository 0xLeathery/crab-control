//! App-level info (overview screen) and the recent-projects list used by the
//! scope picker.

use std::path::{Path, PathBuf};

use crate::mcp::{claude_output, resolve_claude};
use crate::model::{AppInfo, ProjectRef};
use crate::settings::managed_path;
use crate::util::{claude_dir, home, read_json, tildify};

pub fn app_info(cache_dir: &Path) -> AppInfo {
    let claude_path = resolve_claude();
    let claude_version = claude_path.as_ref().and_then(|_| {
        claude_output(&["--version"])
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });
    let managed = managed_path();
    let (schema_cached, schema_at) = crate::schema::cache_info(cache_dir);

    AppInfo {
        home: home().display().to_string(),
        claude_dir: tildify(&claude_dir()),
        claude_found: claude_path.is_some(),
        claude_path: claude_path.as_ref().map(|p| p.display().to_string()),
        claude_version,
        managed_path: managed.display().to_string(),
        managed_present: managed.exists(),
        schema_url: crate::schema::discover_schema_url(),
        schema_cached,
        schema_cached_at: schema_at.map(|ms| ms.to_string()),
    }
}

/// Recent projects from ~/.claude.json `projects`, preserving file order.
pub fn list_projects() -> Vec<ProjectRef> {
    let mut out = Vec::new();
    let Ok(Some(v)) = read_json(&home().join(".claude.json")) else {
        return out;
    };
    let Some(projects) = v.get("projects").and_then(|p| p.as_object()) else {
        return out;
    };
    for path in projects.keys() {
        let pb = PathBuf::from(path);
        let claude_dir = pb.join(".claude");
        let has_local_settings = claude_dir.join("settings.local.json").exists()
            || claude_dir.join("settings.json").exists();
        let name = pb
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path)
            .to_string();
        out.push(ProjectRef {
            display_path: tildify(&pb),
            name,
            exists: pb.exists(),
            has_local_settings,
            path: path.clone(),
        });
    }
    out
}
