    ---
    version: "v1.1.5"
    date: "2026-08-27"
    title: "Smoother YAML Saves & Editor Polish"
    ---

    Keeps AI-authored and hand-edited YAML calmer on save: front-matter key order and tag casing stay as on disk when you only edit Markdown, so the first autosave no longer reshuffles metadata. Also includes small editor and connect-flow polish.

    ### 🐛 Bug Fixes

    - **YAML front matter on save** — Editing the Markdown body (for example checking a task list item) no longer rewrites the whole front matter into a canonical key order. Updates preserve on-disk field order and keep unknown AI-only keys.
    - **Tag & field casing** — Tags are no longer forced to Title Case on save. When status, type, priority, or tags match the file ignore-case, the original spelling on disk is kept so body-only edits stay body-only in Git.
    - **Table toolbar position** — The visual editor’s floating table bar accounts for sticky chrome at the bottom of the pane so it stays reachable while scrolling.

    ### ✨ Improvements

    - **Body-only writes** — When front matter is unchanged, the app rewrites only the Markdown section and leaves front-matter bytes untouched (cases, tickets, wiki, and releases).
    - **Connect wizard** — Optional handbook demo entry point in the add-repository flow for trying sample content more quickly.
    - **Test Run browsing** — More reliable merging of lazy-loaded run detail and results so the UI stays consistent while you browse large runs.

    ### ⚠️ Upgrade note

    No on-disk layout migration. Restart the app (or rebuild the backend) so the new YAML write path is active. Existing files are left as-is until the next edit; only then do saves stop reshuffling unchanged front matter.
