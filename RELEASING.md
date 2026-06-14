# Releasing Crab Control (macOS, Windows, Linux)

Crab Control is a Tauri v2 app, so each platform's installer must be built **on
that platform** — Tauri does not cross-compile cleanly (Linux and Windows in
particular can't be produced from macOS). The supported approach is GitHub
Actions with native runners for all three OSes, driven by the official
[`tauri-action`](https://github.com/tauri-apps/tauri-action).

The workflow is at [`.github/workflows/release.yml`](.github/workflows/release.yml).

## What you get

| Platform | Runner | Installers produced |
|----------|--------|---------------------|
| macOS | `macos-latest` | `.dmg` and `.app` (universal: Apple Silicon + Intel) |
| Windows | `windows-latest` | `.msi` and NSIS `.exe` |
| Linux | `ubuntu-22.04` | `.AppImage`, `.deb`, `.rpm` |

`tauri.conf.json` already sets `"bundle": { "targets": "all" }`, and the icon set
includes `.icns` (macOS), `.ico` (Windows), and PNGs (Linux).

## One-time setup

This project isn't a git repo yet. To use CI releases:

```sh
git init
git add -A
git commit -m "Initial commit"
git branch -M main
# create an empty repo on GitHub, then:
git remote add origin git@github.com:<you>/crab-control.git
git push -u origin main
```

No secrets are required for unsigned builds — `tauri-action` uses the
auto-provided `GITHUB_TOKEN` to create the release.

## Cutting a release

Bump the version in **both** `package.json` and `src-tauri/tauri.conf.json`
(keep them in sync), then push a tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The workflow runs the three platforms in parallel, builds the app on each, and
uploads the installers to a **draft** GitHub Release named after the tag. Review
the draft and publish it.

You can also run it manually from the Actions tab (`workflow_dispatch`).

## Building locally (one OS at a time)

On the machine for the target OS:

```sh
npm install
npm run app:build      # → src-tauri/target/release/bundle/
```

- **macOS:** `.dmg` / `.app` under `bundle/dmg` and `bundle/macos`.
  For a universal binary: `npm run tauri build -- --target universal-apple-darwin`
  (after `rustup target add x86_64-apple-darwin aarch64-apple-darwin`).
- **Windows:** `.msi` / `.exe` under `bundle/msi` and `bundle/nsis`.
- **Linux:** `.AppImage` / `.deb` / `.rpm` under `bundle/…` — needs
  `libwebkit2gtk-4.1-dev` and friends (see the workflow's apt step, or
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)).

## Code signing & notarization

Unsigned builds work but trigger OS warnings (macOS Gatekeeper, Windows
SmartScreen). The release workflow is **already wired and gated** for macOS
signing (off until `SIGN_MACOS=true` + the Apple secrets exist), and Windows
signing via Azure Trusted Signing is documented and ready to finish.

Full step-by-step (enrollment, certs, secrets, turning it on): see
**[SIGNING.md](SIGNING.md)**.

## Auto-updates (configured)

In-app auto-update is wired up:

- A signing keypair was generated with `tauri signer generate`; the **public**
  key lives in `tauri.conf.json` (`plugins.updater.pubkey`), and the **private**
  key is stored as the `TAURI_SIGNING_PRIVATE_KEY` repo secret (the key has no
  password, so the password env resolves empty).
- The workflow passes that secret, so `tauri-action` signs the update artifacts
  and uploads a `latest.json` manifest to each release.
- The app's updater endpoint is
  `https://github.com/0xLeathery/crab-control/releases/latest/download/latest.json`.
  Note `…/releases/latest/…` resolves to the latest **published** release — so
  **publish** a draft release for the updater to find it.
- In the app: **Overview → Updates → Check for updates** detects a newer
  published version, downloads + installs the signed update, and relaunches.

Keep the private key (`~/.tauri/crab-control.key`) safe — if it's lost, you
can't sign updates that existing installs will accept.

## Notes on the `claude` CLI

Crab Control's live MCP features call the `claude` CLI. Binary resolution is
cross-platform (login-shell lookup + common paths on macOS/Linux; `where` + npm
global path on Windows; PATH fallback everywhere), but the MCP panel has only
been exercised on macOS. File-based discovery (settings, plugins, agents, etc.)
works without the CLI on every platform.
