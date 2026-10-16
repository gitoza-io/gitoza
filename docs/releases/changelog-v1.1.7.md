---
version: "v1.1.7"
date: "2026-09-17"
title: "Link Runs to Releases, Project Overview & Mermaid Zoom"
---

Link test runs to a release, see execution status at a glance on the release summary, and get clearer project overviews in Tickets and Releases. Also adds module toggles, Mermaid zoom, and richer run breakdowns.

### 🚀 New Features

- **Link test runs to releases** — Set an optional **Release** on a test run (same `project/stem` id as tickets). From a release, link existing runs, create a new run already tied to that release, or unlink.
- **Release test-run status** — Linked runs on the release summary show Pass / Fail / Not run / In progress with a color bar and count badges on the same row.
- **Ticket project overview** — Selecting a project (with no ticket open) shows description, status and type metrics, and backlog counts.
- **Archive ticket projects** — Archive and restore projects from Tickets; archived projects stay out of the main tree until you need them.
- **Backlog filter** — Quick filter for tickets with no release, alongside the existing status pills.
- **Workspace modules** — Turn sidebar areas on or off per project (Tickets, Releases, Library, Dashboard, Test Repository, Test Run, Automation) in Settings.

### ✨ Improvements

- **Release summary** — Edit release notes with Markdown autosave; ticket **By status** / **By type** metrics (including a status progress bar) replace a single total count.
- **Run Covers** — Enrich and merge ticket coverage from cases in the run so **Covers** stays accurate without hand-copying every id.
- **Run & project breakdowns** — Clearer pass/fail and suite stats on run and repository project overviews.
- **Mermaid diagrams** — Zoom, pan, and fit-to-window in read mode, with theme colors that match light and dark UI.
- **Releases project view** — Selecting a project in Releases uses the same overview panel pattern as Tickets.

### ⚠️ Upgrade note

Runs store an optional `release` field in `head.md` / SQLite. No forced reindex for older workspaces: existing runs stay unlinked until you set a release. Restart the app after updating so module flags and the new run ↔ release APIs are active. If sidebar modules look wrong after a Settings change, reconnect the workspace or restart once.
