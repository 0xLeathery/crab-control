<div align="center">

<img src="assets/icon.png" alt="Crab Control" width="120" height="120" />

# Crab Control

**See everything you've configured in Claude Code — and change it without fear.**

A small, fast, local desktop app that discovers, displays, and safely edits your
Claude Code configuration. Built with [Tauri](https://tauri.app) (Rust + web).

</div>

---

## Why

Claude Code's configuration is powerful but scattered: settings split across user,
project, and managed layers; MCP servers in three different places; plugins,
marketplaces, agents, commands, skills, and hooks tucked into files you forget you
created. The usual question is *"wait — what do I even have installed, and where?"*

**Crab Control answers that at a glance.** It reads the real state from your
machine and the `claude` CLI, shows where every value comes from, and lets you
make changes through a careful, reversible workflow — so a quick tweak never
corrupts your setup.

It's a **control panel, not a config file** — dense, legible, dark-first, and
keyboard-driven.

## Features

### See everything (read-only by default)
- **Settings, with provenance.** Every layer — User → User-local → Project →
  Project-local → Managed — shown side by side, plus an *Effective* view that
  tells you which layer won each key and what it overrode.
- **MCP servers.** Live status straight from `claude mcp list/get`, merged with
  file-defined servers (`.mcp.json`, `~/.claude.json`). Transport, scope, and
  status at a glance.
- **Memory.** `CLAUDE.md` / `CLAUDE.local.md` files and `rules/` directories,
  user and project, with previews (read-only).
- **Plugins & marketplaces, agents, commands, skills, hooks.** Names, scopes,
  source paths, and previews — including everything contributed by plugins.
- **Scope picker.** Switch between Global and any recent project from
  `~/.claude.json`.
- **⌘K / Ctrl-K command palette.** Jump to any setting, server, plugin, agent,
  command, skill, or hook instantly.

### Change things safely
- **Raw-JSON editor** per settings file, with live validation.
- **Schema-driven view** — settings grouped by domain from the official JSON
  schema, with descriptions; booleans toggle and enums use a dropdown.
- **Plugins** — enable/disable.
- **MCP** — add a server, remove a server, enable/disable project servers.
- **Permissions** — add or remove `allow` / `deny` / `ask` rules in any
  editable layer.
- **Hooks** — add a command hook (event, matcher, timeout) or remove one.

### Create new things
- Add an MCP server (builds a `claude mcp add …` command with a masked preview).
- Scaffold a new agent, command, or skill from a template.
- Export a masked snapshot of your config as a single JSON file.

## Safety model

> "Local" does **not** mean "safe to corrupt my config." Every write earns its keep.

Each save runs through one pipeline:

1. **Diff + explicit confirmation** — nothing is written until you approve the change.
2. **Timestamped backup** — `<file>.backup.<epoch-ms>`, newest five kept.
3. **Validation** — invalid JSON is rejected before anything touches disk.
4. **Atomic write** — temp file + rename, preserving your key order and formatting.

Plus, always:

- **Managed/enterprise settings are read-only** (shown with a lock).
- **Credential files are never read**, and secret-looking values (tokens, keys,
  `Authorization` headers, URL `?key=` params) are **masked** before they ever
  reach the UI.
- **All filesystem and `claude` CLI access happens in Rust** — the web frontend
  never touches your disk directly.

## Install & run

**Prerequisites:** [Node.js](https://nodejs.org) (18+) and a
[Rust toolchain](https://rustup.rs) (`rustup`). On Linux you'll also need the
usual Tauri system libraries (WebKitGTK, etc.) — see
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install        # first time only
npm run app        # launch the desktop app (dev)
```

Build a distributable bundle for your platform:

```sh
npm run app:build  # → src-tauri/target/release/bundle/
```

## How it's built

```
crab-control/
├─ src/                 React + Vite + TypeScript frontend (no component library)
│  ├─ App.tsx           shell: sidebar, scope picker, command palette
│  ├─ panels/           one file per domain panel
│  ├─ edit-panels.tsx   permissions + hooks editors
│  ├─ helpers.ts        pure helpers (unit-tested)
│  ├─ editor.tsx        raw editor + diff/confirm
│  ├─ create.tsx        creation modals
│  └─ api.ts            typed bridge to the Rust commands
└─ src-tauri/src/       Rust backend (all disk + CLI access)
   ├─ settings.rs       layer discovery + effective/provenance
   ├─ mcp.rs            claude CLI parsing + binary resolution
   ├─ plugins.rs items.rs schema.rs info.rs
   ├─ secrets.rs        masking + credential-file refusal
   ├─ writer.rs         backup → validate → atomic write
   ├─ edits.rs          structured edits (preview → confirm → save)
   └─ creator.rs        scaffolding + snapshot export
```

The settings UI and validation are driven by the official Claude Code settings
schema (`json.schemastore.org/claude-code-settings.json`), fetched and cached so
it works offline and adapts as the config surface changes.

## Status & roadmap

| Area | State |
|------|-------|
| Read-only inventory (all domains + layers, search, scopes) | ✅ |
| Safe settings editing (raw JSON + schema-driven) | ✅ |
| Plugin / MCP enable, disable, remove | ✅ |
| Creation flows (MCP server, agent, command, skill) | ✅ |
| Masked config-snapshot **export** | ✅ |
| Guarded snapshot **import** (skips masked secrets) | ✅ |
| In-app **auto-update** (signed, from GitHub Releases) | ✅ |

Import is deliberately conservative: because snapshots have secrets masked, the
importer **never writes a masked value** — it skips those keys (and tells you
which), applies only the non-secret changes, and still routes every file through
the diff + confirm + backup pipeline.

## Releases

Cross-platform installers (macOS `.dmg`/`.app`, Windows `.msi`/`.exe`, Linux
`.AppImage`/`.deb`/`.rpm`) are built in CI — see
[`RELEASING.md`](RELEASING.md). Development and testing have focused on macOS;
the Windows and Linux builds are produced by the stack but get less hands-on
testing.

## Tech stack

Tauri v2 · Rust · React 19 · Vite · TypeScript

## Trademarks & disclaimer

Crab Control is an independent, unofficial project. It is **not affiliated with,
endorsed by, or sponsored by Anthropic.**

*Claude* and *Claude Code* are trademarks of Anthropic, PBC. They are used here
only **descriptively** (nominative fair use) to indicate that this tool reads and
edits the configuration that Claude Code uses — not as branding for this project.
The name, icon, and all artwork are original to Crab Control. No Anthropic code or
assets are bundled.

The app reads and, with your explicit confirmation, edits your local config
files; back up anything you care about.

## License

[MIT](LICENSE) © 2026 0xLeathery. The trademark notice above still applies:
the license covers this project's code, not the Claude or Claude Code names.
