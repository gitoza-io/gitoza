import { ChevronDown, ChevronRight } from "lucide-react";
import { sidebarListItemClassName, sidebarRowBaseClass, sidebarRowNoHoverClass } from "./SidebarSection";

const CHEVRON_SIZE = "h-3.5 w-3.5 shrink-0 text-slate-400";

/** Suppress Windows/WebView2 click-focus outline; keep a subtle ring for keyboard focus. */
const SELECTABLE_ROW_FOCUS_CLASS =
  "outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/80 dark:focus-visible:ring-indigo-500/70";

/**
 * Unified sidebar/tree row. No rounded corners; selectable rows use gray highlight.
 * Use for Dashboard runs, Review runs/cases, CaseTree case rows, RunListTree rows.
 *
 * @param {Object} props
 * @param {boolean} [props.selected] - Selected state (gray background). Ignored when selectable=false or children set.
 * @param {boolean} [props.selectionOnParent=false] - When true, selected background is drawn by parent wrapper; row uses no bg so highlight can span full width.
 * @param {boolean} [props.selectable=true] - If false, uses base row style only (e.g. folder/run parent).
 * @param {number} [props.paddingLeft] - Inline style paddingLeft for tree indent.
 * @param {'open'|'closed'} [props.expandIcon] - 'open' = ChevronDown, 'closed' = ChevronRight, omit = spacer for alignment.
 * @param {React.ReactNode} [props.icon] - Leading icon (e.g. FileText, Folder).
 * @param {React.ReactNode} [props.label] - Main content (string or node). Rendered in min-w-0 flex-1.
 * @param {React.ReactNode} [props.right] - Trailing slot (badge, buttons, pass/fail icons).
 * @param {(e?: React.MouseEvent) => void} [props.onClick]
 * @param {(e: React.MouseEvent) => void} [props.onContextMenu]
 * @param {React.ReactNode} [props.children] - When set, renders only a wrapper div with base class and children (for custom layout, e.g. RunListTree run row).
 */
function SidebarRow({
  selected = false,
  selectionOnParent = false,
  selectable = true,
  paddingLeft,
  expandIcon,
  icon,
  label,
  right,
  onClick,
  onContextMenu,
  className = "",
  children,
}) {
  const style = paddingLeft != null ? { paddingLeft } : undefined;
  const extraClass = className ? ` ${className}` : "";

  if (children != null) {
    return (
      <div
        className={`${sidebarRowBaseClass} select-none${extraClass}`}
        style={style}
        onContextMenu={onContextMenu}
      >
        {children}
      </div>
    );
  }

  const expandNode =
    expandIcon === "none" ? null : expandIcon === "open" ? (
      <ChevronDown className={CHEVRON_SIZE} />
    ) : expandIcon === "closed" ? (
      <ChevronRight className={CHEVRON_SIZE} />
    ) : (
      <span className="inline-block w-3.5 shrink-0" aria-hidden />
    );

  const content = (
    <>
      {expandNode}
      {icon}
      <span className="min-w-0 flex-1">{label}</span>
      {right}
    </>
  );

  if (selectable) {
    const rowClass =
      selectionOnParent
        ? `${sidebarRowNoHoverClass} select-none cursor-pointer ${selected ? "text-ink dark:text-slate-100" : ""}`
        : `${sidebarListItemClassName(selected)} select-none`;
    return (
      <div
        role="button"
        tabIndex={0}
        className={`${rowClass} ${SELECTABLE_ROW_FOCUS_CLASS}${extraClass}`}
        style={style}
        onClick={(e) => onClick?.(e)}
        onKeyDown={(e) => {
          const target = e.target;
          const isEditable =
            target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            (target.isContentEditable && target.getAttribute("contenteditable") !== "false");
          if (isEditable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.(e);
          }
        }}
        onContextMenu={onContextMenu}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${sidebarRowBaseClass} select-none ${SELECTABLE_ROW_FOCUS_CLASS}${extraClass}`}
      style={style}
      onClick={(e) => onClick?.(e)}
      onContextMenu={onContextMenu}
    >
      {content}
    </button>
  );
}

export default SidebarRow;
