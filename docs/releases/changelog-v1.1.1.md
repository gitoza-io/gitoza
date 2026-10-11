---
version: "v1.1.1"
date: "2026-08-09"
title: "Project-Scoped Releases & Sync Polish"
---

Releases now live under each ticket project, with clearer navigation and Sync empty-state handling. **After upgrading, run a full reindex** (Refresh workspace → Force Full Reindex) so the release index matches the new on-disk layout.

### 🚀 New Features

- **Project-scoped releases** — Release YAML now lives under `.gitoza/tasks/tickets/{project}/releases/` instead of a flat global folder. Release ids are composite (`project/stem`), so each release belongs to one ticket project.
- **Create release from a project** — In **Releases**, open a project and create a release in that project’s `releases/` folder.
- **Deep-link to a release** — Jump from a ticket’s release field into the matching release in the Releases view.
- **Pin projects in Releases** — Pin ticket projects (and releases) so favorites stay at the top of the Releases tree.

### ✨ Improvements

- **Releases navigator** — Clearer project → release → ticket browsing, including Finder-style focus when you drill into a project or release.
- **Ticket release picker** — Autocomplete suggestions use a single line (`project/stem`, plus a human name when it differs).
- **Copy ticket ID** — Copy a ticket id from the editor / detail header.
- **New ticket focus** — Title field focuses automatically when you create a ticket.
- **Confirm Changes empty state** — Clearer message when Sync opens with no Gitoza changes (for example IDE-only edits); Process is disabled until there is something to review. Workspace switcher stays at the bottom of the sidebar. Status returns to baseline promptly after Cancel or discard-all when the tree is clean.
- **Discard in Confirm Changes** — Discard individual items or whole sections from the changelist before Process.

### ⚠️ Upgrade note

Release files and the SQLite release index layout changed in this version. **Fully reindex your workspace** after updating so Releases and ticket → release links resolve correctly. Incremental refresh alone may not rebuild the release index from the new paths.
