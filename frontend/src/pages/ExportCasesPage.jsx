import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRefetchWhenActive } from "../components/PersistentView";
import { ChevronDown } from "lucide-react";
import CaseReadOnlyDetailPanel from "../components/CaseReadOnlyDetailPanel";
import RepositoryFolderTree from "../components/RepositoryFolderTree";
import RepositoryPaginatedCaseList from "../components/RepositoryPaginatedCaseList";
import SearchPanel from "../components/SearchPanel";
import SearchToggleButton from "../components/SearchToggleButton";
import SidebarSection from "../components/SidebarSection";
import TestRepositoryThreeColumnLayout from "../components/TestRepositoryThreeColumnLayout";
import TreeToolbar from "../components/TreeToolbar";
import OperationInProgressOverlay from "../components/OperationInProgressOverlay";
import { caseSearchKeys } from "../constants/searchKeys";
import { LONG_OPERATION_TITLE_EXPORT_CASES } from "../copy/longOperationCopy";
import { usePickerBrowseState } from "../hooks/usePickerBrowseState";
import { useSearchFolderTree } from "../hooks/useSearchFolderTree";
import { useSearchPrefs } from "../hooks/useSearchPrefs";
import { toggleProjectSelection, toggleSuiteSelection } from "../utils/casePickerSelection";
import {
  findFolderDisplayName,
  getCasesForFolderSelection,
  mapRowsToCaseListItems,
} from "../utils/caseTree";

const EXPORT_FORMATS = [
  { id: "csv", label: "CSV" },
  { id: "pdf", label: "PDF" },
];

const PICKER_STORAGE_KEYS = {
  treeWidth: "casePicker.col.treeWidth",
  listWidth: "casePicker.col.listWidth",
};

/**
 * Full-page "Export test cases": three-column picker (folder tree | case list | detail).
 */
