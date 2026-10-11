import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, FilePlus2, Pencil, Trash2 } from "lucide-react";
import CaseDragPortal from "./CaseDragPortal";
import CaseListRow from "./CaseListRow";
import ContextMenu from "./ContextMenu";
import InlineRenameInput from "./InlineRenameInput";
import RepositoryCaseListHeader from "./RepositoryCaseListHeader";
import { isArchivedCasePath } from "../constants/casePaths";
import {
  CASE_ROW_ESTIMATE_PX,
  VIRTUAL_CASE_LIST_OVERSCAN,
  VIRTUAL_CASE_LIST_THRESHOLD,
} from "../constants/virtualCaseList";
import { useCasePointerDrag } from "../hooks/useCasePointerDrag";
import { useCaseRowSelection } from "../hooks/useCaseRowSelection";
import { isProjectDirectoryPath } from "../utils/caseTree";
import { computeRenamedCasePath, buildCaseActionPayload } from "../utils/caseCatalogMove";
import { isCaseInRenameSession, isRenameNameConflictError } from "../utils/renameConflict";
import { browseColumnNoSelect, flexFillScroll } from "../utils/layoutClasses";
import {
  countSelectedUnderDirectory,
  formatPickerSelectionLabel,
} from "../utils/casePickerFolderState";

const LOAD_MORE_THRESHOLD_PX = 240;

/**
 * Flat virtual-scrolled case list for Test Repository column 2 (server window + infinite scroll).
 */
