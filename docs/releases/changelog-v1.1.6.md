---
version: "v1.1.6"
date: "2026-09-05"
title: "Ticket Custom Fields, Open-Focus Trees & Sync Reliability"
---

Ticket custom fields you can edit and search, Finder-style focus for projects and runs, and smoother sync when you restore or hit rename conflicts.

### 🚀 New Features

- **Ticket custom fields** — Add and edit custom fields on tickets, and filter by them in Search.
- **Open-focus in Repository & Test Run** — Double-click a project or run to zoom the tree to that item; Back returns. Search stays inside the focused view.
- **Shared tags input** — One tags control with suggestions for cases, tickets, and wiki.

### ✨ Improvements

- **Paste tables** — Pasted Markdown tables stay as clean tables in the visual editor.
- **Conflict resolution** — Shared and Yours show a bit of surrounding context; use the arrows to move line by line.
- **Test Run after restore** — After discard or abort, open runs update counts and case results without switching away and back.
- **Unsaved run results** — Draft pass/fail choices are kept while remote updates still apply where you have not edited.
- **Rename conflicts** — Sync handles rename clashes more reliably.
- **Releases filters** — Clearing status filters no longer leaves stale chips.

### ⚠️ Upgrade note

No data migration. Restart the app after updating. If a run’s counts still look off after an older restore, open that run once or use **Refresh workspace**.
