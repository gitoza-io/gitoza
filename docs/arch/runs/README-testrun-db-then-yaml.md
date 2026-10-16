# Test Run: tiered truth (DB runtime + `run_id/` folder export)

Run execution uses a **tiered source-of-truth** model:


| Data                       | Runtime truth (UI / hot API)                          | Git persistence                       |
| -------------------------- | ----------------------------------------------------- | ------------------------------------- |
| Run metadata               | SQLite `test_runs`                                    | `{run_id}/head.md`                  |
| Case membership            | SQLite `test_run_cases`                               | `{run_id}/cases.md` (async flush)   |
| Pass / Fail / Skip results | SQLite `test_run_results`                             | `{run_id}/results.md` (async flush) |
| Case titles / tags cache   | SQLite `test_run_cases`                               | Derived from case docs / snapshots    |
| Comment threads            | SQLite `test_run_comments` / `test_run_case_comments` | head / cases shards (async flush)     |

Shards are **frontmatter-only Markdown** (YAML mapping between `---` fences). Pass/Fail/Skip and browse paths do not read or rewrite large shard files on each action.

---



## File layout

Under `.gitoza/test/runs/` (and `.archive/{run_id}/` when archived):

```
.gitoza/test/runs/{run_id}/
  head.md      # run_id, title, description, approve, dates, run comments
  cases.md     # cases[] membership (+ case comment threads on flush)
  results.md   # sparse execution results map
```

- **Folder name =** `run_id` (new runs allocate `R-XXXXXX`; legacy UUID / other ids stay as-is with no rename on index).
- `test_runs.run_dir_path` stores the canonical directory path.



### `head.md`

- `run_id`, `title`, `description`, `archived`, approve fields, dates, run-level `comments[]`
- Optional `requirement_ids: [TICKET-ID, …]` — tickets this run covers (source of truth for ticket **Covered by runs**; SQLite column `test_runs.requirement_id` stores the JSON array)
- Optional `release: project/stem` — release this run is executed against (same composite id as `tickets.release`; SQLite column `test_runs.release`). Source of truth for the release summary **Test runs** reverse list; release docs do **not** store run ids.
- No `cases[]`, no `summary`, no per-case results



### `cases.md`

- `run_id`, `cases[]` membership (`file_path`, `case_id`, `picked_at_sha`, optional case `comments[]`)
- No `result` / `executed_at` / `executed_by` fields



### `results.md`

- `run_id`, sparse `results` map keyed by `file_path`
- **No** `summary` — passed/failed/skipped/total are derived from SQLite (`test_run_results` + membership) at read time. Writing denormalized counts caused needless merge conflicts (e.g. keep shared results but keep mine for summary).
- Legacy `summary` keys (if present on older files) are ignored on import and stripped on the next results flush
- Legacy `results_revision` keys (if present on older files) are ignored on import

---



## Hot path: Pass / Fail / Skip

1. `set_run_results_batch` writes `test_run_results` in SQLite
2. Returns stamped cases + run header counts (no full `getRun`)
3. Marks run pending with `flush_results` **only**
4. Frontend merges API response (no refetch)

---



## Read APIs (large runs)

- `get_run(run_id, include_cases?, include_case_comments?)` — default `include_cases: false`
- `list_run_cases(run_id, folder_prefix?, limit, offset)`
- `get_run_folder_tree(run_id)`
- `get_run_case_comments(run_id, file_path)`

---



## Async YAML flush (per-shard pending flags)

Pending runs: SQLite table `pending_run_yaml_flush` in `{config_dir}/db/{repo}.db` with per-run flags:

- `flush_head` — title / approve / run comments
- `flush_cases` — membership / case comments
- `flush_results` — execution results

`flush_all_pending_run_yaml_inner` runs before `git add` in `capture_pending_changes`.


| Operation       | Runtime               | Pending flags                                        |
| --------------- | --------------------- | ---------------------------------------------------- |
| Pass/Fail/Skip  | DB                    | `flush_results`                                      |
| Run comment     | DB                    | `flush_head`                                         |
| Case comment    | DB                    | `flush_cases`                                        |
| patch / approve | DB + sync `head.md` | —                                                    |
| add/remove case | DB                    | `flush_cases` (+ `flush_results` if results removed) |
| create run      | DB + sync triplet     | —                                                    |


---



## Pull / index reconciliation

- Discover `runs/*/head.md` (and `runs/.archive/*/head.md`)
- Full index: merge head + cases + results → `upsert_test_run_from_doc`
- Incremental: shard file change imports the appropriate slice; results-only changes use `sync_run_results_from_results_yaml_doc` (frontmatter `results.md`)
- **Before any run index** (IDE Refresh, pull incremental sync, startup full run index): flush pending run shards from DB to disk so stale on-disk shards cannot overwrite in-memory execution results (same guarantee as pre-capture flush in Sync)
- There is **no** `results_revision` compare; pending flush then index is the sole stale-disk guard. SQLite columns `results_revision` / `yaml_flush_revision` may still exist on older DBs but are unused.

---



## Key modules


| Module                | Role                                                     |
| --------------------- | -------------------------------------------------------- |
| `run_publish.rs`      | Path helpers, shard read/write, DB→frontmatter flush     |
| `pending_run_yaml.rs` | Per-shard pending flush queue (`pending_run_yaml_flush`) |
| `lib.rs`              | Index, DB helpers, `update_test_run_header_db`           |
| `ipc_api.rs`          | DB-first structural handlers                             |


