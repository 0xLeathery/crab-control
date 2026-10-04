# Crab Control

Tauri v2 desktop app that reads and safely edits Claude Code configuration.
React 19 + Vite + TypeScript frontend in `src/`, Rust backend in `src-tauri/src/`.
See `README.md` for features and the file map.

## Commands

```sh
npm ci                     # install frontend deps
npm run build              # tsc typecheck + vite build
npm test                   # frontend unit tests (Vitest)
npm run app                # launch the desktop app (dev)
cd src-tauri && cargo fmt                                   # format Rust
cd src-tauri && cargo clippy --all-targets -- -D warnings  # lint (must be clean)
cd src-tauri && cargo test                                  # Rust unit tests
```

GitHub Actions runners are currently disabled, so `ci.yml` doesn't run. Run
the commands above locally before every push — they're the only gate.

Linux builds need the Tauri system libs (`libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `librsvg2-dev`, `libappindicator3-dev`, `patchelf`).

## Invariants — do not break

- **The frontend never touches disk or runs processes.** All filesystem and
  `claude` CLI access lives in Rust. Don't add Tauri fs/shell plugins.
- **Every write goes through `writer.rs`**: guard → validate → backup →
  atomic write. Structured edits use `edits.rs` (preview → confirm → save);
  the user always sees a diff and confirms before anything is written.
- **Managed/enterprise settings are read-only.**
- **Credential files are never read; secrets are masked** via `secrets.rs`
  before any value reaches the UI. New outputs that can carry config values
  (env, headers, URLs, args) must be masked too.
- **The importer never writes a masked value** — it skips those keys.
- Preserve the user's key order and formatting (`serde_json` `preserve_order`).

## Adding a backend command

1. Implement in the relevant module under `src-tauri/src/`.
2. Wrap it as a `#[tauri::command]` in `lib.rs` and register it in the
   `invoke_handler` list.
3. Add a typed wrapper in `src/api.ts` (types mirror `model.rs`).
4. Use it from the panel in `src/panels.tsx` (or `create.tsx` / `editor.tsx`).

## Test-driven development (required)

Every change — feature, bug fix, or refactor — follows red → green → refactor:

1. **Red:** write or extend a test that captures the new behavior (or
   reproduces the bug) *before* touching the implementation. Run it and
   confirm it fails for the expected reason.
2. **Green:** write the minimum code to make it pass.
3. **Refactor:** clean up with the suite green.

- **Refactors / lint fixes:** if the touched behavior has no test, add a
  characterization test first, and check it would catch a regression (e.g.
  temporarily break the code and watch it fail).
- **Hard-to-test code** (Tauri commands, CLI calls, React components): pull
  the logic into a pure function and test that; keep the untested shell thin.
- Commit tests together with the change. A PR that changes behavior without a
  test needs an explicit reason in its description.

Where tests live:

- **Rust:** `#[cfg(test)]` modules next to the code (`cargo test`). Tests that
  touch files must use a temp dir — never the real `~/.claude` or
  `~/.claude.json`.
- **Frontend:** `src/**/*.test.ts` with Vitest (`npm test`). Test exported
  pure functions (e.g. `lineDiff` in `editor.tsx`).

When running the app during development, don't edit your real Claude config
through it unless you mean to.

## Conventions

- No component library; styles are in `src/styles.css`.
- Don't hand-edit `package-lock.json` or `Cargo.lock`; use npm / cargo.
- Keep comments sparse and explain *why*.

## Releasing

- Version lives in three places — keep them in sync: `package.json`,
  `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
- Pushing a `v*` tag triggers `.github/workflows/release.yml` (draft release,
  all platforms). Only tag when asked. See `RELEASING.md` and `SIGNING.md`.
