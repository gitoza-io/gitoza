# Gitoza documentation

Curated docs for contributors and operators. Day-to-day product behavior lives in the app; this folder covers on-disk layout, updates, and release CI.

| Document | Topic |
|----------|--------|
| [DATA-LAYOUT.md](DATA-LAYOUT.md) | Local `~/.gitoza` paths, in-repo `.gitoza/` tree, work branch, Confirm |
| [arch/rust/README.md](arch/rust/README.md) | Rust backend crate, Tauri IPC, module map |
| [arch/runs/README-testrun-db-then-yaml.md](arch/runs/README-testrun-db-then-yaml.md) | Test run SQLite runtime vs YAML export layout |
| [arch/automation/README-ci-upload.md](arch/automation/README-ci-upload.md) | CI JUnit upload path for Test Automation |
| [arch/update/README.md](arch/update/README.md) | Desktop updater checks and install |
| [arch/release_build/README.md](arch/release_build/README.md) | GitHub Actions → Cloudflare R2 release pipeline |
| [arch/release_build/WEBHOOK.md](arch/release_build/WEBHOOK.md) | Release registration webhook contract |

Also useful next to the code:

- [Root README](../README.md) — build and run
- [frontend/README.md](../frontend/README.md) — React UI structure
- [rust-backend/README.md](../rust-backend/README.md) — pointer to the Rust overview
