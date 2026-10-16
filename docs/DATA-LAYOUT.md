# Data layout

Gitoza stores app state under `~/.gitoza` and version-controlled artifacts under `.gitoza/` inside the connected Git shadow clone. The desktop app always works on the **`gitoza`** branch; merge to your mainline with a pull request on your Git host.

Workspace documents use the **`.md` extension only** (Markdown with YAML frontmatter). Older `.yaml` / `.yml` workspaces are not read — rename files to `.md` if you still have them.

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
| `.gitoza/test/cases/<project>/…/<case_id>.md` | One test case per file (Markdown + YAML frontmatter) |
| `.gitoza/test/runs/<run_id>/` | Manual run folder (`head.md`, `cases.md`, `results.md` — frontmatter-only Markdown) |
| `.gitoza/test/templates/*.md` | Case body templates (plain Markdown) |
| `.gitoza/tasks/tickets/<project>/` | Tickets (`*.md`) and `.project.md` meta |
| `.gitoza/tasks/tickets/<project>/releases/` | Releases (`*.md`) |
| `.gitoza/wiki/` | Wiki pages (`*.md`, nested folders) |

Run execution uses SQLite as the hot path and flushes shards to Markdown for Git. Details: [arch/runs/README-testrun-db-then-yaml.md](arch/runs/README-testrun-db-then-yaml.md).

## Confirm (sync)

Capture local changes, then **Confirm**: the app commits on `gitoza`, rebases onto `origin/gitoza` when needed (with conflict UI), and pushes. There is no separate draft/edit branch in the app.

## CI results

Optional JUnit uploads via Storage Sync are described in [arch/automation/README-ci-upload.md](arch/automation/README-ci-upload.md).
