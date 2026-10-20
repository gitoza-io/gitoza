import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, FileDown, FileUp } from "lucide-react";
import {
  collectPathKeyForFolderPath,
  findFolderNode,
  getParentDirectoryPath,
  isProjectDirectoryPath,
} from "../utils/caseTree";
import { isArchivedDirectoryPath } from "../constants/casePaths";
import CaseEditorPanel from "../components/CaseEditorPanel";
import ProjectOverviewPanel from "../components/ProjectOverviewPanel";
import CsvImportPanel from "../components/CsvImportPanel";
import TitleBarAddButton from "../components/TitleBarAddButton";
import TreeToolbar from "../components/TreeToolbar";
import TreeQuerySearchBar from "../components/TreeQuerySearchBar";
import HiddenViewBanner from "../components/HiddenViewBanner";
import SearchToggleButton from "../components/SearchToggleButton";
import Tooltip from "../components/Tooltip";
import SidebarSection from "../components/SidebarSection";
import TestRepositoryThreeColumnLayout from "../components/TestRepositoryThreeColumnLayout";
import RepositoryFolderTree from "../components/RepositoryFolderTree";
import RepositoryVirtualCaseList from "../components/RepositoryVirtualCaseList";
import { TreeAreaHoverProvider } from "../contexts/TreeAreaHoverContext";
import { caseSearchKeys } from "../constants/searchKeys";
import { TOOLBAR_BTN_BASE, TOOLBAR_BTN_SELECTED } from "../constants/toolbarStyles";
import { useCaseListWindow } from "../hooks/useCaseListWindow";
import { useCasePointerDrag } from "../hooks/useCasePointerDrag";
import { useSearchFolderTree } from "../hooks/useSearchFolderTree";
import { usePinnedProjects } from "../hooks/usePinnedProjects";
import { commitInlineCaseCreate } from "../utils/inlineCaseCommit";
import { withParamSearchKeys } from "../utils/querySearch";
import { remapExpandKeys, remapPathUnderPrefix } from "../utils/patchRepositoryTree";
import {
  effectiveSearchFolderPath,
  filterRowsUnderPathPrefix,
  filterTreeToOpenedRoot,
} from "../utils/openFocusTreeFilter";

const LAST_FOLDER_STORAGE_KEY = "testRepo.twoPane.lastFolder";

function findFolderDisplayName(tree, directoryPath) {
  if (!directoryPath) return null;
  const found = findFolderNode(tree, directoryPath);
  if (!found) return directoryPath.split("/").pop() || directoryPath;
  const name = found.display_name ?? found.name ?? "";
  return found.is_project ? name.replace(/\.gitoza\.test$/i, "") : name;
}

