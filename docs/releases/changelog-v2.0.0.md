---
version: "v2.0.0"
date: "2026-10-13"
title: "Open Source & Updater Key Reset"
---

Gitoza is now open source. This release has **no product feature changes**. The in-app updater signing key was rotated, so builds from the 1.x line **cannot** auto-update to 2.0.0 — install this version from the website instead. Your tickets, tests, and wiki stay in your Git repository; nothing is deleted.

### 🚀 New Features

- **Open source** — Source is public under Apache-2.0. Report bugs and ideas via [GitHub Issues](https://github.com/gitoza-io/gitoza/issues). Pull requests are not open yet.

### ✨ Improvements

- **Stable installs on GitHub** — Stable tags also publish Windows, macOS, and Linux installers on [GitHub Releases](https://github.com/gitoza-io/gitoza/releases). Day-to-day downloads remain on [gitoza.com](https://gitoza.com).

### ⚠️ Upgrade note

**Updater signing key changed.** Apps built before 2.0.0 will not complete an automatic update to this version (signature verification fails). Download **2.0.0** again from [gitoza.com](https://gitoza.com) (or GitHub Releases) and install over your existing app. Workspace data under `~/.gitoza` and `.gitoza/` in your repo is unchanged — no data loss.
