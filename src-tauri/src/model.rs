//! Serde types that form the contract with the TypeScript frontend.
//! All renamed to camelCase for idiomatic JS.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Which config scope the user is viewing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub kind: ScopeKind,
    #[serde(default)]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScopeKind {
    Global,
    Project,
}

/// Settings layers, lowest → highest precedence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Layer {
    User,
    UserLocal,
    Project,
    ProjectLocal,
    Managed,
}

impl Layer {
    pub fn label(self) -> &'static str {
        match self {
            Layer::User => "User",
            Layer::UserLocal => "User (local)",
            Layer::Project => "Project",
            Layer::ProjectLocal => "Project (local)",
            Layer::Managed => "Managed",
        }
    }
}

/// One physical settings file in a layer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerFile {
    pub layer: Layer,
    pub label: String,
    pub path: String,
    pub display_path: String,
    pub present: bool,
    /// True for managed/enterprise — never writable.
    pub read_only: bool,
    /// Parsed + masked JSON content, if present and valid.
    pub content: Option<Value>,
    /// Parse error message, if the file exists but is not valid JSON.
    pub error: Option<String>,
}

/// An effective top-level setting key after applying precedence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveSetting {
    pub key: String,
    pub value: Value,
    pub source: Layer,
    /// Lower-precedence layers that also defined this key (what got overridden).
    pub overridden: Vec<OverriddenValue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverriddenValue {
    pub layer: Layer,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDomain {
    pub files: Vec<LayerFile>,
    pub effective: Vec<EffectiveSetting>,
}

/// A discovered file-backed item: agent, command, or skill.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub name: String,
    pub description: Option<String>,
    pub source: String, // "user" | "project" | "plugin:<name>"
    pub path: String,
    pub display_path: String,
    /// Raw text preview (frontmatter + body), capped in size.
    pub preview: Option<String>,
    /// Total line count (memory files only; used for length guidance).
    pub line_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsDomain {
    pub agents: Vec<Item>,
    pub commands: Vec<Item>,
    pub skills: Vec<Item>,
    /// CLAUDE.md files and rules/ directories (read-only).
    pub memory: Vec<Item>,
}

/// One configured hook (from a settings layer's `hooks` block).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEntry {
    pub event: String,
    pub matcher: Option<String>,
    pub hook_type: String,
    pub command: Option<String>,
    pub source: Layer,
    /// Position within `hooks.<event>` / the group's `hooks` list, so the UI
    /// can target this hook for removal.
    pub group_index: usize,
    pub hook_index: usize,
}

/// An MCP server from any source.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub name: String,
    pub scope: String, // claude.ai | user | project (.mcp.json) | local | unknown
    pub transport: String, // stdio | http | sse | unknown
    /// Command (stdio) or URL (http/sse), already masked.
    pub target: Option<String>,
    pub status: Option<String>, // connected | needs auth | failed | pending | unknown
    pub source: String,         // where the definition lives
    /// A file definition has literal `env`/`headers` values instead of
    /// `${VAR}` expansion — risky in a shared `.mcp.json`.
    pub inline_secrets: bool,
}

/// Installed plugin merged with its enabled state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub name: String,        // short name
    pub marketplace: String, // marketplace id
    pub full_id: String,     // name@marketplace
    pub version: Option<String>,
    pub scope: Option<String>,
    pub install_path: Option<String>,
    pub display_install_path: Option<String>,
    pub enabled: Option<bool>, // None = default (enabled), Some(false) = disabled
    pub enabled_source: Option<Layer>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marketplace {
    pub id: String,
    pub source: Value,
    pub install_location: Option<String>,
    pub display_install_location: Option<String>,
    pub last_updated: Option<String>,
    pub auto_update: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsDomain {
    pub plugins: Vec<Plugin>,
    pub marketplaces: Vec<Marketplace>,
}

/// A recent project, read from ~/.claude.json `projects`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub path: String,
    pub display_path: String,
    pub name: String,
    pub exists: bool,
    pub has_local_settings: bool,
}

/// High-level environment / diagnostics for the overview screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_version: String,
    pub home: String,
    pub claude_dir: String,
    pub claude_found: bool,
    pub claude_path: Option<String>,
    pub claude_version: Option<String>,
    pub managed_path: String,
    pub managed_present: bool,
    pub schema_url: String,
    pub schema_cached: bool,
    pub schema_cached_at: Option<String>,
}
