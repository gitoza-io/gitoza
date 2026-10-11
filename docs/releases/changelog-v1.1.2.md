---
version: "v1.1.2"
date: "2026-08-13"
title: "Wiki Library, Safer Close & Editor Polish"
---

Adds a **Wiki** (Library) for nested Markdown docs with Mermaid diagrams, warns before quitting with unsynced work, and improves list editing and Releases ticket filtering. **After upgrading, run a full reindex** (Refresh workspace → Force Full Reindex) so the wiki index and SQLite-owned audit fields stay in sync.

### 🚀 New Features

- **Wiki (Library)** — Create and edit documentation under `.gitoza/wiki/` with nested folders, inline page creation, and the same two-column tree + detail layout as Tickets. Sidebar label: **Library**.
- **Mermaid diagrams** — Fenced `mermaid` blocks render as diagrams in wiki read mode.
- **Wiki sync & conflicts** — Wiki pages participate in Confirm Changes, conflict resolution, and Force Full Reindex alongside cases and tickets.
- **Close with unsynced work** — Closing the app flushes pending autosaves first, then prompts if local changes are still unsynced (stay, go to Confirm Changes, or close anyway).
- **Release ticket status pills** — Compact status count pills in the Releases tree toolbar to filter tickets by status, with icons and tooltips.

### ✨ Improvements

- **Markdown list editing** — Continue lists on Enter; indent and outdent with Tab / Shift+Tab. Nested lists render correctly in case detail and exports.
- **Audit metadata** — `updated_at` and `updated_by` are owned by SQLite (not YAML). Detail views overlay these fields consistently for cases, tickets, releases, and wiki pages.
- **Folder navigation** — Double-click to enter a wiki folder; sticky Back returns to the parent (same pattern as Releases). Paths use `project/name` style for clearer browsing.
- **Ticket badge counts** — Release rows prefer loaded ticket data over stale API counts so badges stay accurate.
- **Ticket detail loading** — Flushes pending autosaves before selection changes to avoid race conditions when switching tickets.
- **Conflict resolution** — More reliable parsing of Git conflict markers, including empty HEAD or empty remote sides.

### ⚠️ Upgrade note

Wiki pages and SQLite-owned audit fields are new or restructured in this version. **Fully reindex your workspace** after updating so Library pages appear and last-updated metadata resolves correctly. Incremental refresh alone may not build the wiki index.
