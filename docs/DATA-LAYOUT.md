# Data layout

Gitoza stores app state under `~/.gitoza` and version-controlled artifacts under `.gitoza/` inside the connected Git shadow clone. The desktop app always works on the **`gitoza`** branch; merge to your mainline with a pull request on your Git host.

## Local app data (`~/.gitoza`)

| Path | Purpose |
|------|---------|
| `config.json` | Connected remotes and app settings |
| `repos/<slug>/` | Shadow clone of the test repository |
| `db/<slug>.db` | SQLite index for cases, runs, tickets, wiki, etc. |

## In-repo tree (branch `gitoza`)

| Path | Purpose |
|------|---------|
| `.gitoza/config.json` | Team project settings (modules, storage sync, review) |
| `.gitoza/test/cases/<project>/…/<case_id>.yaml` | One test case per file |
| `.gitoza/test/runs/<run_id>/` | Manual run folder (`head.yaml`, `cases.yaml`, `results.yaml`) |
| `.gitoza/test/templates/*.md` | Case body templates |
| `.gitoza/tasks/tickets/` | Tickets (YAML + optional `sprint` / `release` frontmatter) |
| `.gitoza/wiki/` | Wiki pages |

Run execution uses SQLite as the hot path and flushes shards to YAML for Git. Details: [arch/runs/README-testrun-db-then-yaml.md](arch/runs/README-testrun-db-then-yaml.md).

## Confirm (sync)

Capture local changes, then **Confirm**: the app commits on `gitoza`, rebases onto `origin/gitoza` when needed (with conflict UI), and pushes. There is no separate draft/edit branch in the app.

## CI results

Optional JUnit uploads via Storage Sync are described in [arch/automation/README-ci-upload.md](arch/automation/README-ci-upload.md).