function TestRepository({
  tree = [],
  projectsReady = false,
  treeStructureLoadingPrefixes = null,
  filteredRows = [],
  archivedViewOpen = false,
  onOpenArchivedView,
  onCloseArchivedView,
  dashboardSummary,
  selectedCaseFilePath,
  selectedFolderPath = null,
  onSelectBrowseFolder,
  caseDetail,
  caseDetailLoading = false,
  isEditingCase,
  onSelectCase,
  onClearSelection,
  onToggleEdit,
  onSaveCase,
  onPostCaseComment,
  onDeleteCaseComment,
  onArchiveCase,
  onArchiveFolder,
  onRestoreFolder,
  onRestoreCase,
  onDeleteCase,
  showCreateFormInPanel,
  onStartCreate,
  onCancelCreate,
  onCreateCase,
  onImportBatch,
  onCommitInlineCase,
  effectiveProjectDir,
  contextTargetFolder,
  onContextCreateTestCase,
  onRenameFolder,
  onCreateFolder,
  onDeleteFolder,
  onDeleteProject,
  editorLocked = false,
  onOpenCreateProject,
  creatingProject = false,
  onCommitInlineProject,
  sidebarFooter,
  sidebarTitleRight,
  activeRepoSlug,
  onSearchCases,
  activeSearchChips,
  onImportComplete,
  onOpenExportCases,
  caseFilesDirty = false,
  csvImportDirectory,
  onCsvImportSelectProject,
  onCsvImportClosed,
  onMoveCasesToFolder,
  reviewEnabled = true,
  storageSyncConfigured = false,
  onOpenStorageSyncSettings,
  gitProfileVersion = 0,
  allUsernames = null,
  filterOptions = {},
  onFolderExpand,
  loadingPrefixes,
  loadedPrefixes = null,
  folderRenameRemap = null,
  onFolderRenameRemapConsumed,
  priorityFilter = "all",
  onRegisterCaseListWindow,
  onNavigateToTicket = null,
  onNavigateToWiki = null,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [openedProjectPath, setOpenedProjectPath] = useState(null);
  const [importModeOpen, setImportModeOpen] = useState(false);
  const [selectedCasePaths, setSelectedCasePaths] = useState(() => new Set());
  const [creatingCaseInPath, setCreatingCaseInPath] = useState(null);
  const [creatingCaseError, setCreatingCaseError] = useState(null);
  const didInitialFolderRef = useRef(false);
  const prevArchivedViewOpenRef = useRef(archivedViewOpen);
  const { pinnedProjectPaths, isPinned, togglePin } = usePinnedProjects(activeRepoSlug, tree);

  useEffect(() => {
    if (!selectedCaseFilePath) setSelectedCasePaths(new Set());
  }, [selectedCaseFilePath]);

  useEffect(() => {
    if (!folderRenameRemap?.oldPathKey || !folderRenameRemap?.newPathKey) return;
    const { oldPath, newPath, oldPathKey, newPathKey } = folderRenameRemap;
    setExpanded((prev) => remapExpandKeys(prev, oldPathKey, newPathKey));
    try {
      const stored = localStorage.getItem(LAST_FOLDER_STORAGE_KEY);
      if (stored) {
        const remapped = remapPathUnderPrefix(stored, oldPath, newPath);
        if (remapped !== stored) {
          localStorage.setItem(LAST_FOLDER_STORAGE_KEY, remapped);
        }
      }
    } catch (_) {}
    onFolderRenameRemapConsumed?.();
  }, [folderRenameRemap, onFolderRenameRemapConsumed]);

  const searchActive = Boolean(activeSearchChips?.length);
  const searchResetKey = useMemo(
    () =>
      (activeSearchChips ?? [])
        .map((c) => `${c.key}:${c.value ?? ""}`)
        .join("|"),
    [activeSearchChips],
  );

  const searchRowsForTree = useMemo(
    () => filterRowsUnderPathPrefix(filteredRows, openedProjectPath),
    [filteredRows, openedProjectPath],
  );

  const {
    searchTree,
    searchFolderPath,
    searchExpanded,
    setSearchExpanded,
    setSearchFolderPath,
    handleSelectSearchFolder,
  } = useSearchFolderTree({
    apiTree: tree,
    rows: searchRowsForTree,
    searchActive,
    searchResetKey,
  });

  const scopedSearchFolderPath = useMemo(
    () => effectiveSearchFolderPath(searchFolderPath, openedProjectPath),
    [searchFolderPath, openedProjectPath],
  );

  const listFolderPath = searchOpen ? scopedSearchFolderPath : selectedFolderPath;
  const listWindowEnabled = useMemo(() => {
    if (importModeOpen) return false;
    if (archivedViewOpen) return Boolean(selectedFolderPath);
    if (searchOpen) return searchActive;
    return Boolean(selectedFolderPath);
  }, [
    importModeOpen,
    archivedViewOpen,
    searchOpen,
    searchActive,
    selectedFolderPath,
  ]);

  const caseListWindow = useCaseListWindow({
    repoSlug: activeRepoSlug,
    folderPath: listFolderPath,
    searchChips: searchOpen && searchActive ? activeSearchChips : [],
    priorityFilter,
    archiveMode: archivedViewOpen,
    enabled: listWindowEnabled,
  });

  useEffect(() => {
    onRegisterCaseListWindow?.({
      invalidate: caseListWindow.invalidate,
      invalidateAll: caseListWindow.invalidateAll,
      patchLocal: caseListWindow.patchLocal,
      patchLocalForFolder: caseListWindow.patchLocalForFolder,
      sortLocal: caseListWindow.sortLocal,
      snapshotRows: caseListWindow.snapshotRows,
    });
    return () => onRegisterCaseListWindow?.(null);
  }, [
    caseListWindow.invalidate,
    caseListWindow.invalidateAll,
    caseListWindow.patchLocal,
    caseListWindow.patchLocalForFolder,
    caseListWindow.sortLocal,
    caseListWindow.snapshotRows,
    onRegisterCaseListWindow,
  ]);

  const listCasePathsInOrder = useMemo(
    () => caseListWindow.items.map((c) => c.file_path).filter(Boolean),
    [caseListWindow.items],
  );

  const visibleSearchTree = useMemo(
    () => filterTreeToOpenedRoot(searchTree, openedProjectPath),
    [searchTree, openedProjectPath],
  );

  const searchListTitle = useMemo(() => {
    if (!searchActive) return "Search results";
    if (scopedSearchFolderPath) {
      return findFolderDisplayName(searchTree, scopedSearchFolderPath);
    }
    return "Search results";
  }, [searchActive, scopedSearchFolderPath, searchTree]);

  const handleSelectBrowseFolder = useCallback(
    (path) => {
      if (!path) return;
      onSelectBrowseFolder?.(path);
      try {
        localStorage.setItem(LAST_FOLDER_STORAGE_KEY, path);
      } catch (_) {}
      onFolderExpand?.(path);
    },
    [onSelectBrowseFolder, onFolderExpand],
  );

  const visibleTree = useMemo(
    () => filterTreeToOpenedRoot(tree, openedProjectPath),
    [tree, openedProjectPath],
  );

  const handleOpenProject = useCallback(
    (folderPath) => {
      if (!folderPath) return;
      const found = findFolderNode(tree, folderPath);
      if (!found || found.is_project !== true) return;
      setOpenedProjectPath(folderPath);
      handleSelectBrowseFolder(folderPath);
      const pathKey = collectPathKeyForFolderPath(tree, folderPath) || found.name;
      if (pathKey) {
        setExpanded((prev) => new Set([...prev, pathKey]));
      }
      if (searchOpen) {
        setSearchFolderPath(folderPath);
      }
    },
    [tree, handleSelectBrowseFolder, searchOpen, setSearchFolderPath],
  );

  const handleCloseOpenedProject = useCallback(() => {
    const pathKey = openedProjectPath
      ? collectPathKeyForFolderPath(tree, openedProjectPath)
      : null;
    setOpenedProjectPath(null);
    if (pathKey) {
      setExpanded((prev) => {
        if (!prev.has(pathKey)) return prev;
        const next = new Set(prev);
        next.delete(pathKey);
        return next;
      });
    }
    if (searchOpen) {
      setSearchFolderPath(null);
    }
  }, [openedProjectPath, tree, searchOpen, setSearchFolderPath]);

  useEffect(() => {
    if (!openedProjectPath || !(tree || []).length) return;
    if (!(tree || []).some((n) => n.directory_path === openedProjectPath)) {
      setOpenedProjectPath(null);
    }
  }, [openedProjectPath, tree]);

  useEffect(() => {
    setOpenedProjectPath(null);
  }, [archivedViewOpen]);

  const searchSidebarTree = useMemo(() => {
    if (!searchActive) return null;
    if (visibleSearchTree.length > 0) {
      return (
        <RepositoryFolderTree
          tree={visibleSearchTree}
          selectedFolderPath={scopedSearchFolderPath}
          onSelectFolder={handleSelectSearchFolder}
          expanded={searchExpanded}
          onExpandedChange={setSearchExpanded}
          badgeSourceRows={searchRowsForTree}
          loadedPrefixes={loadedPrefixes}
          onOpenProject={handleOpenProject}
          openedProjectPath={openedProjectPath}
          onCloseOpenedProject={handleCloseOpenedProject}
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
    visibleSearchTree,
    scopedSearchFolderPath,
    handleSelectSearchFolder,
    searchExpanded,
    setSearchExpanded,
    searchRowsForTree,
    loadedPrefixes,
    handleOpenProject,
    openedProjectPath,
    handleCloseOpenedProject,
  ]);
  const handleMoveCasesToFolderAndClear = useCallback(
    async (paths, target) => {
      if (!onMoveCasesToFolder) return;
      const previousFolder = selectedFolderPath;

      handleSelectBrowseFolder(target);
      setSelectedCasePaths(new Set());
      onClearSelection?.();

      try {
        await onMoveCasesToFolder(paths, target);
      } catch {
        if (previousFolder && previousFolder !== target) {
          handleSelectBrowseFolder(previousFolder);
        }
      }
    },
    [onMoveCasesToFolder, onClearSelection, handleSelectBrowseFolder, selectedFolderPath],
  );

  const browseSelectionConfig = useMemo(() => {
    if (editorLocked) return null;
    const base = {
      selectedPaths: selectedCasePaths,
      onChange: setSelectedCasePaths,
      orderedPaths: listCasePathsInOrder,
    };
    if (onMoveCasesToFolder) {
      return { ...base, onMoveCasesToFolder: handleMoveCasesToFolderAndClear };
    }
    return base;
  }, [
    editorLocked,
    selectedCasePaths,
    listCasePathsInOrder,
    onMoveCasesToFolder,
    handleMoveCasesToFolderAndClear,
  ]);

  const searchSelectionConfig = useMemo(() => {
    if (editorLocked) return null;
    return {
      selectedPaths: selectedCasePaths,
      onChange: setSelectedCasePaths,
      orderedPaths: listCasePathsInOrder,
    };
  }, [editorLocked, selectedCasePaths, listCasePathsInOrder]);

  const archiveSelectionConfig = useMemo(() => {
    if (editorLocked) return null;
    return {
      selectedPaths: selectedCasePaths,
      onChange: setSelectedCasePaths,
      orderedPaths: listCasePathsInOrder,
    };
  }, [editorLocked, selectedCasePaths, listCasePathsInOrder]);

  const multiSelectActive = Boolean(browseSelectionConfig?.onMoveCasesToFolder) && !archivedViewOpen;
  const browseDrag = useCasePointerDrag({
    multiSelectActive,
    caseSelectionConfig: browseSelectionConfig,
  });

  useEffect(() => {
    didInitialFolderRef.current = false;
  }, [archivedViewOpen]);

  useEffect(() => {
    if (prevArchivedViewOpenRef.current === archivedViewOpen) return;
    prevArchivedViewOpenRef.current = archivedViewOpen;
    caseListWindow.invalidateAll();
  }, [archivedViewOpen, caseListWindow.invalidateAll]);

  useEffect(() => {
    if (!archivedViewOpen || !selectedFolderPath) return;
    if (!isArchivedDirectoryPath(selectedFolderPath)) {
      onSelectBrowseFolder?.(null);
    }
  }, [archivedViewOpen, selectedFolderPath, onSelectBrowseFolder]);

  useEffect(() => {
    if (didInitialFolderRef.current || searchOpen) return;
    if (archivedViewOpen) return;
    if (selectedFolderPath) {
      didInitialFolderRef.current = true;
      return;
    }
    if (!tree?.length) return;

    let initialPath = null;
    if (selectedCaseFilePath) {
      initialPath = getParentDirectoryPath(selectedCaseFilePath);
    } else {
      try {
        const last = localStorage.getItem(LAST_FOLDER_STORAGE_KEY);
        if (last && findFolderNode(tree, last)) initialPath = last;
      } catch (_) {}
      if (!initialPath) {
        initialPath = tree[0]?.directory_path ?? null;
      }
    }
    if (initialPath) {
      handleSelectBrowseFolder(initialPath);
    }
    didInitialFolderRef.current = true;
  }, [
    tree,
    searchOpen,
    archivedViewOpen,
    selectedCaseFilePath,
    selectedFolderPath,
    handleSelectBrowseFolder,
  ]);

  const handleSearch = useCallback(
    (chips) => {
      onSearchCases?.(chips || []);
    },
    [onSearchCases],
  );

  const handleCloseSearch = useCallback(() => {
    onSearchCases?.([]);
    setSearchOpen(false);
  }, [onSearchCases]);

  const handleSearchClick = useCallback(() => {
    if (searchOpen) {
      handleCloseSearch();
    } else {
      onCloseArchivedView?.();
      setSearchOpen(true);
    }
  }, [searchOpen, handleCloseSearch, onCloseArchivedView]);

  const searchButton = (
    <SearchToggleButton
      isOpen={searchOpen}
      hasActiveChips={!!activeSearchChips?.length}
      onClick={handleSearchClick}
      ariaLabelWhenClosed="Filter cases"
    />
  );

  const handleArchivedClick = useCallback(() => {
    if (archivedViewOpen) {
      onCloseArchivedView?.();
    } else {
      handleCloseSearch();
      onOpenArchivedView?.();
    }
  }, [archivedViewOpen, onOpenArchivedView, onCloseArchivedView, handleCloseSearch]);

  const archivedButton = (
    <Tooltip label={archivedViewOpen ? "Back to tree" : "Archived cases"} placement="bottom">
      <button
        type="button"
        onClick={handleArchivedClick}
        className={`${TOOLBAR_BTN_BASE} ${archivedViewOpen ? TOOLBAR_BTN_SELECTED : ""}`}
        aria-label={archivedViewOpen ? "Back to tree" : "Archived cases"}
      >
        {archivedViewOpen ? (
          <ArrowLeft className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
      </button>
    </Tooltip>
  );

  const handleAddProjectClick = useCallback(() => {
    onCloseArchivedView?.();
    onOpenCreateProject?.();
  }, [onCloseArchivedView, onOpenCreateProject]);

  const handleImportClick = useCallback(() => {
    onCloseArchivedView?.();
    if (searchOpen) handleCloseSearch();
    onCancelCreate?.();
    onClearSelection?.();
    setImportModeOpen(true);
  }, [onCloseArchivedView, searchOpen, handleCloseSearch, onCancelCreate, onClearSelection]);

  const handleImportComplete = useCallback(
    (createdCount) => {
      if (createdCount > 0) {
        onCsvImportClosed?.();
        onImportComplete?.();
        setImportModeOpen(false);
      }
    },
    [onImportComplete, onCsvImportClosed],
  );

  const handleCloseImport = useCallback(() => {
    onCsvImportClosed?.();
    setImportModeOpen(false);
  }, [onCsvImportClosed]);

  const handleSelectCaseWithImportExit = useCallback(
    (row) => {
      if (importModeOpen) handleCloseImport();
      onSelectCase?.(row);
    },
    [importModeOpen, handleCloseImport, onSelectCase],
  );

  const handleExportClick = useCallback(() => {
    if (caseFilesDirty) return;
    onCloseArchivedView?.();
    if (searchOpen) handleCloseSearch();
    onCancelCreate?.();
    onClearSelection?.();
    onOpenExportCases?.();
  }, [
    caseFilesDirty,
    onCloseArchivedView,
    searchOpen,
    handleCloseSearch,
    onCancelCreate,
    onClearSelection,
    onOpenExportCases,
  ]);

  const handleStartCreatingCase = useCallback(
    (path) => {
      if (!path || !onCommitInlineCase) return;
      setCreatingCaseInPath(null);
      setCreatingCaseError(null);
      handleSelectBrowseFolder(path);
      const isProject = isProjectDirectoryPath(path);
      void commitInlineCaseCreate({
        path,
        isProject,
        caseId: "",
        onCommitInlineCase,
        clearCreating: () => setCreatingCaseInPath(null),
        restoreCreating: () => {},
        setError: setCreatingCaseError,
        clearError: () => setCreatingCaseError(null),
      })?.catch?.(() => {});
    },
    [handleSelectBrowseFolder, onCommitInlineCase],
  );

  const handleCommitInlineCase = useCallback(
    (path, isProject, caseId) =>
      commitInlineCaseCreate({
        path,
        isProject,
        caseId: caseId ?? "",
        onCommitInlineCase,
        clearCreating: () => setCreatingCaseInPath(null),
        restoreCreating: () => {},
        setError: setCreatingCaseError,
        clearError: () => setCreatingCaseError(null),
      }),
    [onCommitInlineCase],
  );

  const importButton = !editorLocked ? (
    <Tooltip label="Import test cases (CSV)" placement="bottom">
      <button
        type="button"
        onClick={handleImportClick}
        className={TOOLBAR_BTN_BASE}
        aria-label="Import test cases (CSV)"
      >
        <FileUp className="h-4 w-4" />
      </button>
    </Tooltip>
  ) : null;

  const exportTooltipLabel = caseFilesDirty
    ? "Save case changes first"
    : "Export test cases (CSV or PDF)";
  const exportButton = onOpenExportCases ? (
    <Tooltip label={exportTooltipLabel} placement="bottom">
      <button
        type="button"
        onClick={handleExportClick}
        disabled={caseFilesDirty}
        className={TOOLBAR_BTN_BASE}
        aria-label="Export test cases"
        title={caseFilesDirty ? "Save case changes first" : undefined}
      >
        <FileDown className="h-4 w-4" />
      </button>
    </Tooltip>
  ) : null;

  const projectToolbar = (
    <TreeToolbar
      addButton={
        onOpenCreateProject && !editorLocked ? (
          <TitleBarAddButton
            tooltip="Create project"
            onClick={handleAddProjectClick}
            ariaLabel="Create project"
          />
        ) : null
      }
      sortButton={null}
      searchNode={searchButton}
      extraActions={
        <>
          {importButton}
          {exportButton}
          {archivedButton}
        </>
      }
      onBeforeAction={searchOpen ? handleCloseSearch : undefined}
    />
  );

  const folderLabel = findFolderDisplayName(tree, selectedFolderPath);
  const activeListTitle = searchOpen
    ? searchListTitle
    : archivedViewOpen
      ? (folderLabel ?? "Archived cases")
      : folderLabel;
  const activeListFolderPath = searchOpen ? scopedSearchFolderPath : selectedFolderPath;

  const sharedVirtualListProps = {
    cases: caseListWindow.items,
    total: caseListWindow.total,
    loading: caseListWindow.loading,
    loadingMore: caseListWindow.loadingMore,
    hasMore: caseListWindow.hasMore,
    onLoadMore: caseListWindow.loadMore,
    folderPath: activeListFolderPath,
    listTitle: activeListTitle,
    selectedCaseFilePath,
    onSelectCase: handleSelectCaseWithImportExit,
    editorLocked,
  };

  const effectiveCaseSearchKeys = useMemo(
    () => withParamSearchKeys(caseSearchKeys(reviewEnabled), filterOptions),
    [reviewEnabled, filterOptions],
  );

  const treeColumnBody = searchOpen ? (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <TreeQuerySearchBar
        searchKeys={effectiveCaseSearchKeys}
        filterOptions={filterOptions}
        chips={activeSearchChips || []}
        onChipsChange={handleSearch}
        placeholder="priority: high · tag: smoke · free text"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">{searchSidebarTree}</div>
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {archivedViewOpen ? (
        <HiddenViewBanner
          label="Archived"
          tooltip="Only archived cases are shown. Click the toolbar button to go back to the main tree."
        />
      ) : null}
      <RepositoryFolderTree
        tree={visibleTree}
        projectsReady={projectsReady}
        treeStructureLoadingPrefixes={treeStructureLoadingPrefixes}
        selectedFolderPath={selectedFolderPath}
        onSelectFolder={handleSelectBrowseFolder}
        expanded={expanded}
        onExpandedChange={setExpanded}
        onContextCreateTestCase={
          editorLocked || archivedViewOpen ? undefined : onContextCreateTestCase
        }
        onCommitInlineCase={
          editorLocked || archivedViewOpen ? undefined : handleCommitInlineCase
        }
        onStartCreatingCase={
          editorLocked || archivedViewOpen ? undefined : handleStartCreatingCase
        }
        onRenameFolder={editorLocked || archivedViewOpen ? undefined : onRenameFolder}
        onCreateFolder={editorLocked || archivedViewOpen ? undefined : onCreateFolder}
        onArchiveFolder={editorLocked || archivedViewOpen ? undefined : onArchiveFolder}
        onRestoreFolder={editorLocked || !archivedViewOpen ? undefined : onRestoreFolder}
        onDeleteFolder={editorLocked || !archivedViewOpen ? undefined : onDeleteFolder}
        onDeleteProject={editorLocked || !archivedViewOpen ? undefined : onDeleteProject}
        editorLocked={editorLocked}
        archivedView={archivedViewOpen}
        creatingProject={archivedViewOpen || openedProjectPath ? false : creatingProject}
        onCommitInlineProject={
          editorLocked || archivedViewOpen ? undefined : onCommitInlineProject
        }
        onFolderExpand={onFolderExpand}
        loadingPrefixes={loadingPrefixes}
        dragOverFolderPath={browseDrag.dragOverFolderPath}
        draggingSourcePaths={browseDrag.draggingSourcePaths}
        pinningEnabled={!openedProjectPath}
        pinnedProjectPaths={openedProjectPath ? null : pinnedProjectPaths}
        onTogglePinProject={openedProjectPath ? null : togglePin}
        isPinnedProject={openedProjectPath ? null : isPinned}
        onOpenProject={handleOpenProject}
        openedProjectPath={openedProjectPath}
        onCloseOpenedProject={handleCloseOpenedProject}
      />
    </div>
  );

  const caseListColumn = archivedViewOpen ? (
    <RepositoryVirtualCaseList
      {...sharedVirtualListProps}
      showNoFolderWhenEmpty
      emptyMessage={selectedFolderPath ? "No archived cases in this folder" : "Select a folder"}
      archivedView
      caseSelectionConfig={archiveSelectionConfig}
      onRestoreCase={onRestoreCase}
      onDeleteCase={onDeleteCase}
    />
  ) : searchOpen ? (
    <RepositoryVirtualCaseList
      {...sharedVirtualListProps}
      caseSelectionConfig={searchSelectionConfig}
      onArchiveCase={onArchiveCase}
      onRestoreCase={onRestoreCase}
      onDeleteCase={onDeleteCase}
      emptyMessage={
        activeSearchChips?.length ? "No matching cases found." : "Apply a filter to see results."
      }
    />
  ) : (
    <RepositoryVirtualCaseList
      {...sharedVirtualListProps}
      showNoFolderWhenEmpty
      emptyMessage="No cases in this folder"
      caseSelectionConfig={browseSelectionConfig}
      onArchiveCase={editorLocked ? undefined : onArchiveCase}
      onRestoreCase={editorLocked ? undefined : onRestoreCase}
      creatingCaseError={creatingCaseError}
      onNewCase={
        editorLocked || !selectedFolderPath
          ? undefined
          : () => handleStartCreatingCase(selectedFolderPath)
      }
      dragProps={{
        pointerDragUI: browseDrag.pointerDragUI,
        draggingSourcePaths: browseDrag.draggingSourcePaths,
        handleCaseRowPointerDown: browseDrag.handleCaseRowPointerDown,
      }}
    />
  );

  const selectedProjectNode = useMemo(() => {
    if (!selectedFolderPath) return null;
    const node = findFolderNode(tree, selectedFolderPath);
    return node?.is_project === true ? node : null;
  }, [tree, selectedFolderPath]);

  const selectedProjectSummary = useMemo(() => {
    const projects = dashboardSummary?.projects ?? [];
    if (!selectedFolderPath) return null;
    return (
      projects.find((p) => p.project_path === selectedFolderPath) ??
      projects.find((p) => p.project_path === effectiveProjectDir) ??
      null
    );
  }, [dashboardSummary, selectedFolderPath, effectiveProjectDir]);

  const caseEditorPanel = (
    <CaseEditorPanel
      caseDetail={caseDetail}
      selectedCaseFilePath={selectedCaseFilePath}
      caseDetailLoading={caseDetailLoading}
      isEditing={isEditingCase}
      onToggleEdit={onToggleEdit}
      onClearSelection={onClearSelection}
      onSave={onSaveCase}
      onPostCaseComment={onPostCaseComment}
      onDeleteCaseComment={onDeleteCaseComment}
      onArchive={onArchiveCase}
      showCreateForm={showCreateFormInPanel}
      onStartCreate={onStartCreate}
      onCancelCreate={onCancelCreate}
      onCreate={onCreateCase}
      directory={effectiveProjectDir}
      targetFolder={contextTargetFolder}
      editorLocked={editorLocked}
      reviewEnabled={reviewEnabled}
      allTags={filterOptions?.tags}
      paramKeys={filterOptions?.param_keys}
      paramValuesByKey={filterOptions?.param_values_by_key}
      allUsernames={allUsernames}
      repoSlug={activeRepoSlug}
      storageSyncConfigured={storageSyncConfigured}
      onOpenStorageSyncSettings={onOpenStorageSyncSettings}
      gitProfileVersion={gitProfileVersion}
      onOpenTicket={onNavigateToTicket}
      onOpenWikiPage={onNavigateToWiki}
    />
  );

  const detailColumn = importModeOpen ? (
    <CsvImportPanel
      directory={csvImportDirectory}
      targetFolder={contextTargetFolder}
      repoSlug={activeRepoSlug}
      projects={dashboardSummary?.projects ?? []}
      onSelectProject={onCsvImportSelectProject}
      onImportBatch={onImportBatch}
      onCancel={handleCloseImport}
      onImportComplete={handleImportComplete}
    />
  ) : caseDetail || selectedCaseFilePath || showCreateFormInPanel ? (
    caseEditorPanel
  ) : selectedProjectNode ? (
    <ProjectOverviewPanel
      projectPath={selectedFolderPath}
      projectName={
        findFolderDisplayName(tree, selectedFolderPath) ||
        selectedProjectSummary?.project_name ||
        selectedFolderPath
      }
      suiteCount={selectedProjectSummary?.suite_count ?? 0}
      automatedCount={selectedProjectSummary?.automated_count ?? 0}
      totalTestCases={selectedProjectSummary?.total_test_cases ?? 0}
      activeRepoSlug={activeRepoSlug}
    />
  ) : (
    caseEditorPanel
  );

  return (
    <TestRepositoryThreeColumnLayout
      treeColumn={
        <TreeAreaHoverProvider>
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
              <SidebarSection
                title="Test Repository"
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
        </TreeAreaHoverProvider>
      }
      caseListColumn={caseListColumn}
      detailColumn={detailColumn}
    />
  );
}

export default TestRepository;
