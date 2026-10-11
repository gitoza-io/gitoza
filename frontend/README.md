# Frontend Architecture (Gitoza)

This document summarizes the frontend structure and **reusable building blocks** so that future updates reuse them instead of re-defining patterns or UI.

---

## 1. Stack & entry

- **Framework:** React 18
- **Build:** Vite
- **Styling:** Tailwind CSS
- **Entry:** `main.jsx` → `App.jsx`
- **API:** `services/api.js` (all backend calls); `services/wsRefresh.js` (WebSocket for refresh)

---

## 2. App-level architecture

- **Navigation:** Top-level views include **Tickets**, **Releases**, **Sprints**, **Wiki**, **Test Repository**, **Test Run**, **Test Automation**, **Review**, and **Settings**. The left **Sidebar** (`components/Sidebar.jsx`) switches `activeView`; **no URL router** — view state lives in `App.jsx`. Visibility is gated by project modules.
- **Git branch:** The connected shadow clone always works on branch **`gitoza`** (`constants/git.js`). There is no in-app branch switching.
- **State:** Global state (repos, active workspace, tree, runs, selection, modals) lives in `App.jsx`. List data for **Test Run** (`runs`) and **Test Repository** (`repositoryTree`) is loaded in App so that switching back to a view shows data immediately (no re-fetch flash). The repository folder tree is **lazy**: project nodes load instantly from the dashboard index; full suite subtrees load only when a project is expanded (`useLazyRepositoryTree`).
- **Persistent views:** `PersistentView` keeps each main view **mounted but hidden** when inactive (`display: none`). So when you switch from e.g. Test Run to Review and back, the previous selection and scroll position are preserved. Use `useRefetchWhenActive(load)` inside a view to refetch when it becomes visible.

---

## 3. Layout pattern: left sidebar + right detail

All main content views (Dashboard, Test Repository, Test Run, Review) share the same layout:

| Layer | Component | Role |
|-------|-----------|------|
| **Frame** | `TreeContentLayout` | Resizable left column + right content area. Props: `sidebarHeader?`, `sidebarContent`, `children` (right side). |
| **Left column** | `SidebarSection` | Title + optional toolbar + content. Use for "Test Runs", "Review", "Test Repository" headers and filters. |
| **Right column** | `DetailPanel` | Optional header (title, badge, close) + scrollable body + optional footer. Body is `flex flex-col` so empty states can stretch and center. |

**Do not:** Build a new "left tree + right panel" layout from scratch. Use `TreeContentLayout` and pass `sidebarContent` (wrapping `SidebarSection` when you need title/toolbar) and `children` (right side, often a `DetailPanel`).

---

## 4. Reusable components (use these, don’t re-define)

### 4.1 Sidebar (left column)

| Component | Purpose | When to use |
|-----------|---------|-------------|
| **SidebarSection** | Title + toolbar + children; consistent spacing | Any left-panel block that has a heading and controls (e.g. "Test Runs" + "Show archived" + list). |
| **SidebarLoading** | Spinner + optional message | When the sidebar list/tree is loading. |
| **SidebarEmpty** | Short message when list is empty | When there are no items (e.g. "No test runs yet"). |
| **sidebarListItemClassName(selected)** | Class for a selectable row (hover/selected state) | Every clickable list item in the left column (runs, cases, review list). |

### 4.2 Page-level empty / hint (full page)

| Component | Purpose | When to use |
|-----------|---------|-------------|
| **PageMessage** | Full-page message: loading, empty, or hint | No workspace, no repos, "Select a workspace", or initial loading. Use `variant="loading" | "empty" | "hint"` and pass `title` / `description` / optional `icon`. **Unified rounded-xl and padding.** |

### 4.3 Right-panel empty (“select an item”)

| Component | Purpose | When to use |
|-----------|---------|-------------|
| **DetailPanelEmpty** | Centered placeholder in the right detail panel | When nothing is selected (e.g. "Select a case from the tree"). Props: `title`, optional `description`, optional `iconComponent`, optional `action` (e.g. "New test case" button). **Unified padding, icon size, and centering** (works with DetailPanel’s flex body). |

### 4.4 Status badges (single source of truth)

| Component | Purpose | When to use |
|-----------|---------|-------------|
| **ApproveStatusBadge** | Draft / Approved / Rejected (cases and runs) | Anywhere `approve_status` is shown (lists, headers, tables). Pass `status={row.approve_status}` or `status={run.approve_status}`. |
| **RunStatusBadge** | Not started / In progress / Completed (test run execution status) | Anywhere `run.status` is shown (e.g. Dashboard run list). Pass `status={run.status}`. |

**Do not:** Inline ternary or custom spans for approve status or run status. Use these components so labels and colors stay consistent.

### 4.5 Right-panel content shell

