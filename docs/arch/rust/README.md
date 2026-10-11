# Rust backend — architecture overview

The Rust backend (`rust-backend/`) holds the application’s business logic as a library crate.
It is embedded directly in the Tauri desktop process — a separate HTTP server is **not** required.

## Communication

```
Frontend (React)
  ↕ invoke() / listen()    ← Tauri IPC
src-tauri/commands.rs       ← #[tauri::command] wrappers
  ↕
rust-backend/ipc_api.rs     ← Public API functions
  ↕
rust-backend/lib.rs         ← Core logic, AppState, SQLite, Git
```

All data transfer uses `serde` (JSON serialization handled by Tauri).

## Module map

| Module             | Role                                                         |
|--------------------|--------------------------------------------------------------|
| `lib.rs`           | `AppState`, background tasks, Git operations, SQLite         |
| `ipc_api.rs`       | Public functions for each Tauri command                      |
| `error.rs`         | `ApiError` type with structured error codes                  |
| `models.rs`        | Request / response types (Serde)                             |
| `repo_config.rs`   | Config management (`config.json`)                            |
| `clone_service.rs` | Repository clone logic                                       |
| `ssh_key.rs`       | SSH key management                                           |

## Adding a new command

See the guide in the root [`README.md`](../../../README.md).
