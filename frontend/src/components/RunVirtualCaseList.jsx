import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ContextMenu from "./ContextMenu";
import RepositoryCaseListHeader from "./RepositoryCaseListHeader";
import RunCaseListRow from "./RunCaseListRow";
import {
  CASE_ROW_ESTIMATE_PX,
  VIRTUAL_CASE_LIST_OVERSCAN,
  VIRTUAL_CASE_LIST_THRESHOLD,
} from "../constants/virtualCaseList";
import { useCaseRowSelection } from "../hooks/useCaseRowSelection";
import { browseColumnNoSelect, flexFillScroll } from "../utils/layoutClasses";

const LOAD_MORE_THRESHOLD_PX = 240;

/**
 * Virtual-scrolled flat case list for Test Run / Review column 2 (infinite scroll).
 */
function RunVirtualCaseList({
  cases = [],
  total = null,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  selectedCaseFilePath = null,
  onSelectCase,
  folderPath = null,
  listTitle = null,
  emptyMessage = "No cases",
  noRunMessage = "Select a run",
  noFolderMessage = "Select a project or suite",
  showNoRunWhenEmpty = false,
  showNoFolderWhenEmpty = false,
  onSetResult,
  defaultRunId = null,
  caseResultMode = "buttons",
  caseSelectionConfig = null,
  onContextMenuCase,
  getContextMenuItems,
  renderRowRight,
}) {
  const scrollRef = useRef(null);
  const loadMoreLockRef = useRef(false);
  const [contextMenu, setContextMenu] = useState(null);

  const multiSelectActive = Boolean(caseSelectionConfig);
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

  const contextMenuItems = useMemo(() => {
    if (!contextMenu?.case || !getContextMenuItems) return [];
    return getContextMenuItems(contextMenu.case, setContextMenu);
  }, [contextMenu, getContextMenuItems]);

  const contextMenuEnabled = Boolean(getContextMenuItems || onContextMenuCase);

  const renderCaseRow = useCallback(
    (c) => {
      const inMultiSet = caseSelectionConfig?.selectedPaths?.has(c.file_path);
      const isSelected = multiSelectActive
        ? Boolean(inMultiSet)
        : selectedCaseFilePath === c.file_path;
      const rowRunId = c.run_id ?? defaultRunId;
      const rowOnSetResult =
        onSetResult && rowRunId
          ? (filePath, value) => onSetResult(rowRunId, filePath, value)
          : undefined;
      return (
        <RunCaseListRow
          as="div"
          caseRow={c}
          multiSelectActive={multiSelectActive}
          isSelected={isSelected}
          onCaseRowClick={handleCaseRowClick}
          onSelectCase={onSelectCase}
          onContextMenuCase={
            contextMenuEnabled
              ? (e, row) => {
                  e.preventDefault();
                  e.stopPropagation();
                  prepareContextMenuSelection(row);
                  onContextMenuCase?.(e, row);
                  if (getContextMenuItems) {
                    setContextMenu({ x: e.clientX, y: e.clientY, case: row });
                  }
                }
              : undefined
          }
          onSetResult={rowOnSetResult}
          caseResultMode={caseResultMode}
          rowRight={renderRowRight?.(c)}
        />
      );
    },
    [
      caseSelectionConfig,
      multiSelectActive,
      selectedCaseFilePath,
      defaultRunId,
      handleCaseRowClick,
      onSelectCase,
      contextMenuEnabled,
      getContextMenuItems,
      onContextMenuCase,
      prepareContextMenuSelection,
      onSetResult,
      caseResultMode,
      renderRowRight,
    ],
  );

  const hasListContent =
    (!showNoRunWhenEmpty || folderPath) && (!showNoFolderWhenEmpty || folderPath);
  const showEmpty =
    !hasListContent || (displayCases.length === 0 && !loading);

  const serverTotal = total ?? displayCases.length;
  const rangeLabel =
    serverTotal > 0 && displayCases.length > 0
      ? displayCases.length < serverTotal
        ? `${displayCases.length} of ${serverTotal} cases`
        : `${serverTotal} case${serverTotal === 1 ? "" : "s"}`
      : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <RepositoryCaseListHeader
        title={listTitle}
        rangeLabel={rangeLabel}
        loadingMore={loadingMore}
      />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${flexFillScroll} ${browseColumnNoSelect}`}
      >
        {showEmpty ? (
          <div className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {showNoRunWhenEmpty && !folderPath
              ? noRunMessage
              : showNoFolderWhenEmpty && !folderPath
                ? noFolderMessage
                : loading
                  ? "Loading…"
                  : emptyMessage}
          </div>
        ) : shouldVirtualize ? (
          <div
            className="relative w-full px-1 py-1"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const c = displayCases[virtualRow.index];
              return (
                <div
                  key={c.run_id ? `${c.run_id}:${c.file_path}` : c.file_path}
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
              <li
                key={c.run_id ? `${c.run_id}:${c.file_path}` : c.file_path}
                className="list-none"
              >
                {renderCaseRow(c)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {contextMenu && contextMenuItems.length > 0 ? (
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

export default RunVirtualCaseList;
