# sync-engine

Single-branch Git sync workflow for Gitoza (and future hosts):

- **publish** — `fetch` → `add` → `commit` → `rebase` onto `origin/<branch>` → `push`
- **recover** — crash recovery for `staged` / `committed` / `rebase_done`
- **resolve_and_finish** — apply conflict resolutions, continue rebase, push
- **conflict** / **modify_delete** — conflict classification and resolution helpers

Depends on [`sync-git`](../sync-git). Hosts inject `WorkflowStore` and `PushFailedStore` (Gitoza uses SQLite adapters in `rust-backend/src/sync_engine_adapter.rs`). Indexing and UI refresh stay in the host after a successful publish.
