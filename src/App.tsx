import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppInfo,
  HookEntry,
  ItemsDomain,
  McpServer,
  PluginsDomain,
  ProjectRef,
  SchemaResult,
  Scope,
  SettingsDomain,
  api,
} from "./api";
import { CrabMark, Icon } from "./ui";
import {
  HooksPanel,
  ItemsPanel,
  McpPanel,
  OverviewPanel,
  PluginsPanel,
  SettingsPanel,
} from "./panels";

type DomainId =
  | "overview"
  | "settings"
  | "mcp"
  | "plugins"
  | "agents"
  | "commands"
  | "skills"
  | "hooks";

const DOMAINS: { id: DomainId; label: string; icon: any }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "mcp", label: "MCP Servers", icon: "mcp" },
  { id: "plugins", label: "Plugins", icon: "plugins" },
  { id: "agents", label: "Agents", icon: "agents" },
  { id: "commands", label: "Commands", icon: "commands" },
  { id: "skills", label: "Skills", icon: "skills" },
  { id: "hooks", label: "Hooks", icon: "hooks" },
];

interface PaletteEntry {
  kind: string;
  name: string;
  hint: string;
  domain: DomainId;
  filter: string;
}

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [scope, setScope] = useState<Scope>({ kind: "global" });

  const [settings, setSettings] = useState<SettingsDomain | null>(null);
  const [items, setItems] = useState<ItemsDomain | null>(null);
  const [plugins, setPlugins] = useState<PluginsDomain | null>(null);
  const [hooks, setHooks] = useState<HookEntry[] | null>(null);
  const [mcp, setMcp] = useState<McpServer[] | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [schema, setSchema] = useState<SchemaResult | null>(null);
  const [schemaBusy, setSchemaBusy] = useState(false);

  const [active, setActive] = useState<DomainId>("overview");
  const [filter, setFilter] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // One-time loads.
  useEffect(() => {
    api.appInfo().then(setInfo).catch(console.error);
    api.listProjects().then(setProjects).catch(console.error);
    setSchemaBusy(true);
    api
      .fetchSchema(false)
      .then(setSchema)
      .catch(console.error)
      .finally(() => setSchemaBusy(false));
  }, []);

  // Per-scope loads (settings, items, plugins, hooks). MCP is lazy.
  const loadScoped = useCallback((s: Scope) => {
    setSettings(null);
    setItems(null);
    setPlugins(null);
    setHooks(null);
    setMcp(null);
    api
      .readSettings(s)
      .then(setSettings)
      .catch(() => setSettings({ files: [], effective: [] }));
    api
      .readItems(s)
      .then(setItems)
      .catch(() => setItems({ agents: [], commands: [], skills: [] }));
    api
      .readPlugins(s)
      .then(setPlugins)
      .catch(() => setPlugins({ plugins: [], marketplaces: [] }));
    api
      .readHooks(s)
      .then(setHooks)
      .catch(() => setHooks([]));
  }, []);

  useEffect(() => {
    loadScoped(scope);
  }, [scope, loadScoped]);

  const reloadMcp = useCallback(() => {
    setMcpBusy(true);
    api
      .readMcp(scope)
      .then(setMcp)
      .catch(() => setMcp([]))
      .finally(() => setMcpBusy(false));
  }, [scope]);

  const reloadItems = useCallback(() => {
    api
      .readItems(scope)
      .then(setItems)
      .catch(() => setItems({ agents: [], commands: [], skills: [] }));
  }, [scope]);

  // Lazy-load MCP the first time its panel needs it.
  useEffect(() => {
    if (active === "mcp" && mcp === null && !mcpBusy) reloadMcp();
  }, [active, mcp, mcpBusy, reloadMcp]);

  const refreshSchema = useCallback(() => {
    setSchemaBusy(true);
    api
      .fetchSchema(true)
      .then(setSchema)
      .catch(console.error)
      .finally(() => setSchemaBusy(false));
  }, []);

  // Keyboard: Cmd/Ctrl-K palette, Escape closes overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setScopeOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts: Record<string, number | null> = {
    settings: settings ? settings.effective.length : null,
    mcp: mcp ? mcp.length : null,
    plugins: plugins ? plugins.plugins.length : null,
    agents: items ? items.agents.length : null,
    commands: items ? items.commands.length : null,
    skills: items ? items.skills.length : null,
    hooks: hooks ? hooks.length : null,
  };

  const goto = (domain: DomainId, flt = "") => {
    setActive(domain);
    setFilter(flt);
    setPaletteOpen(false);
  };

  // Build palette entries from whatever is loaded.
  const entries = useMemo<PaletteEntry[]>(() => {
    const out: PaletteEntry[] = [];
    settings?.effective.forEach((s) =>
      out.push({ kind: "setting", name: s.key, hint: s.source, domain: "settings", filter: s.key })
    );
    mcp?.forEach((s) =>
      out.push({ kind: "mcp", name: s.name, hint: s.transport, domain: "mcp", filter: s.name })
    );
    plugins?.plugins.forEach((p) =>
      out.push({ kind: "plugin", name: p.fullId, hint: p.version ?? "", domain: "plugins", filter: p.name })
    );
    plugins?.marketplaces.forEach((m) =>
      out.push({ kind: "marketplace", name: m.id, hint: "marketplace", domain: "plugins", filter: m.id })
    );
    items?.agents.forEach((i) =>
      out.push({ kind: "agent", name: i.name, hint: i.source, domain: "agents", filter: i.name })
    );
    items?.commands.forEach((i) =>
      out.push({ kind: "command", name: i.name, hint: i.source, domain: "commands", filter: i.name })
    );
    items?.skills.forEach((i) =>
      out.push({ kind: "skill", name: i.name, hint: i.source, domain: "skills", filter: i.name })
    );
    hooks?.forEach((h) =>
      out.push({
        kind: "hook",
        name: h.event + (h.matcher ? ` · ${h.matcher}` : ""),
        hint: h.hookType,
        domain: "hooks",
        filter: h.event,
      })
    );
    return out;
  }, [settings, mcp, plugins, items, hooks]);

  const scopeLabel =
    scope.kind === "global"
      ? "Global"
      : projects.find((p) => p.path === scope.path)?.name ?? "Project";

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="crab">
            <CrabMark size={18} />
          </span>
          Crab Control
        </div>
        <ScopePicker
          scope={scope}
          scopeLabel={scopeLabel}
          projects={projects}
          open={scopeOpen}
          setOpen={setScopeOpen}
          onPick={(s) => {
            setScope(s);
            setScopeOpen(false);
          }}
        />
        <div className="spacer" />
        <button className="btn" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={13} /> &nbsp;Search&nbsp; <span className="kbd">⌘K</span>
        </button>
      </div>

      <div className="body">
        <nav className="sidebar">
          <div className="group-label">Domains</div>
          {DOMAINS.map((d) => (
            <button
              key={d.id}
              className={`nav-item ${active === d.id ? "active" : ""}`}
              onClick={() => goto(d.id)}
            >
              <Icon name={d.icon} size={16} className="nav-ico" />
              <span className="label">{d.label}</span>
              {d.id !== "overview" && (
                <span className="count">{counts[d.id] == null ? "…" : counts[d.id]}</span>
              )}
            </button>
          ))}
        </nav>

        <main className="main">
          {active === "overview" && (
            <OverviewPanel
              info={info}
              schema={schema}
              counts={counts}
              onRefreshSchema={refreshSchema}
              schemaBusy={schemaBusy}
              scope={scope}
            />
          )}
          {active === "settings" && (
            <SettingsPanel
              data={settings}
              filter={filter}
              scope={scope}
              schema={schema}
              onReload={() =>
                api
                  .readSettings(scope)
                  .then(setSettings)
                  .catch(() => setSettings({ files: [], effective: [] }))
              }
            />
          )}
          {active === "mcp" && (
            <McpPanel
              servers={mcp}
              busy={mcpBusy}
              onReload={reloadMcp}
              filter={filter}
              scope={scope}
            />
          )}
          {active === "plugins" && (
            <PluginsPanel
              data={plugins}
              filter={filter}
              scope={scope}
              onReload={() => {
                api
                  .readPlugins(scope)
                  .then(setPlugins)
                  .catch(() => setPlugins({ plugins: [], marketplaces: [] }));
                api
                  .readSettings(scope)
                  .then(setSettings)
                  .catch(() => {});
              }}
            />
          )}
          {active === "agents" && (
            <ItemsPanel
              title="Agents"
              subtitle="Subagents from user, project, and plugins."
              items={items?.agents ?? null}
              filter={filter}
              scope={scope}
              kind="agent"
              onReload={reloadItems}
            />
          )}
          {active === "commands" && (
            <ItemsPanel
              title="Commands"
              subtitle="Slash commands from user, project, and plugins."
              items={items?.commands ?? null}
              filter={filter}
              scope={scope}
              kind="command"
              onReload={reloadItems}
            />
          )}
          {active === "skills" && (
            <ItemsPanel
              title="Skills"
              subtitle="Skills from user, project, and plugins."
              items={items?.skills ?? null}
              filter={filter}
              scope={scope}
              kind="skill"
              onReload={reloadItems}
            />
          )}
          {active === "hooks" && <HooksPanel hooks={hooks} filter={filter} />}
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          entries={entries}
          onPick={(e) => goto(e.domain, e.filter)}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------- Scope picker ---------- */

