import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import CaseReadOnlyDetailPanel from "../components/CaseReadOnlyDetailPanel";
import RepositoryFolderTree from "../components/RepositoryFolderTree";
import RepositoryPaginatedCaseList from "../components/RepositoryPaginatedCaseList";
import SearchPanel from "../components/SearchPanel";
import SearchToggleButton from "../components/SearchToggleButton";
import SidebarSection from "../components/SidebarSection";
import TestRepositoryThreeColumnLayout from "../components/TestRepositoryThreeColumnLayout";
import TreeToolbar from "../components/TreeToolbar";
import { useRefetchWhenActive } from "../components/PersistentView";
import { caseSearchKeys } from "../constants/searchKeys";
import { usePickerBrowseState } from "../hooks/usePickerBrowseState";
import { useSearchFolderTree } from "../hooks/useSearchFolderTree";
import { useSearchPrefs } from "../hooks/useSearchPrefs";
import {
  normalizeCaseFilePath,
  toggleProjectSelection,
  toggleSuiteSelection,
} from "../utils/casePickerSelection";
import {
  buildCaseTree,
  findFolderDisplayName,
  getCasesForFolderSelection,
  mapRowsToCaseListItems,
  pruneEmptyNodes,
} from "../utils/caseTree";
import { fetchAllRunCasePaths } from "../services/api";

const PICKER_STORAGE_KEYS = {
  treeWidth: "casePicker.col.treeWidth",
  listWidth: "casePicker.col.listWidth",
};

/**
 * Full-page "Add test cases to run": three-column picker (folder tree | case list | detail).
 * Only cases not already in the run are shown.
 */
function AddCasesToRunPage({
  runId,
  runName,
  tree = [],
  filteredRows = [],
  filterOptions = {},
  getRun,
  getCaseDetail,
  activeRepoSlug,
  onSearchCases,
  activeSearchChips,
  onDone,
  onCancel,
  sidebarFooter,
  sidebarTitleRight,
  readOnly = false,
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(true);
  const [existingCasePathsInRun, setExistingCasePathsInRun] = useState(() => new Set());
  const caseDetailFetchIdRef = useRef(0);

  const { history, favorites, pushHistory, toggleFavorite, isFavorite } =
    useSearchPrefs("add_cases_to_run");

  const loadPickerData = useCallback(async () => {
    if (!runId || !activeRepoSlug) {
      setExistingCasePathsInRun(new Set());
      setPickerLoading(false);
      return;
    }
    setPickerLoading(true);
    try {
      const casePaths = await fetchAllRunCasePaths(runId, activeRepoSlug);
      const paths = new Set(
        casePaths
          .map((p) => normalizeCaseFilePath(p))
          .filter(Boolean),
      );
      setExistingCasePathsInRun(paths);

      if (loadAllProjectPrefixes) {
        const projectPaths = (tree || [])
          .map((node) => node.directory_path)
          .filter(Boolean);
        const run = () => {
          void loadAllProjectPrefixes(projectPaths);
        };
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(run);
        } else {
          setTimeout(run, 0);
        }
      }
    } catch {
      setExistingCasePathsInRun(new Set());
    } finally {
      setPickerLoading(false);
    }
  }, [runId, activeRepoSlug, tree, loadAllProjectPrefixes]);

  useRefetchWhenActive(loadPickerData);

  useEffect(() => {
    setSelectedFilePaths((prev) => {
      const next = new Set(
        [...prev].filter((p) => !existingCasePathsInRun.has(normalizeCaseFilePath(p))),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [existingCasePathsInRun]);

  const filterPath = useCallback(
    (p) => !existingCasePathsInRun.has(normalizeCaseFilePath(p)),
    [existingCasePathsInRun],
  );

  const rowsToShow = useMemo(
    () =>
      filteredRows.filter(
        (r) =>
          r.file_path &&
          !existingCasePathsInRun.has(normalizeCaseFilePath(r.file_path)),
      ),
    [filteredRows, existingCasePathsInRun],
  );

  const pickerTree = useMemo(() => {
    const tw = buildCaseTree(tree, rowsToShow);
    return pruneEmptyNodes(tw);
  }, [tree, rowsToShow]);

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

  const {
    selectedFolderPath,
    expanded,
    setExpanded,
    caseListPage,
    setCaseListPage,
    handleSelectBrowseFolder,
  } = usePickerBrowseState({
    tree: pickerTree,
    selectedCaseFilePath,
    searchOpen,
    searchActive: Boolean(activeSearchChips?.length),
    onFolderExpand,
    enabled: !pickerLoading,
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
    if (readOnly) return;
    setSelectedFilePaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, [readOnly]);

  const handleToggleSuite = useCallback(
    async (node) => {
      if (readOnly || !node?.directory_path || !loadCasesForPrefix) return;
      await toggleSuiteSelection({
        directoryPath: node.directory_path,
        rows: rowsToShow,
        setSelectedFilePaths,
        loadCasesForPrefix,
        filterPath,
      });
    },
    [readOnly, rowsToShow, loadCasesForPrefix, filterPath],
  );

  const handleToggleProject = useCallback(
    async (node) => {
      if (readOnly || !node?.directory_path || !loadCasesForPrefix) return;
      await toggleProjectSelection({
        directoryPath: node.directory_path,
        rows: rowsToShow,
        setSelectedFilePaths,
        loadCasesForPrefix,
        filterPath,
      });
    },
    [readOnly, rowsToShow, loadCasesForPrefix, filterPath],
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

  const handleDone = useCallback(() => {
    if (readOnly) return;
    const cases = rowsToShow
      .filter((r) => selectedFilePaths.has(r.file_path))
      .filter((r) => r.file_path)
      .map((r) => ({
        file_path: r.file_path,
        case_id: r.case_id,
        title: r.title,
      }));

    onDone(cases);
  }, [rowsToShow, selectedFilePaths, onDone, readOnly]);

  const browseCases = useMemo(
    () => getCasesForFolderSelection(rowsToShow, pickerTree, selectedFolderPath),
    [rowsToShow, pickerTree, selectedFolderPath],
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
          filterPath={filterPath}
          pickerDisabled={readOnly}
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
    filterPath,
    readOnly,
  ]);

  const folderLabel = findFolderDisplayName(pickerTree, selectedFolderPath);
  const folderLoading = Boolean(
    selectedFolderPath && loadingPrefixes?.has?.(selectedFolderPath),
  );

  const selectedCount = selectedFilePaths.size;

  const cancelDoneButtons = (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleDone}
        disabled={readOnly || selectedCount === 0}
        className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
      >
        Done ({selectedCount})
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
      trailingActions={cancelDoneButtons}
      onBeforeAction={searchOpen ? handleCloseSearch : undefined}
    />
  );

  const pickerLoadingContent = (
    <div className="flex items-center gap-2 px-2 py-4 text-sm text-slate-500 dark:text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
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
  ) : pickerLoading ? (
    pickerLoadingContent
  ) : (
    <RepositoryFolderTree
      tree={pickerTree}
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
      filterPath={filterPath}
      pickerDisabled={readOnly}
    />
  );

  const caseListColumn = pickerLoading ? (
    pickerLoadingContent
  ) : searchOpen ? (
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
      pickerDisabled={readOnly}
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
      pickerDisabled={readOnly}
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
    <TestRepositoryThreeColumnLayout
      storageKeys={PICKER_STORAGE_KEYS}
      treeColumn={
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
            <SidebarSection
              title={runName ? `Add cases — ${runName}` : "Add cases"}
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
  );
}

export default AddCasesToRunPage;
