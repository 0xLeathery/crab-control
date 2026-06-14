//! Fetch + cache the official Claude Code settings JSON schema.
//! Cached into the app's OS cache dir (never the user's config). Degrades to
//! the cached copy when offline, and reports cache state to the UI.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

pub const DEFAULT_SCHEMA_URL: &str = "https://json.schemastore.org/claude-code-settings.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaResult {
    pub url: String,
    pub from_cache: bool,
    pub fetched_at_ms: Option<u64>,
    pub schema: Option<Value>,
    pub error: Option<String>,
}

fn cache_file(dir: &Path) -> PathBuf {
    dir.join("settings-schema.json")
}
fn meta_file(dir: &Path) -> PathBuf {
    dir.join("settings-schema.meta.json")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Read the schema URL the user actually references in their settings.json,
/// falling back to the well-known default.
pub fn discover_schema_url() -> String {
    let settings = crate::util::claude_dir().join("settings.json");
    if let Ok(Some(v)) = crate::util::read_json(&settings) {
        if let Some(s) = v.get("$schema").and_then(|x| x.as_str()) {
            if s.starts_with("http") {
                return s.to_string();
            }
        }
    }
    DEFAULT_SCHEMA_URL.to_string()
}

fn load_cached(dir: &Path) -> Option<(Value, Option<u64>)> {
    let text = std::fs::read_to_string(cache_file(dir)).ok()?;
    let schema: Value = serde_json::from_str(&text).ok()?;
    let fetched = std::fs::read_to_string(meta_file(dir))
        .ok()
        .and_then(|m| serde_json::from_str::<Value>(&m).ok())
        .and_then(|m| m.get("fetchedAtMs").and_then(|x| x.as_u64()));
    Some((schema, fetched))
}

/// Is a cached schema already on disk? (cheap check for the overview screen)
pub fn cache_info(dir: &Path) -> (bool, Option<u64>) {
    match load_cached(dir) {
        Some((_, ts)) => (true, ts),
        None => (false, None),
    }
}

/// Fetch from network, fall back to cache. When `force` is false and a cache
/// exists, the cache is returned without a network call.
pub fn get_schema(dir: &Path, force: bool) -> SchemaResult {
    let url = discover_schema_url();

    if !force {
        if let Some((schema, fetched)) = load_cached(dir) {
            return SchemaResult {
                url,
                from_cache: true,
                fetched_at_ms: fetched,
                schema: Some(schema),
                error: None,
            };
        }
    }

    match fetch(&url) {
        Ok(schema) => {
            let _ = std::fs::create_dir_all(dir);
            let ts = now_ms();
            let _ = std::fs::write(
                cache_file(dir),
                serde_json::to_vec_pretty(&schema).unwrap_or_default(),
            );
            let _ = std::fs::write(
                meta_file(dir),
                serde_json::to_vec(&serde_json::json!({ "fetchedAtMs": ts, "url": url }))
                    .unwrap_or_default(),
            );
            SchemaResult {
                url,
                from_cache: false,
                fetched_at_ms: Some(ts),
                schema: Some(schema),
                error: None,
            }
        }
        Err(e) => {
            // Network failed — degrade to cache if we have one.
            if let Some((schema, fetched)) = load_cached(dir) {
                SchemaResult {
                    url,
                    from_cache: true,
                    fetched_at_ms: fetched,
                    schema: Some(schema),
                    error: Some(format!("offline; using cached schema ({e})")),
                }
            } else {
                SchemaResult {
                    url,
                    from_cache: false,
                    fetched_at_ms: None,
                    schema: None,
                    error: Some(e),
                }
            }
        }
    }
}

fn fetch(url: &str) -> Result<Value, String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| format!("{e}"))?;
    let text = resp.into_string().map_err(|e| format!("{e}"))?;
    serde_json::from_str::<Value>(&text).map_err(|e| format!("invalid schema JSON: {e}"))
}