function ScopePicker({
  scope,
  scopeLabel,
  projects,
  open,
  setOpen,
  onPick,
}: {
  scope: Scope;
  scopeLabel: string;
  projects: ProjectRef[];
  open: boolean;
  setOpen: (b: boolean) => void;
  onPick: (s: Scope) => void;
}) {
  return (
    <div className="scope-picker">
      <button className="scope-btn" onClick={() => setOpen(!open)}>
        <Icon name={scope.kind === "global" ? "globe" : "folder"} size={14} />
        <span className="scope-kind">{scope.kind === "global" ? "scope" : "project"}</span>
        <span>{scopeLabel}</span>
        <Icon name="chevron" size={13} className="chev" />
      </button>
      {open && (
        <div className="scope-menu">
          <div className="menu-label">Scope</div>
          <div
            className={`opt ${scope.kind === "global" ? "sel" : ""}`}
            onClick={() => onPick({ kind: "global" })}
          >
            <span className="nm">Global</span>
            <span className="pth">User-level configuration</span>
          </div>
          <div className="menu-label">Recent projects</div>
          {projects.length === 0 && (
            <div className="opt">
              <span className="pth">None found in ~/.claude.json</span>
            </div>
          )}
          {projects.map((p) => (
            <div
              key={p.path}
              className={`opt ${
                scope.kind === "project" && scope.path === p.path ? "sel" : ""
              }`}
              onClick={() => onPick({ kind: "project", path: p.path })}
            >
              <span className="nm">
                {p.name}
                {!p.exists && <span className="muted"> · missing</span>}
                {p.hasLocalSettings && <span className="muted"> · has settings</span>}
              </span>
              <span className="pth">{p.displayPath}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Command palette ---------- */

function CommandPalette({
  entries,
  onPick,
  onClose,
}: {
  entries: PaletteEntry[];
  onPick: (e: PaletteEntry) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const f = q.trim().toLowerCase();
    const list = f
      ? entries.filter(
          (e) => e.name.toLowerCase().includes(f) || e.kind.toLowerCase().includes(f)
        )
      : entries;
    return list.slice(0, 80);
  }, [q, entries]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[sel]) onPick(results[sel]);
    }
  };

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          placeholder="Search settings, servers, plugins, agents, commands, skills, hooks…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette-list">
          {results.length === 0 ? (
            <div className="palette-empty">No matches.</div>
          ) : (
            results.map((e, i) => (
              <div
                key={e.kind + e.name + i}
                className={`palette-item ${i === sel ? "active" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => onPick(e)}
              >
                <span className="pi-kind">{e.kind}</span>
                <span className="pi-name">{e.name}</span>
                {e.hint && <span className="pi-hint">{e.hint}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
