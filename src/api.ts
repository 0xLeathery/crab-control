// Typed wrappers around the Rust (Tauri) commands. These mirror the serde
// structs in src-tauri/src/model.rs exactly (camelCase).
import { invoke } from "@tauri-apps/api/core";

export type ScopeKind = "global" | "project";
export interface Scope {
  kind: ScopeKind;
  path?: string;
}

export type Layer = "user" | "user-local" | "project" | "project-local" | "managed";

export const LAYER_LABEL: Record<Layer, string> = {
  user: "User",
  "user-local": "User (local)",
  project: "Project",
  "project-local": "Project (local)",
  managed: "Managed",
};

export interface LayerFile {
  layer: Layer;
  label: string;
  path: string;
  displayPath: string;
  present: boolean;
  readOnly: boolean;
  content: unknown | null;
  error: string | null;
}

export interface OverriddenValue {
  layer: Layer;
  value: unknown;
}

export interface EffectiveSetting {
  key: string;
  value: unknown;
  source: Layer;
  overridden: OverriddenValue[];
}

export interface SettingsDomain {
  files: LayerFile[];
  effective: EffectiveSetting[];
}

export interface Item {
  name: string;
  description?: string | null;
  source: string;
  path: string;
  displayPath: string;
  preview?: string | null;
}

export interface ItemsDomain {
  agents: Item[];
  commands: Item[];
  skills: Item[];
}

export interface HookEntry {
  event: string;
  matcher?: string | null;
  hookType: string;
  command?: string | null;
  source: Layer;
}

export interface McpServer {
  name: string;
  scope: string;
  transport: string;
  target?: string | null;
  status?: string | null;
  source: string;
}

export interface Plugin {
  name: string;
  marketplace: string;
  fullId: string;
  version?: string | null;
  scope?: string | null;
  installPath?: string | null;
  displayInstallPath?: string | null;
  enabled?: boolean | null;
  enabledSource?: Layer | null;
}

export interface Marketplace {
  id: string;
  source: unknown;
  installLocation?: string | null;
  displayInstallLocation?: string | null;
  lastUpdated?: string | null;
  autoUpdate?: boolean | null;
}

export interface PluginsDomain {
  plugins: Plugin[];
  marketplaces: Marketplace[];
}

export interface ProjectRef {
  path: string;
  displayPath: string;
  name: string;
  exists: boolean;
  hasLocalSettings: boolean;
}

export interface AppInfo {
  home: string;
  claudeDir: string;
  claudeFound: boolean;
  claudePath?: string | null;
  claudeVersion?: string | null;
  managedPath: string;
  managedPresent: boolean;
  schemaUrl: string;
  schemaCached: boolean;
  schemaCachedAt?: string | null;
}

export interface SchemaResult {
  url: string;
  fromCache: boolean;
  fetchedAtMs?: number | null;
  schema?: unknown | null;
  error?: string | null;
}

export interface RawFile {
  path: string;
  displayPath: string;
  exists: boolean;
  readOnly: boolean;
  text: string;
  hasSecrets: boolean;
}

export interface ValidateResult {
  valid: boolean;
  error?: string | null;
  line?: number | null;
  column?: number | null;
}

export interface SaveResult {
  ok: boolean;
  backupPath?: string | null;
  displayBackup?: string | null;
  bytes: number;
  error?: string | null;
}

export interface MutationPreview {
  layer: Layer;
  layerLabel: string;
  displayPath: string;
  oldText: string;
  newText: string;
  note: string;
}

export interface CreateResult {
  path: string;
  displayPath: string;
}

export interface McpAddSpec {
  name: string;
  transport: "stdio" | "http" | "sse";
  target: string;
  scope: "local" | "user" | "project";
  args: string[];
  env: string[];
  headers: string[];
}

export interface ExportResult {
  path: string;
  displayPath: string;
  bytes: number;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  listProjects: () => invoke<ProjectRef[]>("list_projects"),
  readSettings: (scope: Scope) => invoke<SettingsDomain>("read_settings", { scope }),
  readHooks: (scope: Scope) => invoke<HookEntry[]>("read_hooks", { scope }),
  readItems: (scope: Scope) => invoke<ItemsDomain>("read_items", { scope }),
  readPlugins: (scope: Scope) => invoke<PluginsDomain>("read_plugins", { scope }),
  readMcp: (scope: Scope) => invoke<McpServer[]>("read_mcp", { scope }),
  fetchSchema: (force: boolean) => invoke<SchemaResult>("fetch_schema", { force }),
  // Phase 2: safe editing (raw JSON)
  readRawSettings: (scope: Scope, layer: Layer) =>
    invoke<RawFile>("read_raw_settings", { scope, layer }),
  validateJson: (content: string) => invoke<ValidateResult>("validate_json", { content }),
  saveSettings: (scope: Scope, layer: Layer, content: string) =>
    invoke<SaveResult>("save_settings", { scope, layer, content }),
  // Phase 2: structured edits (preview → confirm → save)
  previewSetSetting: (scope: Scope, layer: Layer, keyPath: string[], value: unknown) =>
    invoke<MutationPreview>("preview_set_setting", { scope, layer, keyPath, value }),
  previewRemoveSetting: (scope: Scope, layer: Layer, keyPath: string[]) =>
    invoke<MutationPreview>("preview_remove_setting", { scope, layer, keyPath }),
  previewPluginToggle: (scope: Scope, fullId: string, enabled: boolean) =>
    invoke<MutationPreview>("preview_plugin_toggle", { scope, fullId, enabled }),
  previewMcpToggle: (scope: Scope, name: string, enabled: boolean) =>
    invoke<MutationPreview>("preview_mcp_toggle", { scope, name, enabled }),
  mcpRemove: (name: string, scopeFlag: string) =>
    invoke<string>("mcp_remove", { name, scopeFlag }),
  // Phase 3: creation flows + export
  createItem: (scope: Scope, kind: string, name: string, content: string) =>
    invoke<CreateResult>("create_item", { scope, kind, name, content }),
  mcpAddPreview: (spec: McpAddSpec) => invoke<string>("mcp_add_preview", { spec }),
  mcpAdd: (spec: McpAddSpec) => invoke<string>("mcp_add", { spec }),
  exportSnapshot: (scope: Scope) => invoke<ExportResult>("export_snapshot", { scope }),
};
