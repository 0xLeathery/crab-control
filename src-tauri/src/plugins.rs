//! Plugin + marketplace discovery. Merges the install registry
//! (~/.claude/plugins/installed_plugins.json), the marketplace registry
//! (known_marketplaces.json), and the effective `enabledPlugins` map from the
//! settings layers (settings.json is the source of truth for enabled state).

use std::collections::HashMap;

use serde_json::Value;

use crate::model::*;
use crate::settings::get_settings;
use crate::util::{claude_dir, read_json, tildify};
use std::path::Path;

/// Build a plugin_id -> (enabled, source_layer) map by walking settings layers
/// low → high precedence so the highest layer wins.
fn effective_enabled(scope: &Scope) -> HashMap<String, (bool, Layer)> {
    let mut out: HashMap<String, (bool, Layer)> = HashMap::new();
    let domain = get_settings(scope);
    for file in &domain.files {
        if let Some(Value::Object(map)) = &file.content {
            if let Some(Value::Object(ep)) = map.get("enabledPlugins") {
                for (k, v) in ep {
                    if let Some(b) = v.as_bool() {
                        out.insert(k.clone(), (b, file.layer));
                    }
                }
            }
        }
    }
    out
}

fn display_opt(path: Option<&str>) -> Option<String> {
    path.map(|p| tildify(Path::new(p)))
}

pub fn get_plugins(scope: &Scope) -> PluginsDomain {
    let pdir = claude_dir().join("plugins");
    let enabled = effective_enabled(scope);

    // Installed plugins registry.
    let mut plugins: Vec<Plugin> = Vec::new();
    if let Ok(Some(v)) = read_json(&pdir.join("installed_plugins.json")) {
        if let Some(map) = v.get("plugins").and_then(|p| p.as_object()) {
            for (full_id, entries) in map {
                let (name, marketplace) = match full_id.split_once('@') {
                    Some((n, m)) => (n.to_string(), m.to_string()),
                    None => (full_id.clone(), String::new()),
                };
                // An install entry is an array (possibly multiple scopes).
                let first = entries.as_array().and_then(|a| a.first());
                let version = first
                    .and_then(|e| e.get("version"))
                    .and_then(|x| x.as_str())
                    .map(String::from);
                let pscope = first
                    .and_then(|e| e.get("scope"))
                    .and_then(|x| x.as_str())
                    .map(String::from);
                let install_path = first
                    .and_then(|e| e.get("installPath"))
                    .and_then(|x| x.as_str())
                    .map(String::from);
                let (enabled_flag, enabled_source) = match enabled.get(full_id) {
                    Some((b, layer)) => (Some(*b), Some(*layer)),
                    None => (None, None),
                };
                plugins.push(Plugin {
                    name,
                    marketplace,
                    full_id: full_id.clone(),
                    version,
                    scope: pscope,
                    display_install_path: display_opt(install_path.as_deref()),
                    install_path,
                    enabled: enabled_flag,
                    enabled_source,
                });
            }
        }
    }
    plugins.sort_by(|a, b| a.full_id.cmp(&b.full_id));

    // Marketplaces registry.
    let mut marketplaces: Vec<Marketplace> = Vec::new();
    if let Ok(Some(v)) = read_json(&pdir.join("known_marketplaces.json")) {
        if let Some(map) = v.as_object() {
            for (id, entry) in map {
                let install_location = entry
                    .get("installLocation")
                    .and_then(|x| x.as_str())
                    .map(String::from);
                marketplaces.push(Marketplace {
                    id: id.clone(),
                    source: entry.get("source").cloned().unwrap_or(Value::Null),
                    display_install_location: display_opt(install_location.as_deref()),
                    install_location,
                    last_updated: entry
                        .get("lastUpdated")
                        .and_then(|x| x.as_str())
                        .map(String::from),
                    auto_update: entry.get("autoUpdate").and_then(|x| x.as_bool()),
                });
            }
        }
    }
    marketplaces.sort_by(|a, b| a.id.cmp(&b.id));

    PluginsDomain {
        plugins,
        marketplaces,
    }
}
