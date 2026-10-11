import { memo } from "react";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Loader2,
  Pin,
} from "lucide-react";
import InlineRenameConflictAlert from "./InlineRenameConflictAlert";
import InlineRenameInput from "./InlineRenameInput";
import Tooltip from "./Tooltip";
import RunResultCountBadges from "./RunResultCountBadges";
import { TestRunIcon } from "./TestEntityIcons";
import {
  TreeRowGuides,
  TREE_ROW_CONTENT_GAP,
  treeRowSelectedFullWidthClass,
  treeRowHoverFullWidthClass,
} from "./SidebarSection";
import {
  getFolderPickerCheckboxState,
  getPickerFolderBadgeCount,
} from "../utils/casePickerFolderState";

/**
 * Single folder/run row for RepositoryFolderTree (flat or virtual list).
 */
function FolderTreeRow({
  row,
  selectedFolderPath,
  onSelectFolder,
  onFolderExpand,
  onToggle,
  loadingPrefixes,
  loadedPrefixes,
  treeStructureLoadingPrefixes,
  contextMenuTargetFolderNode,
  onContextMenu,
  renamingPath,
  renameFolderConflict = null,
  onFolderRenameValueChange,
  onRenameCommit,
  onCreateFolderCommit,
  multiSelectActive,
  dragOverFolderPath,
  draggingSourcePaths,
  pickerMode = false,
  pickerRows = [],
  selectedFilePaths,
  onToggleProject,
  onToggleSuite,
  filterPath,
  pickerDisabled = false,
  directoryIndex = null,
  renamingRunId = null,
  onRenameRunCommit,
  onRenameRunCancel,
  onContextMenuRun,
  runRowRight,
  measureRef = null,
  virtualized = false,
  pinningEnabled = false,
  isPinned,
  onTogglePin,
  onOpenProject = null,
  openedProjectPath = null,
  onCloseOpenedProject = null,
  onOpenRun = null,
  openedRunPath = null,
  onCloseOpenedRun = null,
}) {
  const RowTag = virtualized ? "div" : "li";
  const rowClassName = `min-w-0 ${virtualized ? "" : "list-none"}`;

  if (row.kind === "inlineCreate") {
    return (
      <RowTag ref={measureRef} role={virtualized ? "listitem" : undefined} className={rowClassName}>
        <div className="flex min-w-0">
          <TreeRowGuides level={row.level} />
          <div
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5"
            style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}
          >
            <FolderPlus className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
            <InlineRenameInput
              initialValue=""
              placeholder="Folder name…"
              onCommit={(val) => onCreateFolderCommit(row.parentPath, val)}
            />
          </div>
        </div>
      </RowTag>
    );
  }

  const { node, pathKey, level, isExpanded } = row;
  const isRun = node.is_run === true;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isProject = node.is_project === true;
  const isSelected = node.directory_path === selectedFolderPath;
  const isRenaming = isRun
    ? renamingRunId === node.run_id
    : renamingPath === node.directory_path;
  const renameFolderConflictName =
    !isRun &&
    isRenaming &&
    renameFolderConflict?.folderPath === node.directory_path
      ? renameFolderConflict.displayName
      : null;
  const contentGap = TREE_ROW_CONTENT_GAP;
  const canToggle = isRun || hasChildren || isProject;
  const editableName = isProject ? (node.name || "").replace(/\.gitoza\.test$/i, "") : node.name;
  const badgeDirectoryPath = node.repo_directory_path ?? node.directory_path;
  const badgeCountPath = pickerMode ? node.directory_path : badgeDirectoryPath;
  const pickerCaseCount = isRun
    ? (node.case_count ?? 0)
    : badgeCountPath
      ? getPickerFolderBadgeCount({
          directoryPath: badgeCountPath,
          pickerRows: pickerMode ? pickerRows : [],
          filterPath,
          loadedPrefixes,
          serverCaseCount: node.case_count ?? 0,
          directoryIndex,
        })
      : (node.case_count ?? 0);
  const folderCheckboxState =
    pickerMode && node.directory_path
      ? getFolderPickerCheckboxState({
          directoryPath: node.directory_path,
          rows: pickerRows,
          selectedFilePaths,
          filterPath,
          directoryIndex,
        })
      : null;
  const folderCheckboxLoading = Boolean(loadingPrefixes?.has?.(node.directory_path));
  const structureLoading = Boolean(treeStructureLoadingPrefixes?.has?.(node.directory_path));
  const showPickerFolderCheckbox = pickerMode && Boolean(node.directory_path);

  const folderDropTarget = node.directory_path;
  const canDropIntoFolder =
    multiSelectActive &&
    folderDropTarget &&
    Array.isArray(draggingSourcePaths) &&
    draggingSourcePaths.some((p) => {
      if (typeof p !== "string" || !p.includes("/")) return false;
      const parent = p.slice(0, p.lastIndexOf("/"));
      return parent !== folderDropTarget;
    });
  const isDragOverFolder = Boolean(canDropIntoFolder) && dragOverFolderPath === folderDropTarget;
  const isContextFolderHighlight =
    contextMenuTargetFolderNode != null && contextMenuTargetFolderNode === node;
  const projectFocusActive =
    Boolean(openedProjectPath) && openedProjectPath === node.directory_path;
  const runFocusActive = Boolean(openedRunPath) && openedRunPath === node.directory_path;
  const showBackControl = projectFocusActive || runFocusActive;
  const pinned =
    pinningEnabled && isProject && !isRun && node.directory_path
      ? Boolean(isPinned?.(node.directory_path))
      : false;
  const showPinControl =
    pinningEnabled && isProject && !isRun && !isRenaming && !showBackControl;
  const displayName = node.display_name ?? editableName ?? node.name;
  const folderRowSelected = isSelected || isContextFolderHighlight;

  const handleSelectFolder = () => {
    if (isRenaming || !node.directory_path) return;
    onSelectFolder?.(node.directory_path);
    onFolderExpand?.(node.directory_path);
  };

  const expandIfCollapsed = () => {
    if (isExpanded || !canToggle) return;
    onFolderExpand?.(node.directory_path);
    onToggle(pathKey);
  };

  const handleRowClick = () => {
    if (isRenaming) return;
    handleSelectFolder();
  };

  const handleExpandClick = (e) => {
    e.stopPropagation();
    if (isRenaming || !canToggle || showBackControl) return;
    if (isExpanded) {
      onToggle(pathKey);
      return;
    }
    onFolderExpand?.(node.directory_path);
    onToggle(pathKey);
  };

  const handleBackClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (runFocusActive) {
      onCloseOpenedRun?.();
      return;
    }
    onCloseOpenedProject?.();
  };

  const handleRowDoubleClick = () => {
    if (isRenaming || !node.directory_path) return;
    if (isRun && onOpenRun) {
      if (openedRunPath === node.directory_path) return;
      onOpenRun(node.directory_path);
      return;
    }
    if (isProject && !isRun && onOpenProject) {
      if (openedProjectPath === node.directory_path) return;
      onOpenProject(node.directory_path);
    }
  };

  const handleRowKeyDown = (e) => {
    const target = e.target;
    const isEditable =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      (target.isContentEditable && target.getAttribute("contenteditable") !== "false");
    if (isEditable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick();
    }
  };

  const handleRowContextMenu = (e) => {
    if (isRun) {
      e.preventDefault();
      onContextMenuRun?.(node, e);
      return;
    }
    onContextMenu?.(e, node);
  };

  const handleFolderCheck = async (e) => {
    e.stopPropagation();
    if (pickerDisabled || !node.directory_path) return;
    expandIfCollapsed();
    if (isProject && onToggleProject) {
      await onToggleProject(node);
      return;
    }
    if (!isProject && onToggleSuite) {
      await onToggleSuite(node);
    }
  };

  const backAriaLabel = runFocusActive ? "Back to all runs" : "Back to all projects";

  return (
    <RowTag
      ref={measureRef}
      role={virtualized ? "listitem" : undefined}
      data-folder-drop-container={multiSelectActive && folderDropTarget ? folderDropTarget : undefined}
      className={`${rowClassName} ${isDragOverFolder ? "bg-indigo-100/70 dark:bg-indigo-950/40" : ""}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={canToggle && !showBackControl ? isExpanded : undefined}
        onClick={handleRowClick}
        onDoubleClick={handleRowDoubleClick}
        onKeyDown={handleRowKeyDown}
        onMouseDown={(e) => {
          if (!isRenaming && e.button !== 0) e.preventDefault();
        }}
        onContextMenu={handleRowContextMenu}
        className={`flex min-w-0 w-full cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/80 dark:focus-visible:ring-indigo-500/70 ${
          isDragOverFolder
            ? "bg-transparent"
            : showBackControl
              ? folderRowSelected
                ? "sticky top-0 z-20 border-b border-slate-200/80 bg-list-selected dark:border-slate-700/80 dark:bg-slate-700"
                : "sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50 hover:bg-list-hover dark:border-slate-700/80 dark:bg-slate-950 dark:hover:bg-slate-800"
              : isContextFolderHighlight
                ? treeRowSelectedFullWidthClass
                : isSelected
                  ? treeRowSelectedFullWidthClass
                  : treeRowHoverFullWidthClass
        }`}
        data-folder-drop-header={multiSelectActive && folderDropTarget ? folderDropTarget : undefined}
        title={displayName}
      >
        <TreeRowGuides level={level} />
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5 font-medium"
          style={{ paddingLeft: `${contentGap}px` }}
        >
          {showPickerFolderCheckbox ? (
            <input
              type="checkbox"
              checked={folderCheckboxState?.checked ?? false}
              disabled={pickerDisabled || folderCheckboxLoading}
              ref={(el) => {
                if (el) el.indeterminate = folderCheckboxState?.indeterminate ?? false;
              }}
              onChange={handleFolderCheck}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
          ) : null}
          {showBackControl ? (
            <Tooltip label={backAriaLabel} placement="bottom">
              <button
                type="button"
                onClick={handleBackClick}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200/80 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/80 dark:hover:text-slate-200"
                aria-label={backAriaLabel}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : canToggle ? (
            <button
              type="button"
              onClick={handleExpandClick}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${displayName}` : `Expand ${displayName}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              {structureLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          ) : (
            <span className="w-6 shrink-0" />
          )}
          <div
            className={`group flex min-w-0 flex-1 select-none flex-col gap-1 rounded py-1.5 pr-1 text-left text-sm ${
              isSelected
                ? "font-semibold text-ink dark:text-slate-100"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            <div className="flex min-w-0 items-center gap-1">
            {isRun ? (
              <TestRunIcon className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" aria-hidden />
            ) : isProject ? (
              <Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
            ) : null}
            {isRenaming ? (
              <InlineRenameInput
                initialValue={node.display_name ?? editableName ?? node.name}
                placeholder={isRun ? "Run name…" : "Name…"}
                onCommit={(val) => {
                  if (isRun) {
                    if (val != null) onRenameRunCommit?.(node.run_id, val);
                    else onRenameRunCancel?.();
                    return;
                  }
                  onRenameCommit(node.directory_path, val);
                }}
                onValueChange={isRun ? undefined : onFolderRenameValueChange}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">{node.display_name ?? editableName ?? node.name}</span>
            )}
            {!isRenaming ? (
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {showPinControl ? (
                  <Tooltip label={pinned ? "Unpin project" : "Pin project to top"} placement="bottom">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onTogglePin?.(node.directory_path);
                      }}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400 ${
                        pinned
                          ? "text-indigo-600 opacity-100 dark:text-indigo-400"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                      aria-label={pinned ? "Unpin project" : "Pin project to top"}
                    >
                      <Pin className={`h-3 w-3 ${pinned ? "fill-current" : ""}`} aria-hidden />
                    </button>
                  </Tooltip>
                ) : null}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none ${
                    pickerCaseCount === 0
                      ? "bg-slate-50 text-slate-300 dark:bg-slate-800/50 dark:text-slate-600"
                      : isSelected
                        ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/30 dark:text-indigo-300"
                        : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-slate-700"
                  }`}
                >
                  {folderCheckboxLoading ? "…" : pickerCaseCount}
                </span>
                {node.result_stats ? <RunResultCountBadges stats={node.result_stats} /> : null}
              </span>
            ) : null}
            {!isRenaming && isRun && typeof runRowRight === "function" ? runRowRight(node) : null}
            </div>
            {renameFolderConflictName ? (
              <InlineRenameConflictAlert name={renameFolderConflictName} />
            ) : null}
          </div>
        </div>
      </div>
    </RowTag>
  );
}

function folderTreeRowPropsAreEqual(prev, next) {
  const prevRow = prev.row;
  const nextRow = next.row;
  if (prevRow.kind !== nextRow.kind) return false;
  if (prevRow.kind === "inlineCreate") {
    return (
      prevRow.parentPath === nextRow.parentPath &&
      prevRow.level === nextRow.level &&
      prev.virtualized === next.virtualized
    );
  }
  if (
    prevRow.pathKey !== nextRow.pathKey ||
    prevRow.isExpanded !== nextRow.isExpanded ||
    prevRow.level !== nextRow.level ||
    prevRow.node !== nextRow.node
  ) {
    return false;
  }
  if (prev.selectedFolderPath !== next.selectedFolderPath) return false;
  if (prev.renamingPath !== next.renamingPath) return false;
  if (prev.renameFolderConflict !== next.renameFolderConflict) return false;
  if (prev.renamingRunId !== next.renamingRunId) return false;
  if (prev.dragOverFolderPath !== next.dragOverFolderPath) return false;
  if (prev.multiSelectActive !== next.multiSelectActive) return false;
  if (prev.pickerDisabled !== next.pickerDisabled) return false;
  if (prev.pickerMode !== next.pickerMode) return false;
  if (prev.virtualized !== next.virtualized) return false;
  if (prev.pinningEnabled !== next.pinningEnabled) return false;
  if (prev.openedProjectPath !== next.openedProjectPath) return false;
  if (prev.openedRunPath !== next.openedRunPath) return false;
  if (prev.onOpenProject !== next.onOpenProject) return false;
  if (prev.onCloseOpenedProject !== next.onCloseOpenedProject) return false;
  if (prev.onOpenRun !== next.onOpenRun) return false;
  if (prev.onCloseOpenedRun !== next.onCloseOpenedRun) return false;
  if (prev.contextMenuTargetFolderNode !== next.contextMenuTargetFolderNode) return false;
  if (prev.directoryIndex !== next.directoryIndex) return false;
  if (prev.selectedFilePaths !== next.selectedFilePaths) return false;
  if (prev.loadingPrefixes !== next.loadingPrefixes) return false;
  if (prev.loadedPrefixes !== next.loadedPrefixes) return false;
  if (prev.treeStructureLoadingPrefixes !== next.treeStructureLoadingPrefixes) return false;
  if (prev.draggingSourcePaths !== next.draggingSourcePaths) return false;
  return true;
}

export default memo(FolderTreeRow, folderTreeRowPropsAreEqual);
