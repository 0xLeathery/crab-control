//! Claude Control — Tauri backend.
//! Phase 1 is strictly read-only: every command discovers and returns config
//! state; nothing here writes to the user's config files.

mod creator;
mod edits;
mod importer;
mod info;
mod items;
mod mcp;
mod model;
mod plugins;
mod schema;
mod secrets;
mod settings;
mod util;
mod writer;

use std::path::PathBuf;

use model::*;
use tauri::Manager;

fn cache_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_cache_dir()
        .unwrap_or_else(|_| util::home().join(".cache/claude-control"))
}

#[tauri::command]
async fn app_info(app: tauri::AppHandle) -> AppInfo {
    // async so the `claude --version` call runs off the UI thread.
    info::app_info(&cache_dir(&app))
}

#[tauri::command]
fn list_projects() -> Vec<ProjectRef> {
    info::list_projects()
}

#[tauri::command]
fn read_settings(scope: Scope) -> SettingsDomain {
    settings::get_settings(&scope)
}

#[tauri::command]
fn read_hooks(scope: Scope) -> Vec<HookEntry> {
    settings::get_hooks(&scope)
}

#[tauri::command]
fn read_items(scope: Scope) -> ItemsDomain {
    items::get_items(&scope)
}

#[tauri::command]
fn read_plugins(scope: Scope) -> PluginsDomain {
    plugins::get_plugins(&scope)
}

#[tauri::command]
async fn read_mcp(scope: Scope) -> Vec<McpServer> {
    // Heavy (spawns the claude CLI + health checks) — run on the blocking pool
    // so it never freezes the UI thread.
    tauri::async_runtime::spawn_blocking(move || mcp::get_mcp(&scope))
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn fetch_schema(app: tauri::AppHandle, force: bool) -> schema::SchemaResult {
    let dir = cache_dir(&app);
    tauri::async_runtime::spawn_blocking(move || schema::get_schema(&dir, force))
        .await
        .unwrap_or_else(|e| schema::SchemaResult {
            url: String::new(),
            from_cache: false,
            fetched_at_ms: None,
            schema: None,
            error: Some(format!("task failed: {e}")),
        })
}

// ---- Phase 2: safe editing (raw JSON) ----

#[tauri::command]
fn read_raw_settings(scope: Scope, layer: Layer) -> Result<writer::RawFile, String> {
    writer::read_raw(&scope, layer)
}

#[tauri::command]
fn validate_json(content: String) -> writer::ValidateResult {
    writer::validate_json(&content)
}

#[tauri::command]
fn save_settings(scope: Scope, layer: Layer, content: String) -> writer::SaveResult {
    writer::save_settings(&scope, layer, &content)
}

// ---- Phase 2: structured edits (preview → confirm → save) ----

#[tauri::command]
fn preview_set_setting(
    scope: Scope,
    layer: Layer,
    key_path: Vec<String>,
    value: serde_json::Value,
) -> Result<edits::MutationPreview, String> {
    edits::preview_set_key(&scope, layer, key_path, value)
}

#[tauri::command]
fn preview_remove_setting(
    scope: Scope,
    layer: Layer,
    key_path: Vec<String>,
) -> Result<edits::MutationPreview, String> {
    edits::preview_remove_key(&scope, layer, key_path)
}

#[tauri::command]
fn preview_plugin_toggle(
    scope: Scope,
    full_id: String,
    enabled: bool,
) -> Result<edits::MutationPreview, String> {
    edits::preview_plugin_toggle(&scope, &full_id, enabled)
}

#[tauri::command]
fn preview_permission_rule(
    scope: Scope,
    layer: Layer,
    list: String,
    rule: String,
    add: bool,
) -> Result<edits::MutationPreview, String> {
    edits::preview_permission_rule(&scope, layer, &list, &rule, add)
}

#[tauri::command]
fn preview_hook_add(
    scope: Scope,
    layer: Layer,
    event: String,
    matcher: Option<String>,
    command: String,
    timeout: Option<u64>,
) -> Result<edits::MutationPreview, String> {
    edits::preview_hook_add(&scope, layer, &event, matcher, &command, timeout)
}

#[tauri::command]
fn preview_hook_remove(
    scope: Scope,
    layer: Layer,
    event: String,
    group_index: usize,
    hook_index: usize,
) -> Result<edits::MutationPreview, String> {
    edits::preview_hook_remove(&scope, layer, &event, group_index, hook_index)
}

#[tauri::command]
fn preview_mcp_toggle(
    scope: Scope,
    name: String,
    enabled: bool,
) -> Result<edits::MutationPreview, String> {
    edits::preview_mcp_toggle(&scope, &name, enabled)
}

#[tauri::command]
async fn mcp_remove(name: String, scope_flag: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mcp::remove(&name, &scope_flag))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

// ---- Phase 3: creation flows + snapshot export ----

#[tauri::command]
fn create_item(
    scope: Scope,
    kind: String,
    name: String,
    content: String,
) -> Result<creator::CreateResult, String> {
    creator::create_item(&scope, &kind, &name, &content)
}

#[tauri::command]
fn mcp_add_preview(spec: creator::McpAddSpec) -> String {
    creator::mcp_add_display(&spec)
}

#[tauri::command]
async fn mcp_add(spec: creator::McpAddSpec) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || creator::mcp_add(&spec))
        .await
        .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