| Component | Purpose | When to use |
|-----------|---------|-------------|
| **DetailPanel** | Right-side panel with optional header/footer and scrollable body | Wrapping the main content of the right column (detail view, form, or empty state). Use `DetailPanelEmpty` as `children` when nothing is selected. |

---

## 5. Constants and display helpers

- **`constants/runStatus.js`**  
  - `RUN_STATUS_LABELS`, `RUN_STATUS_STYLES`, `getRunStatusLabel(status)`, `getRunStatusDisplay(status)`.  
  - Use for run status **labels and styles**; **RunStatusBadge** uses these. Do not duplicate run-status styling elsewhere.

- **Approve status**  
  - Labels and colors live inside **ApproveStatusBadge** (and optional `getApproveStatusDisplay`). Do not define approve-status colors in other files.

---

## 6. Hooks

| Hook | Purpose |
|------|---------|
| **useRefetchWhenActive(load)** | Call `load()` when the view becomes active (e.g. fetch list on Dashboard when user switches back). Use inside views wrapped by `PersistentView`. |
| **useFetchedContent(selectionKey, fetchContent)** | Fetches detail when selection changes; keeps previous content until new fetch completes (avoids flicker). Returns `[content, contentKey]`. Used by Test Run and Test Repository for the right panel. |

---

## 7. Design tokens (conventions)

- **Cards / panels (large blocks):** Use **`rounded-xl`** for page-level messages and card-style containers (e.g. `PageMessage`, dashboard cards). Avoid mixing `rounded` and `rounded-xl` for the same kind of block.
- **Small controls:** Buttons, code snippets, inputs can use `rounded` or `rounded-lg` as needed.
- **Status pills:** Use **ApproveStatusBadge** and **RunStatusBadge**; do not re-define their colors or labels in other components.

---

## 8. Checklist for future frontend changes

Before adding new UI or duplicating logic:

1. **Left column:** Do you need a title + toolbar + list? → Use **SidebarSection** and **sidebarListItemClassName** for rows; **SidebarLoading** / **SidebarEmpty** for states.
2. **Right column “nothing selected”:** → Use **DetailPanelEmpty** with `title` (and optional `description`, `iconComponent`, `action`). Do not build a custom centered empty div.
3. **Full-page “no workspace” / “loading” / “empty”:** → Use **PageMessage** with the right `variant`. Do not add a new rounded box with different padding or radius.
4. **Showing approve status (Draft/Approved/Rejected):** → Use **ApproveStatusBadge**. Do not inline ternary or custom spans.
5. **Showing run status (Not started/In progress/Completed):** → Use **RunStatusBadge**. Do not inline ternary or custom color classes.
6. **New “left list + right detail” page:** → Use **TreeContentLayout** + **DetailPanel**; load list data at App level if you want instant display on view switch.
7. **Detail content when selection changes:** → Consider **useFetchedContent** so the previous content stays until the new fetch completes.

---

## 9. File map (quick reference)

```
src/
├── App.jsx                 # Root state, navigation, PersistentView wiring
├── main.jsx
├── index.css               # Tailwind + global styles
├── components/
│   ├── Sidebar.jsx         # App nav (Dashboard, Test Repository, Test Run, Review, Settings)
│   ├── TreeContentLayout.jsx   # Resizable left + right layout
│   ├── DetailPanel.jsx     # Right panel shell (header, body, footer)
│   ├── DetailPanelEmpty.jsx   # Right-panel "select an item" placeholder
│   ├── SidebarSection.jsx  # Sidebar title + toolbar + content; SidebarLoading, SidebarEmpty, sidebarListItemClassName
│   ├── PageMessage.jsx     # Page-level loading / empty / hint (rounded-xl)
│   ├── ApproveStatusBadge.jsx  # Draft | Approved | Rejected
│   ├── RunStatusBadge.jsx  # Not started | In progress | Completed
│   ├── PersistentView.jsx # Keeps view mounted, hidden when inactive
│   ├── CaseDetailView.jsx # Read-only case detail (used in Review right panel)
│   ├── CaseEditorPanel.jsx
│   ├── RunCaseDetailPanel.jsx
│   ├── … (modals, trees, tables)
├── pages/
│   ├── Dashboard.jsx
│   ├── TestRepository.jsx
│   ├── TestRun.jsx
│   ├── Review.jsx
│   ├── ConnectRepository.jsx
├── constants/
│   └── runStatus.js        # RUN_STATUS_LABELS, RUN_STATUS_STYLES, getRunStatusDisplay
├── hooks/
│   ├── useFetchedContent.js
│   └── useGitConnect.js
├── services/
│   ├── api.js              # All HTTP API calls
│   └── wsRefresh.js        # WebSocket refresh subscription
└── utils/
    ├── relativeTime.js
    ├── caseTree.js
    └── runCaseTree.js
```
