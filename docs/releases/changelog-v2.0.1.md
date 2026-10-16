---

## version: "v2.0.1"
date: "2026-10-16"
title: "Markdown Workspace Files (.md)"

Workspace documents are **Markdown (**`.md`**) only** — YAML front matter for metadata, Markdown body for content. Older `.yaml` / `.yml` files are not read. Migrate your repo on branch `gitoza` before or right after upgrading, then **Refresh** (Force Full Reindex if the tree looks empty).

### ✨ Improvements

- `.md` **as the only workspace extension** — Cases, tickets, releases, wiki pages, templates, and run shards use `.md` under `.gitoza/`.
- **Runs as frontmatter-only Markdown** — `head.md`, `cases.md`, and `results.md` store a YAML mapping between `---` fences (same fields as before).



### ⚠️ Upgrade note — migrate `.yaml` → `.md`


| Kind                                                    | What to do                                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cases, tickets, releases, wiki, templates, project meta | **Rename only** — `file.yaml` → `file.md` (content usually already has front matter + body).                                                  |
| Run shards (`head` / `cases` / `results`)               | **Rename + wrap** — if the file is bare YAML (no leading `---`), wrap the whole document in `---` … `---` so it is frontmatter-only Markdown. |


#### Migration prompt (paste into an AI agent in your repo)

```text
On branch gitoza, migrate .gitoza/ from .yaml/.yml to .md for Gitoza 2.0.1.

Rules:
1) Cases, tickets, releases, wiki, templates, .project.* — rename .yaml/.yml → .md only. Do not rewrite content unless a file lacks --- front matter fences.
2) Run shards under .gitoza/test/runs/**/{head,cases,results}.yaml — rename to .md. If the file does not start with ---, wrap the entire YAML in:
   ---
   <existing yaml>
   ---
3) Do not change .gitoza/config.json. Do not invent new fields.
4) Keep paths and filenames (stems) identical aside from the extension.
5) Summarize renames and any run files that needed wrapping.
```

After migration: open the app → **Refresh workspace** (Force Full Reindex if needed) → **Sync** when ready.