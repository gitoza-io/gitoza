# Windows NSIS installer template

Gitoza vendors a fork of Tauri's default NSIS script to enable **one-click passive install** on double-click (progress bar only, no wizard pages, app auto-launches).

## Upstream

- Source: [tauri-apps/tauri `installer.nsi`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)
- Match to the repo's `@tauri-apps/cli` version when re-syncing.

## Gitoza-specific changes

1. **`.onInit`** — sets `$PassiveMode` on normal GUI launches (not `/S`, `/P`, or `/UPDATE`).
2. **`.onInstSuccess`** — calls `RunMainBinary` after passive or updater installs; `/S` silent installs still require `/R` to launch.

## Install behavior

| Invocation | UI | Auto-launch |
|------------|-----|-------------|
| Double-click `*-setup.exe` | Progress bar only | Yes |
| `setup.exe /P` | Progress bar only | Yes |
| `setup.exe /S` | None | Only with `/R` (optional `/ARGS`) |
| In-app updater (`/UPDATE`) | Passive | Yes |

Uninstall (`uninstall.exe`) keeps the standard confirm UI.

## Re-sync after bumping `@tauri-apps/cli`

1. Download the latest upstream `installer.nsi` from the link above.
2. Re-apply the two Gitoza patches (search for `Gitoza:` in the current file).
3. Run `npm run tauri:build` on Windows and smoke-test the installer (see release docs).