function ExportCasesPage({
  tree = [],
  filteredRows = [],
  filterOptions = {},
  getCaseDetail,
  activeRepoSlug,
  onSearchCases,
  activeSearchChips,
  onExport,
  onCancel,
  sidebarFooter,
  sidebarTitleRight,
  reviewEnabled = true,
  onFolderExpand,
  loadingPrefixes,
  loadedPrefixes,
  projectsReady = false,
  treeStructureLoadingPrefixes = null,
  loadCasesForPrefix,
  loadAllProjectPrefixes,
}) {
  const [selectedFilePaths, setSelectedFilePaths] = useState(() => new Set());
  const [selectedCaseFilePath, setSelectedCaseFilePath] = useState(null);
  const [caseDetail, setCaseDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exportFormat, setExportFormat] = useState("csv");
  const [formatDropdownOpen, setFormatDropdownOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const caseDetailFetchIdRef = useRef(0);

  const { history, favorites, pushHistory, toggleFavorite, isFavorite } =
    useSearchPrefs("case");

  const rowsToShow = filteredRows;

  const searchActive = Boolean(activeSearchChips?.length);
  const searchResetKey = useMemo(
    () =>
      (activeSearchChips ?? [])
        .map((c) => `${c.key}:${c.value ?? ""}`)
        .join("|"),
    [activeSearchChips],
  );

  const {
    searchTree,
    searchFolderPath,
    searchExpanded,
    setSearchExpanded,
    folderScopedCases,
    handleSelectSearchFolder,
  } = useSearchFolderTree({
    apiTree: tree,
    rows: rowsToShow,
    searchActive,
    searchResetKey,
  });

  const preloadProjectPrefixes = useCallback(() => {
    if (!loadAllProjectPrefixes || !tree?.length) return;
    const projectPaths = tree.map((node) => node.directory_path).filter(Boolean);
    const run = () => {
      void loadAllProjectPrefixes(projectPaths);
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run);
    } else {
      setTimeout(run, 0);
    }
  }, [tree, loadAllProjectPrefixes]);

  useRefetchWhenActive(preloadProjectPrefixes);

  const {
    selectedFolderPath,
    expanded,
    setExpanded,
    caseListPage,
    setCaseListPage,
    handleSelectBrowseFolder,
  } = usePickerBrowseState({
    tree,
    selectedCaseFilePath,
    searchOpen,
    searchActive: Boolean(activeSearchChips?.length),
    onFolderExpand,
  });

  useEffect(() => {
    setCaseListPage(1);
  }, [searchFolderPath, setCaseListPage]);

  const handleSearch = useCallback(
    (chips) => {
      if (chips.length > 0) pushHistory(chips);
      onSearchCases?.(chips);
    },
    [pushHistory, onSearchCases],
  );

  const handleCloseSearch = useCallback(() => {
    onSearchCases?.([]);
    setSearchOpen(false);
  }, [onSearchCases]);

  const handleToggleCase = useCallback((filePath) => {
    setSelectedFilePaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const handleToggleSuite = useCallback(
    async (node) => {
      if (!node?.directory_path || !loadCasesForPrefix) return;
      await toggleSuiteSelection({
        directoryPath: node.directory_path,
        rows: rowsToShow,
        setSelectedFilePaths,
        loadCasesForPrefix,
      });
    },
    [rowsToShow, loadCasesForPrefix],
  );

  const handleToggleProject = useCallback(
    async (node) => {
      if (!node?.directory_path || !loadCasesForPrefix) return;
      await toggleProjectSelection({
        directoryPath: node.directory_path,
        rows: rowsToShow,
        setSelectedFilePaths,
        loadCasesForPrefix,
      });
    },
    [rowsToShow, loadCasesForPrefix],
  );

  const handleSelectCase = useCallback(
    async (row) => {
      const nextPath = row?.file_path ?? null;
      setSelectedCaseFilePath(nextPath);
      if (!nextPath) {
        setCaseDetail(null);
        setDetailLoading(false);
        return;
      }
      const fetchId = ++caseDetailFetchIdRef.current;
      setDetailLoading(true);
      try {
        const detail = await getCaseDetail(nextPath, activeRepoSlug);
        if (caseDetailFetchIdRef.current !== fetchId) return;
        setCaseDetail(detail);
      } catch (_) {
        if (caseDetailFetchIdRef.current !== fetchId) return;
        setCaseDetail(row);
      } finally {
        if (caseDetailFetchIdRef.current === fetchId) {
          setDetailLoading(false);
        }
      }
    },
    [getCaseDetail, activeRepoSlug],
  );

  const handleExport = useCallback(async () => {
    const selectedRows = rowsToShow.filter((r) => selectedFilePaths.has(r.file_path));
    if (selectedRows.length === 0) return;
    setExporting(true);
    try {
      const details = await Promise.all(
        selectedRows.map((r) =>
          getCaseDetail(r.file_path, activeRepoSlug).catch(() => r),
        ),
      );
      await onExport?.(details, exportFormat);
    } finally {
      setExporting(false);
    }
  }, [rowsToShow, selectedFilePaths, exportFormat, getCaseDetail, activeRepoSlug, onExport]);

  const browseCases = useMemo(
    () => getCasesForFolderSelection(rowsToShow, tree, selectedFolderPath),
    [rowsToShow, tree, selectedFolderPath],
  );

  const browseCaseItems = useMemo(() => mapRowsToCaseListItems(browseCases), [browseCases]);
  const searchCaseItems = useMemo(() => {
    if (!searchActive) return [];
    if (folderScopedCases) return folderScopedCases;
    return mapRowsToCaseListItems(rowsToShow);
  }, [searchActive, folderScopedCases, rowsToShow]);

  const searchListTitle = useMemo(() => {
    if (!searchActive) return "Search results";
    if (searchFolderPath) return findFolderDisplayName(searchTree, searchFolderPath);
    return "Search results";
  }, [searchActive, searchFolderPath, searchTree]);

  const searchSidebarTree = useMemo(() => {
    if (!searchActive) return null;
    if (searchTree.length > 0) {
      return (
        <RepositoryFolderTree
          tree={searchTree}
          selectedFolderPath={searchFolderPath}
          onSelectFolder={handleSelectSearchFolder}
          expanded={searchExpanded}
          onExpandedChange={setSearchExpanded}
          pickerMode
          pickerRows={rowsToShow}
          selectedFilePaths={selectedFilePaths}
          onToggleProject={handleToggleProject}
          onToggleSuite={handleToggleSuite}
        />
      );
    }
    return (
      <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
        No matching cases in any folder.
      </div>
    );
  }, [
    searchActive,
    searchTree,
    searchFolderPath,
    handleSelectSearchFolder,
    searchExpanded,
    setSearchExpanded,
    rowsToShow,
    selectedFilePaths,
    handleToggleProject,
    handleToggleSuite,
  ]);

  const folderLabel = findFolderDisplayName(tree, selectedFolderPath);
  const folderLoading = Boolean(
    selectedFolderPath && loadingPrefixes?.has?.(selectedFolderPath),
  );

  const selectedCount = selectedFilePaths.size;
  const currentFormatLabel = EXPORT_FORMATS.find((f) => f.id === exportFormat)?.label ?? exportFormat;

  const cancelFormatExportRow = (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        Cancel
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setFormatDropdownOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          aria-expanded={formatDropdownOpen}
          aria-haspopup="listbox"
          aria-label="Export format"
        >
          {currentFormatLabel}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {formatDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              aria-hidden
              onClick={() => setFormatDropdownOpen(false)}
            />
            <ul
              role="listbox"
              className="absolute right-0 top-full z-20 mt-1 min-w-[6rem] rounded-ui border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
            >
              {EXPORT_FORMATS.map((f) => (
                <li key={f.id} role="option" aria-selected={exportFormat === f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setExportFormat(f.id);
                      setFormatDropdownOpen(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {f.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={handleExport}
        disabled={selectedCount === 0 || exporting}
        className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
      >
        {exporting ? "Exporting…" : `Export (${selectedCount})`}
      </button>
    </div>
  );

  const searchButton = (
    <SearchToggleButton
      isOpen={searchOpen}
      hasActiveChips={!!activeSearchChips?.length}
      onClick={() => (searchOpen ? handleCloseSearch() : setSearchOpen(true))}
      ariaLabelWhenClosed="Filter cases"
    />
  );

  const projectToolbar = (
    <TreeToolbar
      sortButton={null}
      leftExtra={<div className="flex shrink-0 items-center pl-4">{searchButton}</div>}
      searchNode={null}
      trailingActions={cancelFormatExportRow}
      onBeforeAction={searchOpen ? handleCloseSearch : undefined}
    />
  );

  const treeColumnBody = searchOpen ? (
    <SearchPanel
      searchKeys={caseSearchKeys(reviewEnabled)}
      filterOptions={filterOptions}
      onSearch={handleSearch}
      onClose={handleCloseSearch}
      history={history}
      favorites={favorites}
      onToggleFavorite={toggleFavorite}
      isFavorite={isFavorite}
      resultsInSeparateColumn
      sidebarResultsContent={searchSidebarTree}
      freeTextSearchKey="q"
      freeTextPlaceholder="Search by ID, title, tag, path…"
    />
  ) : (
    <RepositoryFolderTree
      tree={tree}
      projectsReady={projectsReady}
      treeStructureLoadingPrefixes={treeStructureLoadingPrefixes}
      selectedFolderPath={selectedFolderPath}
      onSelectFolder={handleSelectBrowseFolder}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onFolderExpand={onFolderExpand}
      loadingPrefixes={loadingPrefixes}
      loadedPrefixes={loadedPrefixes}
      pickerMode
      pickerRows={rowsToShow}
      selectedFilePaths={selectedFilePaths}
      onToggleProject={handleToggleProject}
      onToggleSuite={handleToggleSuite}
    />
  );

  const caseListColumn = searchOpen ? (
    <RepositoryPaginatedCaseList
      cases={searchActive ? searchCaseItems : []}
      page={caseListPage}
      onPageChange={setCaseListPage}
      listTitle={searchListTitle}
      folderPath={searchFolderPath}
      selectedCaseFilePath={selectedCaseFilePath}
      onSelectCase={handleSelectCase}
      pickerMode
      selectedFilePaths={selectedFilePaths}
      onToggleCase={handleToggleCase}
      emptyMessage={
        activeSearchChips?.length ? "No matching cases found." : "Apply a filter to see results."
      }
    />
  ) : (
    <RepositoryPaginatedCaseList
      cases={browseCaseItems}
      page={caseListPage}
      onPageChange={setCaseListPage}
      folderPath={selectedFolderPath}
      listTitle={folderLabel}
      loading={folderLoading}
      showNoFolderWhenEmpty
      emptyMessage="No cases in this folder"
      selectedCaseFilePath={selectedCaseFilePath}
      onSelectCase={handleSelectCase}
      pickerMode
      selectedFilePaths={selectedFilePaths}
      onToggleCase={handleToggleCase}
    />
  );

  const detailColumn = (
    <CaseReadOnlyDetailPanel
      selectedCaseFilePath={selectedCaseFilePath}
      caseDetail={caseDetail}
      caseDetailLoading={detailLoading}
      reviewEnabled={reviewEnabled}
      repoSlug={activeRepoSlug}
    />
  );

  return (
    <>
      <OperationInProgressOverlay open={exporting} title={LONG_OPERATION_TITLE_EXPORT_CASES} />
      <TestRepositoryThreeColumnLayout
        storageKeys={PICKER_STORAGE_KEYS}
        treeColumn={
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
              <SidebarSection
                title="Export cases"
                titleRight={sidebarTitleRight}
                toolbar={projectToolbar}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{treeColumnBody}</div>
            {sidebarFooter != null ? (
              <div
                data-sidebar-footer
                className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700"
              >
                {sidebarFooter}
              </div>
            ) : null}
          </div>
        }
        caseListColumn={caseListColumn}
        detailColumn={detailColumn}
      />
    </>
  );
}

export default ExportCasesPage;
