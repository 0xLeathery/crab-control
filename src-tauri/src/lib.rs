//! Claude Control — Tauri backend.
//! Phase 1 is strictly read-only: every command discovers and returns config
//! state; nothing here writes to the user's config files.

mod backups;
mod creator;
mod edits;
mod extras;
mod importer;
mod info;
mod item_files;
mod items;
mod mcp;
mod mcp_edit;
mod memory;
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

fn memory_scope(scope: &Scope) -> (PathBuf, Option<PathBuf>) {
    let project = match (&scope.kind, &scope.path) {
        (ScopeKind::Project, Some(p)) => Some(PathBuf::from(p)),
        _ => None,
    };
    (util::claude_dir(), project)
}

/// Which file a History action is about: a settings layer or a memory file.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupTarget {
    kind: String,
    layer: Option<Layer>,
    path: Option<String>,
}

/// Resolve to (path, read_only, is_json) using the same guards as saving.
fn backup_target(scope: &Scope, t: &BackupTarget) -> Result<(PathBuf, bool, bool), String> {
    match t.kind.as_str() {
        "settings" => {
            let layer = t.layer.ok_or("layer required")?;
            let (path, read_only) = settings::layer_path(scope, layer)
                .ok_or_else(|| "layer not available for this scope".to_string())?;
            Ok((path, read_only, true))
        }
        "memory" => {
            let (cdir, project) = memory_scope(scope);
            let path = memory::resolve_memory_path(
                &cdir,
                project.as_deref(),
                t.path.as_deref().ok_or("path required")?,
            )?;
            Ok((path, false, false))
        }
        "item" => {
            let p = item_files::resolve_item_path(
                &item_bases(scope),
                t.path.as_deref().ok_or("path required")?,
            )?;
            Ok((p.path, false, false))
        }
        "keybindings" => Ok((extras::keybindings_path(&util::claude_dir()), false, true)),
        "statusline" => {
            let command = statusline_command(scope).ok_or("no status line command")?;
            let path = extras::statusline_script(&command, &util::home(), &item_bases(scope))
                .ok_or("the status line doesn't run an editable script")?;
            Ok((path, false, false))
        }
        other => Err(format!("unknown backup target: {other}")),
    }
}

/// The effective `statusLine.command`, read from the settings layers.
fn statusline_command(scope: &Scope) -> Option<String> {
    settings::get_settings(scope)
        .effective
        .into_iter()
        .find(|e| e.key == "statusLine")
        .and_then(|e| e.value.get("command")?.as_str().map(String::from))
}

#[tauri::command]
fn read_keybindings() -> Result<extras::TextFile, String> {
    extras::read_keybindings(&util::claude_dir())
}

#[tauri::command]
fn save_keybindings(content: String) -> writer::SaveResult {
    extras::save_keybindings(&util::claude_dir(), &content)
}

#[tauri::command]
fn read_statusline(scope: Scope) -> Result<Option<extras::StatusLine>, String> {
    match statusline_command(&scope) {
        Some(c) => extras::statusline(&c, &util::home(), &item_bases(&scope)).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
fn save_statusline_script(scope: Scope, content: String) -> writer::SaveResult {
    match statusline_command(&scope) {
        Some(c) => extras::save_statusline_script(&c, &util::home(), &item_bases(&scope), &content),
        None => writer::save_err("no status line is configured".into()),
    }
}

#[tauri::command]
fn list_backups(scope: Scope, target: BackupTarget) -> Result<Vec<backups::BackupEntry>, String> {
    let (path, _, _) = backup_target(&scope, &target)?;
    Ok(backups::list_backups(&path))
}

#[tauri::command]
fn read_backup(scope: Scope, target: BackupTarget, backup: String) -> Result<String, String> {
    let (path, _, _) = backup_target(&scope, &target)?;
    backups::read_backup(&path, &backup)
}

#[tauri::command]
fn restore_backup(scope: Scope, target: BackupTarget, backup: String) -> writer::SaveResult {
    match backup_target(&scope, &target) {
        Ok((path, read_only, json)) => backups::restore_backup(&path, &backup, read_only, json),
        Err(e) => writer::save_err(e),
    }
}

/// Bases whose agents/commands/skills are editable: user, plus project in scope.
fn item_bases(scope: &Scope) -> Vec<PathBuf> {
    let (cdir, project) = memory_scope(scope);
    let mut bases = vec![cdir];
    if let Some(p) = project {
        bases.push(p.join(".claude"));
    }
    bases
}

#[tauri::command]
fn read_item(scope: Scope, path: String) -> Result<String, String> {
    item_files::read_item(&item_bases(&scope), &path)
}

#[tauri::command]
fn save_item(scope: Scope, path: String, content: String) -> writer::SaveResult {
    item_files::save_item(&item_bases(&scope), &path, &content)
}

#[tauri::command]
fn delete_item(scope: Scope, path: String) -> Result<String, String> {
    item_files::delete_item(&item_bases(&scope), &path)
}

#[tauri::command]
fn list_memory_targets(scope: Scope) -> Vec<memory::MemoryTarget> {
    let (cdir, project) = memory_scope(&scope);
    memory::memory_targets(&cdir, project.as_deref())
}

#[tauri::command]
fn read_memory(scope: Scope, path: String) -> Result<memory::MemoryFile, String> {
    let (cdir, project) = memory_scope(&scope);
    memory::read_memory(&cdir, project.as_deref(), &path)
}

#[tauri::command]
fn save_memory(scope: Scope, path: String, content: String) -> writer::SaveResult {
    let (cdir, project) = memory_scope(&scope);
    memory::save_memory(&cdir, project.as_deref(), &path, &content)
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
    spec: edits::HookSpec,
) -> Result<edits::MutationPreview, String> {
    edits::preview_hook_add(&scope, layer, &event, matcher, spec)
}

#[tauri::command]
fn preview_hook_update(
    scope: Scope,
    layer: Layer,
    event: String,
    group_index: usize,
    hook_index: usize,
    matcher: Option<String>,
    spec: edits::HookSpec,
) -> Result<edits::MutationPreview, String> {
    edits::preview_hook_update(
        &scope,
        layer,
        &event,
        group_index,
        hook_index,
        matcher,
        spec,
    )
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

#[tauri::command]
fn mcp_read_spec(
    scope: Scope,
    name: String,
    scope_flag: String,
) -> Result<creator::McpAddSpec, String> {
    mcp_edit::read_spec(&scope, &name, &scope_flag)
}

#[tauri::command]
fn mcp_preview_update(
    scope: Scope,
    name: String,
    scope_flag: String,
    spec: creator::McpAddSpec,
) -> Result<mcp_edit::McpEditPreview, String> {
    mcp_edit::preview_update(&scope, &name, &scope_flag, &spec)
}

#[tauri::command]
async fn mcp_commit_update(
    scope: Scope,
    name: String,
    scope_flag: String,
    spec: creator::McpAddSpec,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mcp_edit::commit_update(&scope, &name, &scope_flag, &spec)
    })
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
            list_memory_targets,
            read_item,
            save_item,
            delete_item,
            list_backups,
            read_keybindings,
            save_keybindings,
            read_statusline,
            save_statusline_script,
            read_backup,
            restore_backup,
            read_memory,
            save_memory,
            preview_hook_add,
            preview_hook_remove,
            preview_hook_update,
            mcp_remove,
            create_item,
            mcp_add_preview,
            mcp_add,
            mcp_read_spec,
            mcp_preview_update,
            mcp_commit_update,
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