fn export_snapshot(scope: Scope) -> Result<creator::ExportResult, String> {
    creator::export_snapshot(&scope, None)
}

#[tauri::command]
fn list_snapshots() -> Vec<importer::SnapshotRef> {
    importer::list_snapshots()
}

#[tauri::command]
fn preview_import(scope: Scope, path: String) -> Result<importer::ImportPlan, String> {
    importer::preview_import(&scope, &path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_process::init());

    // Auto-update is desktop-only.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_projects,
            read_settings,
            read_hooks,
            read_items,
            read_plugins,
            read_mcp,
            fetch_schema,
            read_raw_settings,
            validate_json,
            save_settings,
            preview_set_setting,
            preview_remove_setting,
            preview_plugin_toggle,
            preview_mcp_toggle,
            preview_permission_rule,
            preview_hook_add,
            preview_hook_remove,
            mcp_remove,
            create_item,
            mcp_add_preview,
            mcp_add,
            export_snapshot,
            list_snapshots,
            preview_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn global() -> Scope {
        Scope {
            kind: ScopeKind::Global,
            path: None,
        }
    }

    #[test]
    fn dump_global_inventory() {
        let scope = global();

        let s = settings::get_settings(&scope);
        eprintln!(
            "\n== SETTINGS == files={} effective_keys={}",
            s.files.len(),
            s.effective.len()
        );
        for f in &s.files {
            eprintln!(
                "  [{:?}] present={} readonly={} {}",
                f.layer, f.present, f.read_only, f.display_path
            );
        }
        for e in &s.effective {
            eprintln!(
                "  {} <= {:?} (overrode {})",
                e.key,
                e.source,
                e.overridden.len()
            );
        }
        // Sanity: secrets must never appear raw in serialized settings.
        let blob = serde_json::to_string(&s).unwrap();
        assert!(
            !blob.contains("ib_5c7753"),
            "raw secret leaked into settings!"
        );

        let p = plugins::get_plugins(&scope);
        eprintln!("\n== PLUGINS == {}", p.plugins.len());
        for pl in &p.plugins {
            eprintln!(
                "  {} v{:?} scope={:?} enabled={:?} src={:?}",
                pl.full_id, pl.version, pl.scope, pl.enabled, pl.enabled_source
            );
        }
        eprintln!("== MARKETPLACES == {}", p.marketplaces.len());
        for m in &p.marketplaces {
            eprintln!("  {} autoUpdate={:?}", m.id, m.auto_update);
        }

        let it = items::get_items(&scope);
        eprintln!(
            "\n== ITEMS == agents={} commands={} skills={}",
            it.agents.len(),
            it.commands.len(),
            it.skills.len()
        );
        for sk in it.skills.iter().take(6) {
            eprintln!("  skill: {} [{}]", sk.name, sk.source);
        }

        let h = settings::get_hooks(&scope);
        eprintln!("\n== HOOKS == {}", h.len());
        for hk in &h {
            eprintln!(
                "  {} matcher={:?} type={} [{:?}]",
                hk.event, hk.matcher, hk.hook_type, hk.source
            );
        }

        let pr = info::list_projects();
        eprintln!("\n== PROJECTS == {}", pr.len());
        for project in &pr {
            eprintln!("  {} {}", project.name, project.display_path);
        }
    }

    #[test]
    #[ignore = "spawns the real claude CLI; run with --ignored"]
    fn dump_mcp() {
        let m = mcp::get_mcp(&global());
        eprintln!("\n== MCP == {}", m.len());
        for s in &m {
            eprintln!(
                "  {} [{}] scope={} status={:?} target={:?}",
                s.name, s.transport, s.scope, s.status, s.target
            );
            if let Some(t) = &s.target {
                assert!(!t.contains("ib_5c7753"), "raw MCP secret leaked!");
            }
        }
    }
}
