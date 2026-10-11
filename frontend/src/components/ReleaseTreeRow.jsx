import { ArrowLeft, Box, ChevronDown, ChevronRight, Rocket, Pin } from "lucide-react";
import Tooltip from "./Tooltip";
import {
  TreeRowGuides,
  TREE_ROW_CONTENT_GAP,
  treeRowHoverFullWidthClass,
  treeRowSelectedFullWidthClass,
} from "./SidebarSection";

/**
 * Release or project row in ReleaseNavigatorTree (chevron expands; row click selects).
 * Layout matches CaseTree project rows so Releases and Tickets share the same chrome.
 */
function ReleaseTreeRow({
  node,
  level = 0,
  isExpanded = false,
  isSelected = false,
  onSelect,
  onToggle,
  onContextMenu = null,
  onDoubleClick = null,
  showBackControl = false,
  onBack = null,
  backTooltip = null,
  pinningEnabled = false,
  isPinned = false,
  onTogglePin,
  ticketCount = undefined,
}) {
  const displayTicketCount = ticketCount ?? node.ticket_count ?? 0;
  const isRelease = node.is_release === true;
  const isProject = node.is_project === true;
  const canToggle = isRelease || isProject;
  const pathKey = node.directory_path;
  const gap = TREE_ROW_CONTENT_GAP;
  const baseName = node.display_name ?? node.name ?? "";
  const projectName = node.project_name || node.project || "";
  const displayName =
    showBackControl && isRelease && projectName
      ? `${projectName}/${baseName}`
      : baseName;
  const showPinControl = pinningEnabled && (isRelease || isProject) && !showBackControl;
  const pinLabel = isProject
    ? isPinned
      ? "Unpin project"
      : "Pin project to top"
    : isPinned
      ? "Unpin release"
      : "Pin release to top";
  const backLabel =
    backTooltip ||
    (isRelease ? "Back to project" : "Back to all projects");

  const handleRowClick = () => {
    onSelect?.(node.directory_path);
  };

  const handleExpandClick = (e) => {
    e.stopPropagation();
    if (!canToggle) return;
    onToggle?.(pathKey);
  };

  const handleBackClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onBack?.();
  };

  const handleRowDoubleClick = () => {
    if (!isProject && !isRelease) return;
    onDoubleClick?.(node);
  };

  const handleRowKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick();
    }
  };

  const handleContextMenu = onContextMenu
    ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, node);
      }
    : undefined;

  const rowSurfaceClass = showBackControl
    ? isSelected
      ? "sticky top-0 z-20 border-b border-slate-200/80 bg-list-selected dark:border-slate-700/80 dark:bg-slate-700"
      : "sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50 hover:bg-list-hover dark:border-slate-700/80 dark:bg-slate-950 dark:hover:bg-slate-800"
    : isSelected
      ? treeRowSelectedFullWidthClass
      : treeRowHoverFullWidthClass;

  // Header div only — parent branch owns the wrapping <li> so sticky can encompass children
  // (same pattern as CaseTree project rows).
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={canToggle && !showBackControl ? isExpanded : undefined}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      onKeyDown={handleRowKeyDown}
      onContextMenu={handleContextMenu}
      className={`group flex min-w-0 w-full cursor-pointer ${rowSurfaceClass}`}
    >
      <TreeRowGuides level={level} />
      <div
        className="flex min-w-0 flex-1 items-center gap-0.5 font-medium"
        style={{ paddingLeft: `${gap}px` }}
      >
        {showBackControl ? (
          <Tooltip label={backLabel} placement="bottom">
            <button
              type="button"
              onClick={handleBackClick}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200/80 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
              aria-label={backLabel}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : canToggle ? (
          <button
            type="button"
            onClick={handleExpandClick}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200/80 dark:hover:bg-slate-700/80"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <div
          className={`flex min-w-0 flex-1 select-none items-center gap-1 rounded py-1.5 pr-1 text-left text-sm ${
            isSelected
              ? "font-semibold text-ink dark:text-slate-100"
              : "text-slate-600 dark:text-slate-300"
          }`}
        >
          {isRelease ? (
            <Rocket className="h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400" aria-hidden />
          ) : (
            <Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate">{displayName}</span>
          {showPinControl ? (
            <Tooltip label={pinLabel} placement="bottom">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTogglePin?.(node.directory_path);
                }}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400 ${
                  isPinned
                    ? "text-indigo-600 opacity-100 dark:text-indigo-400"
                    : "opacity-0 group-hover:opacity-100"
                }`}
                aria-label={pinLabel}
              >
                <Pin className={`h-3 w-3 ${isPinned ? "fill-current" : ""}`} aria-hidden />
              </button>
            </Tooltip>
          ) : null}
          {displayTicketCount > 0 ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {displayTicketCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ReleaseTreeRow;
