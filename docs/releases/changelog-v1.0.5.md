---
version: "v1.0.5"
date: "2026-06-25"
title: "Test Automation & CI Integration"
---

Feature release introducing CI test-result indexing, a new **Test Automation** view, richer case filtering, and dashboard project breakdowns.

### 🚀 New Features

- **Test Automation view** — Browse CI pipeline runs indexed from storage sync (S3/R2 or a shared cloud-drive folder). Sidebar tree shows pipelines, runs (branch, commit, JUnit job counts), suites, and individual test cases; detail panels show execution summaries and per-test results with failure output.
- **CI result indexing** — Backend sync discovers `test_results/{pipeline}/{date}/{build_id}/` paths, downloads JUnit XML and optional `meta.json`, parses results into SQLite, and caches XML locally for fast re-reads.
- **CI upload tutorial** — When storage sync is configured but no pipelines are indexed yet, the detail panel shows the resolved upload path, provider-specific CI snippets (S3 `aws s3 cp` or cloud-drive copy), and guidance to use **Load from storage**.
- **Dashboard project breakdown** — The Cases tab on the dashboard now shows pre-aggregated stats by priority, tag, assignee, and automation coverage for the selected project (DB-only; no YAML scan).
- **Advanced case filtering** — Search panel supports filters for **Assigned to** (including **Assigned to me**), **Custom field** (param key/value), **Automated** yes/no, and improved user pickers for **Last Updated By**. Filter form state syncs cleanly with applied search chips.

### ✨ Improvements

- **Automation sync UX** — **Load from storage** replaces the old **Refresh** label; a sync status line reports indexed, skipped, and failed executions after each load.
- **Assignee handling** — Canonical assignee resolution (case-insensitive matching against known workspace names) on save and display; refined **AssigneeInput** and case detail header layout.
- **Automation pipeline tree** — Suite selection and highlighting; improved stability when switching pipelines, runs, and cases.
- **Case selection** — Shared utilities for Review and Test Run case selection and search-result hydration.
- **Search & tags** — **TagChipPicker** and **SearchPanel** refocus the active input after add/remove actions for smoother keyboard workflows.

