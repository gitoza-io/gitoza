import { useCallback, useEffect, useMemo, useState } from "react";
import CaseListEntriesBody from "./CaseListEntriesBody";
import RunCaseListRow from "./RunCaseListRow";
import CaseListPagination from "./CaseListPagination";
import ContextMenu from "./ContextMenu";
import RepositoryCaseListHeader from "./RepositoryCaseListHeader";
import { REPOSITORY_CASE_PAGE_SIZE } from "../constants/repositoryCaseList";
import { useCaseRowSelection } from "../hooks/useCaseRowSelection";
import { getCasesInGroupedOrder } from "../utils/caseTree";
import { paginateGroupedCaseListEntries, paginateList } from "../utils/paginateList";
import { browseColumnNoSelect, flexFillScroll } from "../utils/layoutClasses";

/**
 * Paginated flat case list for Test Run / Review run mode (column 2).
 */
function RunPaginatedCaseList({
  cases = [],
  listEntries = null,
  page = 1,
  onPageChange,
  pageSize = REPOSITORY_CASE_PAGE_SIZE,
  selectedCaseFilePath = null,
  onSelectCase,
  folderPath = null,
  listTitle = null,
  loading = false,
  emptyMessage = "No cases",
  noRunMessage = "Select a run",
  noFolderMessage = "Select a project or suite",
  showNoRunWhenEmpty = false,
  showNoFolderWhenEmpty = false,
  onSetResult,
  /** Fallback run ID for rows without run_id (browse mode). */
  defaultRunId = null,
  caseResultMode = "buttons",
  caseSelectionConfig = null,
  onContextMenuCase,
  getContextMenuItems,
  renderRowRight,
  /** When set, pagination uses server total instead of in-memory list length. */
  serverTotal = null,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const multiSelectActive = Boolean(caseSelectionConfig);
  const groupedMode = listEntries != null;
  const displayCases = useMemo(
    () => (groupedMode ? getCasesInGroupedOrder(listEntries) : cases),
    [groupedMode, listEntries, cases],
  );

  const pagination = useMemo(() => {
    if (serverTotal != null && !groupedMode) {
      const totalPages = Math.max(1, Math.ceil(serverTotal / pageSize));
      const start = (page - 1) * pageSize;
      const end = Math.min(start + cases.length, serverTotal);
      return {
        page,
        totalPages,
        items: cases,
        entries: null,
        rangeLabel:
          serverTotal > 0 && cases.length > 0 ? `${start + 1}–${end} of ${serverTotal}` : null,
      };
    }
    if (groupedMode) {
      return paginateGroupedCaseListEntries(listEntries, { page, pageSize });
    }
    return { ...paginateList(cases, { page, pageSize }), entries: null };
  }, [groupedMode, listEntries, cases, page, pageSize, serverTotal]);

  const orderedPaths = useMemo(
    () => displayCases.map((c) => c.file_path).filter(Boolean),
    [displayCases],
  );

  const selectionConfigForPage = useMemo(() => {
    if (!caseSelectionConfig) return null;
    return {
      ...caseSelectionConfig,
      orderedPaths,
    };
  }, [caseSelectionConfig, orderedPaths]);

  const { handleCaseRowClick, prepareContextMenuSelection } = useCaseRowSelection({
    multiSelectActive,
    caseSelectionConfig: selectionConfigForPage,
    onSelectCase,
  });

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

  const hasListContent =
    (!showNoRunWhenEmpty || folderPath) && (!showNoFolderWhenEmpty || folderPath);
  const showEmpty =
    !hasListContent || (displayCases.length === 0 && !loading);

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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <RepositoryCaseListHeader
        title={listTitle}
        rangeLabel={displayCases.length > 0 ? pagination.rangeLabel : null}
      />
      <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${flexFillScroll} ${browseColumnNoSelect}`}>
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
        ) : (
          <ul className="space-y-0 px-1 py-1">
            {groupedMode && pagination.entries ? (
              <CaseListEntriesBody entries={pagination.entries} renderCaseRow={renderCaseRow} />
            ) : (
              pagination.items.map((c) => (
                <li key={c.run_id ? `${c.run_id}:${c.file_path}` : c.file_path} className="list-none">
                  {renderCaseRow(c)}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {(serverTotal != null ? serverTotal > pageSize : displayCases.length > pageSize) ? (
        <CaseListPagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={onPageChange}
        />
      ) : null}
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

export default RunPaginatedCaseList;
