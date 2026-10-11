---
version: "v1.1.4"
date: "2026-08-26"
title: "Editor Inserts, Release Workflow & Run IDs"
---

Adds toolbar inserts for code, Mermaid, and task lists; create tickets from a release; filter releases by status; and short `R-…` ids for new test runs.

### 🚀 New Features

- **Insert code & Mermaid** — Toolbar actions insert code and Mermaid diagram blocks in tickets, wiki pages, and cases.
- **Task lists** — Checklists in the visual Markdown editor, with a toolbar toggle.
- **Create ticket from a release** — In **Releases**, create a ticket from the release context menu with the release field pre-filled.
- **Release status filters** — Quick filters for open / shipped / cancelled releases.
- **Shorter run IDs** — New test runs use readable `R-XXXXXX` ids (existing runs keep their ids).
- **Wiki links from cases & runs** — Click a wiki link in a case or run body to open it in Library.

### ✨ Improvements

- **Ticket navigation** — Opening a ticket in another project focuses that project and scrolls to the row.
- **Parent & release fields** — Clearing a value saves immediately when you leave the field.
- **Related lists** — Children, Tested by, and Covered by runs no longer flash empty space while loading.
- **Detail layout** — Case and ticket headers and scrolling feel more consistent in view and edit.
- **Export** — Bold, italic, and inline code look correct in exported HTML.
- **Library folders** — Top-level wiki folders no longer show a project icon.
- **Connect & Settings** — New workspaces switch over right away; the repo path in Settings updates promptly.
- **Sync & Refresh** — Incremental updates are more reliable; fetch/pull is less likely to hang on slow SSH.

### ⚠️ Upgrade note

New test runs use `R-…` ids; existing runs are unchanged. If Search, Library, or Releases look stale after updating, run **Refresh workspace → Force Full Reindex** once.
