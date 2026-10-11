import { Loader2 } from "lucide-react";
import { useTreeAreaHover } from "../contexts/TreeAreaHoverContext";

const TITLE_CLASS =
  "pl-4 pr-2 text-sm font-semibold uppercase tracking-wider text-muted";
const TOOLBAR_MARGIN = "mb-2";

/**
 * Shared sidebar skeleton: title (optional) + toolbar (optional) + content.
 * Used by Dashboard, Test Repository, Test Run, and Review so layout and spacing stay consistent.
 * Each panel supplies its own toolbar (sort, filter, buttons) and children (list or tree).
 *
 * @param {string} [title] - Section title (e.g. "Test Runs", "Review").
 * @param {React.ReactNode} [titleSuffix] - Optional node rendered immediately after the title on the left (e.g. tabs).
 * @param {React.ReactNode} [titleRight] - Optional slot on the right of the title row (e.g. add button).
 * @param {React.ReactNode} [toolbar] - Controls between title and content (sort, filter, actions).
 * @param {React.ReactNode} [children] - Main content (list, tree). Omit when used as header only (e.g. Test Run).
 */
function SidebarSection({ title, titleSuffix, titleRight, toolbar, children }) {
  return (
    <>
      {title != null && title !== "" ? (
        <div className={`flex items-center justify-between gap-2 ${TOOLBAR_MARGIN}`}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className={TITLE_CLASS}>{title}</h2>
            {titleSuffix != null ? <div className="shrink-0">{titleSuffix}</div> : null}
          </div>
          {titleRight != null ? <div className="shrink-0">{titleRight}</div> : null}
        </div>
      ) : null}
      {toolbar != null ? (
        <div className={TOOLBAR_MARGIN}>{toolbar}</div>
      ) : null}
      {children}
    </>
  );
}

/**
 * Shared loading state for sidebar content (spinner + optional message).
 */
function SidebarLoading({ message = "Loading…" }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-muted dark:text-slate-400">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Shared empty state for sidebar (no items).
 */
function SidebarEmpty({ message }) {
  return (
    <p className="pl-4 pr-2 py-2 text-sm text-muted dark:text-slate-400">
      {message}
    </p>
  );
}

/**
 * Base class for sidebar/tree rows (sharp corners to match list). Use for folder/run parent rows that have no selection.
 */
const sidebarRowBaseClass =
  "flex w-full select-none items-center gap-2 rounded-listItem pl-1 pr-2 py-1.5 text-left text-sm transition hover:bg-list-hover text-muted";

/**
 * Same as base but no hover background; use when parent wrapper draws full-width hover to avoid flash of partial hover when moving between rows.
 */
const sidebarRowNoHoverClass =
  "flex w-full select-none items-center gap-2 rounded-listItem pl-1 pr-2 py-1.5 text-left text-sm transition text-muted";

/**
 * Class for the secondary line in a "wide" sidebar row (e.g. "9 cases · 3 passed, 1 failed").
 * Prefer CaseRowLabel for case/ticket id lines (tighter, quieter).
 */
const sidebarRowSecondaryLineClass =
  "mt-px truncate text-[10px] leading-tight text-muted";

/**
 * Class for tree placeholder items (e.g. "Loading…", "No cases" inside an expanded run).
 * Use with "text-center" or "pl-8" for alignment. Used by RunListTree.
 */
const sidebarTreePlaceholderClass =
  "py-2 text-xs text-muted";

/**
 * Class for a full-width empty block in tree (e.g. "No cases in this run."). Used by RunCaseTree.
 */
const sidebarTreeEmptyBlockClass =
  "py-4 text-center text-sm text-muted";

/**
 * Class for the case (file) icon in sidebar/tree rows. Use with Lucide FileText.
 */
const sidebarCaseIconClass = "h-4 w-4 shrink-0 text-muted";

// ---------------------------------------------------------------------------
// Tree indent and VS Code–style vertical guide lines (global tree area)
// ---------------------------------------------------------------------------

/** Base padding (px) for first tree level; 0 = flush to left edge. */
const TREE_PADDING_BASE = 0;
/** Per-level indent (px) for nested tree rows. */
const TREE_PADDING_PER_LEVEL = 14;

/**
 * Total left padding/width for tree row at given level. Use for indent or width of guide column.
 * @param {number} level - 0 = root, 1 = first nested, etc.
 * @returns {number} width in px
 */
function getTreePaddingLeft(level) {
  return TREE_PADDING_BASE + level * TREE_PADDING_PER_LEVEL;
}

/** Gap between vertical guide and row content (px). */
const TREE_ROW_CONTENT_GAP = 6;

/**
 * VS Code–style vertical guide lines for tree rows. Renders N vertical lines for level > 0.
 * Only visible when mouse is over the tree area (useTreeAreaHover). z-10 so lines stay on top of row highlight; pointer-events-none so they don’t block clicks.
 * Wrap row content in a flex container: <div class="flex"><TreeRowGuides level={n} /><div class="flex-1 min-w-0 pl-2">{content}</div></div>
 */
function TreeRowGuides({ level }) {
  const hovered = useTreeAreaHover();
  if (level <= 0) {
    return <div className="shrink-0" style={{ width: getTreePaddingLeft(0) }} />;
  }
  return (
    <div
      className={`relative z-10 shrink-0 self-stretch transition-opacity ${hovered ? "opacity-100" : "opacity-0"}`}
      style={{ width: getTreePaddingLeft(level) }}
      aria-hidden
    >
      {Array.from({ length: level }, (_, i) => (
        <div
          key={i}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
          style={{
            left: `${TREE_PADDING_BASE + (i + 0.5) * TREE_PADDING_PER_LEVEL - 0.5}px`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Class names for a selectable sidebar/list row. Sharp corners; selected = list-selected background.
 * Use for Dashboard runs, Review runs/cases, CaseTree case rows, RunListTree case rows.
 * @param {boolean} selected
 * @returns {string}
 */
function sidebarListItemClassName(selected) {
  const base =
    "flex w-full select-none cursor-pointer items-center gap-2 rounded-listItem pl-1 pr-2 py-1.5 text-left text-sm transition hover:bg-list-hover";
  const state = selected
    ? "bg-list-selected text-ink"
    : "text-ink";
  return `${base} ${state}`;
}

/** Full-width selection background for tree rows (use on outer wrapper so highlight spans left-to-right). */
const treeRowSelectedFullWidthClass =
  "w-full bg-list-selected";

/** Full-width hover background for tree rows (use on outer wrapper so hover highlight spans left-to-right). */
const treeRowHoverFullWidthClass =
  "hover:bg-list-hover";

export default SidebarSection;
export {
  SidebarLoading,
  SidebarEmpty,
  sidebarListItemClassName,
  sidebarRowBaseClass,
  sidebarRowNoHoverClass,
  sidebarRowSecondaryLineClass,
  sidebarTreePlaceholderClass,
  sidebarTreeEmptyBlockClass,
  sidebarCaseIconClass,
  TREE_PADDING_BASE,
  TREE_PADDING_PER_LEVEL,
  TREE_ROW_CONTENT_GAP,
  getTreePaddingLeft,
  TreeRowGuides,
  treeRowSelectedFullWidthClass,
  treeRowHoverFullWidthClass,
};
