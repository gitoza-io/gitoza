# Gitoza

Local-first desktop app for **tasks and tests as files in Git** (Task-as-Code + Test-as-Code). Tickets, wiki pages, test cases, and test runs are YAML in your repository; the index and UI run on your machine. There is no central cloud database for that data. You can **link tickets to test cases and runs** so planning and verification stay in the same Git workflow.

## Download

- **Installers (recommended):** [gitoza.com](https://gitoza.com) — Windows, macOS, and Linux builds served from the official CDN.
- **Source:** this repository (build from source below). GitHub Releases may mirror the same artifacts when published.

## Features

- **Tickets / Releases / Wiki** — Tasks as YAML under `.gitoza/tasks/tickets/`, releases, and wiki pages under `.gitoza/wiki/`; link tickets to cases and runs
- **Test Repository** — Cases as YAML under `.gitoza/test/cases/` (one file per case), tree view, editor with auto-save, review/approve workflow
- **Test Run** — Manual runs under `.gitoza/test/runs/{run_id}/`; SQLite is the runtime source, shards export to Git
- **Test Automation** — Optional CI JUnit results via Storage Sync
- **Git workflow** — Connect a remote, work on branch **`gitoza`**, capture changes, diffs, confirm (commit / rebase / push), conflict resolution
- **Dashboard & search** — Project overview and filters with local index refresh
- **Import / export** — CSV import and case/run export from the app

## Prerequisites (build from source)

- **Node.js** 18+
- **Rust** 1.77+ ([rustup](https://rustup.rs/))
- **Tauri system dependencies** — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- **Git** (CLI) for repository operations

## Getting started

From the repository root:

```bash
npm install
cd frontend && npm install && cd ..
npm run tauri:dev
```

This starts Vite and opens the app in a Tauri window. The frontend talks to the embedded Rust backend over IPC.

Production build:

```bash
npm run tauri:build
```

## Architecture overview

**Tauri 2** desktop shell: React (Vite) talks to Rust over native IPC. The `rust-backend` crate is embedded in the Tauri process—no separate HTTP API server for app data.

```mermaid
flowchart TB
  subgraph repo [Gitoza repository]
    subgraph fe [frontend — React / Vite]
      App[App.jsx<br/>navigation and global state]
      Pages[pages/<br/>Tickets · Wiki · Test Repository · Test Run · Review · …]
      Cmp[components/ · hooks/ · utils/]
      ApiJs[services/api.js<br/>Tauri invoke wrappers]
      WsJs[services/wsRefresh.js<br/>Tauri event listeners]
    end

    subgraph tauri [src-tauri — Tauri shell]
      Cmd[commands.rs<br/>#[tauri::command] wrappers]
      Bridge[lib.rs<br/>builder, state, event bridge]
    end

    subgraph rb [rust-backend — Rust library]
      Ipc[ipc_api.rs<br/>public API functions]
      Lib[lib.rs<br/>AppState, SQLite, Git, YAML]
      Mod[models · error · repo_config · clone_service · …]
    end

    Docs[docs/]
  end

  subgraph local [~/.gitoza]
    Cfg[config.json]
    Shadow["repos/slug<br/>Git shadow clone"]
    Sqlite[("db/slug.db<br/>SQLite index")]
  end

  subgraph worktree [Shadow repo working tree on branch gitoza]
    Tickets[".gitoza/tasks/tickets/**"]
    Wiki[".gitoza/wiki/**"]
    Cases[".gitoza/test/cases/**/{case_id}.yaml"]
    Runs[".gitoza/test/runs/{run_id}/<br/>head · cases · results.yaml"]
    Tpl[".gitoza/test/templates/**/*.md"]
    ProjCfg[".gitoza/config.json"]
  end

  App --> Pages
  Pages --> Cmp
  Cmp --> ApiJs
  Cmp --> WsJs
  ApiJs -->|invoke| Cmd
  WsJs -->|listen| Bridge
  Cmd --> Ipc
  Bridge --> Ipc
  Ipc --> Lib
  Lib --> Mod
  Cfg --> Lib
  Lib --> Sqlite
  Lib --> Shadow
  Lib -->|git CLI| Shadow
  Shadow --> Tickets
  Shadow --> Wiki
  Shadow --> Cases
  Shadow --> Runs
  Shadow --> Tpl
  Shadow --> ProjCfg
```

| Layer | Responsibility |
|--------|----------------|
| **frontend** | UI, autosave, confirm/rebase flows; backend access via `api.js` (`invoke`) and `wsRefresh.js` (Tauri events) |
| **src-tauri** | Window, command registration, state setup, refresh event bridge |
| **rust-backend** | IPC API, YAML read/write, SQLite indexing, Git on branch `gitoza` |
| **~/.gitoza** | App config, shadow clones, SQLite databases |
| **`.gitoza/`** in repo | Version-controlled tasks, wiki, tests, and team config |

More detail: [`docs/README.md`](docs/README.md), [`docs/DATA-LAYOUT.md`](docs/DATA-LAYOUT.md), [`frontend/README.md`](frontend/README.md), [`docs/arch/rust/README.md`](docs/arch/rust/README.md).

## Technology stack

| Layer | Technology |
|--------|-------------|
| **Desktop shell** | [Tauri](https://tauri.app/) 2 |
| **Frontend** | React 18, [Vite](https://vitejs.dev/), Tailwind CSS |
| **Backend** | Rust (`rust-backend/`) — SQLite index, Git, YAML |
| **Communication** | Tauri IPC (`invoke` / events); Serde JSON |

## Project structure

```
gitoza/
├── frontend/                 # React UI (Vite)
├── rust-backend/             # Rust business logic
├── src-tauri/                # Tauri desktop shell
├── docs/                     # Architecture, layout, updates, release
└── package.json              # Root scripts (e.g. tauri:dev)
```

## Local data paths

| Path | Purpose |
|------|---------|
| `~/.gitoza/config.json` | Connected remote repo and settings |
| `~/.gitoza/repos/<slug>/` | Shadow clone of the repository |
| `~/.gitoza/db/<slug>.db` | SQLite index (cases, runs, tickets, wiki, …) |

Inside the Git working tree (branch **`gitoza`**):

- Tickets: `.gitoza/tasks/tickets/…`
- Wiki: `.gitoza/wiki/…`
- Cases: `.gitoza/test/cases/<project>/…/<case_id>.yaml`
- Runs: `.gitoza/test/runs/<run_id>/head.yaml`, `cases.yaml`, `results.yaml`
- Templates: `.gitoza/test/templates/*.md`
- Team config: `.gitoza/config.json`

Gitoza always operates on the **`gitoza`** work branch. Merge to your mainline through pull requests on your Git host.

Data layout overview: [`docs/DATA-LAYOUT.md`](docs/DATA-LAYOUT.md).  
Run file layout: [`docs/arch/runs/README-testrun-db-then-yaml.md`](docs/arch/runs/README-testrun-db-then-yaml.md).

## Versioning

| What | Where |
|------|--------|
| **Application** | Git tag `v*` (e.g. `v1.0.0`) — CI sets `version` in `src-tauri/tauri.conf.json`; local dev uses `0.0.0-dev` |
| **Terms (AGB)** | [`src-tauri/src/agb_state.rs`](src-tauri/src/agb_state.rs): `AGB_VERSION`, `AGB_DISPLAY_VERSION` |

## Developers

Icons from `src-tauri/icons/gitoza-icon.svg`:

```bash
npm run icons:regenerate
```

To add a Tauri command: implement in `rust-backend/src/ipc_api.rs`, wrap in `src-tauri/src/commands.rs`, register in `src-tauri/src/lib.rs` `generate_handler!`, then expose via `frontend/src/services/api.js`.

## Contributing

Bug reports and pull requests are welcome. Please describe the change clearly and keep commits focused. For architecture questions, start with [`docs/README.md`](docs/README.md) and [`docs/DATA-LAYOUT.md`](docs/DATA-LAYOUT.md).

## License

Licensed under the **Apache License, Version 2.0** — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