function RepositoryVirtualCaseList({
  cases = [],
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  selectedCaseFilePath = null,
  onSelectCase,
  folderPath = null,
  listTitle = null,
  emptyMessage = "No cases",
  noFolderMessage = "Select a project or suite",
  showNoFolderWhenEmpty = false,
  editorLocked = false,
  archivedView = false,
  caseSelectionConfig = null,
  onArchiveCase,
  onRestoreCase,
  onDeleteCase,
  onRenameCase,
  creatingCaseInPath = null,
  creatingCaseError = null,
  onCommitInlineCase,
  onClearCreatingCase,
  onNewCase,
  dragProps = null,
  pickerMode = false,
  selectedFilePaths,
  onToggleCase,
  pickerDisabled = false,
  renderRowRight,
  isRowDeleted,
}) {
  const scrollRef = useRef(null);
  const loadMoreLockRef = useRef(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [renamingCaseSession, setRenamingCaseSession] = useState(null);
  const [renameCaseConflict, setRenameCaseConflict] = useState(null);

  const multiSelectActive = Boolean(caseSelectionConfig) && !editorLocked && !pickerMode;
  const displayCases = cases;

  const orderedPaths = useMemo(
    () => displayCases.map((c) => c.file_path).filter(Boolean),
    [displayCases],
  );

  const selectionConfigForList = useMemo(() => {
    if (!caseSelectionConfig) return null;
    return {
      ...caseSelectionConfig,
      orderedPaths,
    };
  }, [caseSelectionConfig, orderedPaths]);

  const { handleCaseRowClick, prepareContextMenuSelection } = useCaseRowSelection({
    multiSelectActive,
    caseSelectionConfig: selectionConfigForList,
    onSelectCase,
  });

  const internalDrag = useCasePointerDrag({
    multiSelectActive: dragProps ? false : multiSelectActive,
    caseSelectionConfig: dragProps ? null : caseSelectionConfig,
  });

  const pointerDragUI = dragProps?.pointerDragUI ?? internalDrag.pointerDragUI;
  const draggingSourcePaths = dragProps?.draggingSourcePaths ?? internalDrag.draggingSourcePaths;
  const handleCaseRowPointerDown =
    dragProps?.handleCaseRowPointerDown ?? internalDrag.handleCaseRowPointerDown;

  const shouldVirtualize = displayCases.length >= VIRTUAL_CASE_LIST_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: displayCases.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CASE_ROW_ESTIMATE_PX,
    overscan: VIRTUAL_CASE_LIST_OVERSCAN,
    enabled: shouldVirtualize && displayCases.length > 0,
  });

  const tryLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore || !onLoadMore) return;
    if (loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;
    Promise.resolve(onLoadMore()).finally(() => {
      loadMoreLockRef.current = false;
    });
  }, [hasMore, loading, loadingMore, onLoadMore]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD_PX) {
      tryLoadMore();
    }
  }, [tryLoadMore]);

  useEffect(() => {
    if (!loadingMore) {
      loadMoreLockRef.current = false;
    }
  }, [loadingMore]);

  const getSelectedActionPaths = useCallback(
    (clickedCase) => {
      const clickedPath = clickedCase?.file_path;
      if (!multiSelectActive || !caseSelectionConfig || !clickedPath) return [];
      const selected = caseSelectionConfig.selectedPaths;
      if (selected && selected.size > 0) {
        if (!selected.has(clickedPath)) return [clickedPath];
        return Array.from(selected);
      }
      return [clickedPath];
    },
    [multiSelectActive, caseSelectionConfig],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const handleCaseRenameCommit = useCallback(
    async (caseRow, newName) => {
      if (newName == null) {
        setRenamingCaseSession(null);
        setRenameCaseConflict(null);
        return;
      }
      if (!onRenameCase) return;
      const sourcePath = caseRow.file_path;
      const targetPath = computeRenamedCasePath(sourcePath, newName);
      setRenamingCaseSession({ sourcePath, targetPath });
      setRenameCaseConflict(null);
      try {
        await onRenameCase(caseRow, newName);
        setRenamingCaseSession(null);
        setRenameCaseConflict(null);
      } catch (err) {
        if (isRenameNameConflictError(err)) {
          setRenameCaseConflict({ sourcePath, displayName: err.displayName });
          setRenamingCaseSession({ sourcePath, targetPath: null });
          return;
        }
        setRenamingCaseSession(null);
        setRenameCaseConflict(null);
      }
    },
    [onRenameCase],
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu?.case || editorLocked) return [];
    const c = contextMenu.case;
    const isArchived = isArchivedCasePath(c.file_path);
    const actionPaths = getSelectedActionPaths(c);
    const actionCount = actionPaths.length || 1;
    const bulkSuffix = actionCount > 1 ? ` (${actionCount})` : "";
    const items = [];

    if (isArchived) {
      if (onRestoreCase) {
        items.push({
          icon: Archive,
          label: `Restore${bulkSuffix}`,
          onClick: () => {
            const payload = buildCaseActionPayload(actionPaths, c, displayCases);
            if (payload) onRestoreCase(payload);
            setContextMenu(null);
          },
        });
      }
      if (onDeleteCase) {
        if (items.length > 0) items.push({ type: "separator" });
        items.push({
          icon: Trash2,
          label: `Delete permanently${bulkSuffix}`,
          variant: "danger",
          onClick: () => {
            const payload = buildCaseActionPayload(actionPaths, c, displayCases);
            if (payload) onDeleteCase(payload);
            setContextMenu(null);
          },
        });
      }
      return items;
    }

    const renameEnabled =
      !multiSelectActive ||
      !caseSelectionConfig?.selectedPaths ||
      caseSelectionConfig.selectedPaths.size <= 1;
    if (onRenameCase && renameEnabled) {
      items.push({
        icon: Pencil,
        label: "Rename",
        onClick: () => {
          setRenamingCaseSession({ sourcePath: c.file_path, targetPath: null });
          setRenameCaseConflict(null);
          setContextMenu(null);
        },
      });
    }
    if (onArchiveCase) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push({
        icon: Archive,
        label: `Archive${bulkSuffix}`,
        onClick: () => {
          const payload = buildCaseActionPayload(actionPaths, c, displayCases);
          if (payload) onArchiveCase(payload);
          setContextMenu(null);
        },
      });
    }
    return items;
  }, [
    contextMenu,
    editorLocked,
    getSelectedActionPaths,
    onRestoreCase,
    onDeleteCase,
    onRenameCase,
    onArchiveCase,
    multiSelectActive,
    caseSelectionConfig,
  ]);

  const showCreatingCase =
    creatingCaseInPath && folderPath && creatingCaseInPath === folderPath && onCommitInlineCase;

  const hasListContent = folderPath || !showNoFolderWhenEmpty;
  const showEmpty =
    !hasListContent || (displayCases.length === 0 && !showCreatingCase && !loading);

  const pickerSelectionLabel = useMemo(() => {
    if (!pickerMode || displayCases.length === 0) return null;
    const folderSelected = folderPath
      ? countSelectedUnderDirectory(selectedFilePaths ?? new Set(), folderPath)
      : [...(selectedFilePaths ?? [])].filter((p) =>
          displayCases.some((c) => c.file_path === p),
        ).length;
    return formatPickerSelectionLabel(folderSelected, displayCases.length);
  }, [pickerMode, displayCases, folderPath, selectedFilePaths]);

  const renderCaseRow = useCallback(
    (c) => {
      const inMultiSet = caseSelectionConfig?.selectedPaths?.has(c.file_path);
      const isSelected = pickerMode
        ? selectedCaseFilePath === c.file_path
        : multiSelectActive
          ? Boolean(inMultiSet)
          : selectedCaseFilePath === c.file_path;
      const isRenamingCase = isCaseInRenameSession(c.file_path, renamingCaseSession);
      const renameConflictName =
        isRenamingCase && renameCaseConflict?.sourcePath === renamingCaseSession?.sourcePath
          ? renameCaseConflict.displayName
          : null;
      const dragPaths =
        multiSelectActive &&
        caseSelectionConfig?.selectedPaths?.has(c.file_path) &&
        caseSelectionConfig.selectedPaths.size > 0
          ? Array.from(caseSelectionConfig.selectedPaths)
          : [c.file_path];
      const isDragSource = Boolean(draggingSourcePaths?.includes(c.file_path));
      const checked = pickerMode && selectedFilePaths?.has(c.file_path);
      return (
        <CaseListRow
          as="div"
          caseRow={c}
          multiSelectActive={multiSelectActive}
          isSelected={isSelected}
          isRenamingCase={isRenamingCase}
          dragPaths={dragPaths}
          isDragSource={isDragSource}
          onCaseRowClick={handleCaseRowClick}
          onSelectCase={onSelectCase}
          onCaseRenameCommit={handleCaseRenameCommit}
          onCaseRenameValueChange={() => setRenameCaseConflict(null)}
          renameConflictName={renameConflictName}
          onContextMenuCase={
            pickerMode
              ? undefined
              : (e, row) => {
                  e.preventDefault();
                  e.stopPropagation();
                  prepareContextMenuSelection(row);
                  setContextMenu({ x: e.clientX, y: e.clientY, case: row });
                }
          }
          onCaseRowPointerDown={pickerMode ? undefined : handleCaseRowPointerDown}
          pickerMode={pickerMode}
          checked={checked}
          onToggleCase={onToggleCase}
          pickerDisabled={pickerDisabled}
          rowRight={renderRowRight?.(c)}
          rowDeleted={Boolean(isRowDeleted?.(c))}
        />
      );
    },
    [
      caseSelectionConfig,
      pickerMode,
      selectedCaseFilePath,
      multiSelectActive,
      renamingCaseSession,
      renameCaseConflict,
      draggingSourcePaths,
      handleCaseRowClick,
      onSelectCase,
      handleCaseRenameCommit,
      prepareContextMenuSelection,
      handleCaseRowPointerDown,
      selectedFilePaths,
      onToggleCase,
      pickerDisabled,
      renderRowRight,
      isRowDeleted,
    ],
  );

  const creatingCaseRow = showCreatingCase ? (
    <div className="px-1 py-1">
      <div className="flex min-w-0 flex-col gap-0.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <FilePlus2 className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
          <InlineRenameInput
            initialValue=""
            placeholder="Case ID (filename)…"
            onCommit={(val) => {
              const p = onCommitInlineCase(
                folderPath,
                isProjectDirectoryPath(folderPath),
                val,
              );
              if (p && typeof p.then === "function") p.catch(() => {});
              if (val == null) onClearCreatingCase?.();
            }}
          />
        </div>
        {creatingCaseError ? (
          <p className="text-xs text-red-600 dark:text-red-400" role="alert">
            {creatingCaseError}
          </p>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <RepositoryCaseListHeader
        title={listTitle}
        loadingMore={loadingMore}
        selectionLabel={pickerSelectionLabel}
        onNewCase={pickerMode ? undefined : onNewCase}
        newCaseDisabled={!folderPath || editorLocked}
      />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${flexFillScroll} ${browseColumnNoSelect}`}
      >
        {showEmpty ? (
          <div className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {showNoFolderWhenEmpty && !folderPath
              ? noFolderMessage
              : loading
                ? "Loading…"
                : emptyMessage}
          </div>
        ) : (
          <>
            {creatingCaseRow}
            {shouldVirtualize ? (
              <div
                className="relative w-full px-1 py-1"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const c = displayCases[virtualRow.index];
                  return (
                    <div
                      key={c.file_path}
                      data-index={virtualRow.index}
                      className="absolute left-0 top-0 w-full px-1"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {renderCaseRow(c)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="space-y-0 px-1 py-1">
                {displayCases.map((c) => (
                  <li key={c.file_path} className="list-none">
                    {renderCaseRow(c)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {!pickerMode ? <CaseDragPortal pointerDragUI={pointerDragUI} /> : null}
      {!pickerMode && contextMenu && contextMenuItems.length > 0 ? (
        <ContextMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={contextMenuItems}
        />
      ) : null}
    </div>
  );
}

export default RepositoryVirtualCaseList;
