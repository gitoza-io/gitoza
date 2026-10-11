---
version: "v1.1.3"
date: "2026-08-21"
title: "Visual Editor, Wiki IDs & Coverage Links"
---

Adds a visual Markdown editor with tables, stable wiki page IDs and folder management, and ticket coverage links from cases and runs. **After upgrading, run a full reindex** (Refresh workspace → Force Full Reindex) so wiki pages migrate to `W-…` ids.

### 🚀 New Features

- **Visual Markdown editor** — Toggle **Normal** (WYSIWYG) and **Markdown** while editing. Insert and edit tables with a floating toolbar; paste from HTML (docs, spreadsheets) as structured Markdown.
- **Wiki page IDs** — Pages use immutable `W-xxxxxx` filenames. Title edits no longer rename the file. Legacy title-slug files are renamed on reindex.
- **Wiki links** — Insert `[[wiki:W-xxxxxx]]` (and ticket `[[TICKET-ID]]`) from a shared **Insert link** picker. Click a wiki link in a ticket body to open Library.
- **Wiki folders** — Create folders inline (Enter confirms; Esc cancels). Delete empty active folders; archiving a folder removes the empty source directory.
- **Wiki status & tags** — Pages support Draft / Published / Outdated plus tags, including search filters.
- **Coverage links** — Cases and runs store `requirement_ids` pointing at tickets. Tickets show **Tested by** cases and **Covered by runs**; link or unlink from the ticket, case, or run (**Covers**).
- **Ticket status pills** — Quick status filters in Tickets (and Releases) to focus the work queue without opening Search.

### ✨ Improvements

- **Ticket ID pickers** — Parent, release, and related-id fields only persist IDs that resolve; unmatched input reverts on blur or Enter.
- **Ticket navigation** — Clickable ID chips and related lists (children, tested-by, covered-by) jump to the matching ticket, case, or run.
- **Ticket YAML** — Filename stem is the ticket id; `ticket_id` is no longer written into front matter (legacy keys still parse).
- **Release picker** — Clearer autocomplete for `project/stem` release ids.
- **Wiki archive** — Empty directories are cleaned up after a successful archive so the active tree stays accurate.
- **Tooltips** — Shared tooltip styling on ticket metadata, chips, and editor toolbar actions.

### ⚠️ Upgrade note

Wiki page identity moved from title slugs to allocated `W-…` ids. **Fully reindex your workspace** after updating so Library links and the wiki index match the new filenames. Incremental refresh may not migrate every legacy page.
