import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileDown,
  Folder,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { fetchAllCases, runWithConcurrency } from "../utils/caseQuery";
import {
  addRunCases,
  archiveRun,
  createRun,
  deleteRun,
  duplicateRun,
  getDashboardSummary,
  getRepositoryTree,
  getRunCaseContent,
  listRuns,
  patchRun,
  patchRunCase,
  postRunComment,
  postRunCaseComment,
  deleteRunComment,
  deleteRunCaseComment,
  removeRunCases,
  restoreRun,
  setRunResultsBatch,
} from "../services/api";
import { fetchAllRunCasesForFolder } from "../utils/runCaseQuery";
import { useFetchedContent } from "../hooks/useFetchedContent";
import { useDebouncedAutoSave } from "../hooks/useDebouncedAutoSave";
import { DEBOUNCE_MS } from "../constants/autoSave";
import { relativeTime } from "../utils/relativeTime";
import {
  applyExecutedByToPaths,
  applyRunAssignedToPaths,
  mergeRunDetailFromServer,
  mergeRunResultsFromBatchResponse,
  mergeSearchCaseIntoRunDetail,
} from "../utils/mergeRunDetailFromServer";
import {
  hydrateSearchRunCaseSelection,
  resolveRunIdForCaseSelection,
} from "../utils/hydrateSearchRunCaseSelection";
import {
  patchFolderTreeForAdditions,
  patchFolderTreeForRemovals,
  patchFolderTreeForResultChange,
} from "../utils/patchRunFolderTreeStats";
import { withExecutionMeta } from "../utils/runCaseExecutionMeta";
import ContextMenu from "../components/ContextMenu";
import DetailPanel from "../components/DetailPanel";
import DetailPanelEmpty from "../components/DetailPanelEmpty";
import DetailPanelLoading from "../components/DetailPanelLoading";
import RunCaseDetailPanel from "../components/RunCaseDetailPanel";
import RunVirtualCaseList from "../components/RunVirtualCaseList";
import RunSummaryPanel from "../components/RunSummaryPanel";
import RepositoryFolderTree from "../components/RepositoryFolderTree";
import SidebarSection from "../components/SidebarSection";
import TestRepositoryThreeColumnLayout from "../components/TestRepositoryThreeColumnLayout";
import { useConfirm } from "../components/ConfirmProvider";
import { useRefetchWhenActive } from "../components/PersistentView";
import { subscribeRefresh } from "../services/wsRefresh";
import PageMessage from "../components/PageMessage";
import { SidebarLoading } from "../components/SidebarSection";
import { useSortedRuns } from "../hooks/useSortedRuns";
import TitleBarAddButton from "../components/TitleBarAddButton";
import TreeToolbar from "../components/TreeToolbar";
import SearchPanel from "../components/SearchPanel";
import HiddenViewBanner from "../components/HiddenViewBanner";
import SearchToggleButton from "../components/SearchToggleButton";
import Tooltip from "../components/Tooltip";
import { TOOLBAR_BTN_BASE, TOOLBAR_BTN_SELECTED } from "../constants/toolbarStyles";
import { RUN_STATUS_LABELS } from "../constants/runStatus";
import { runSearchKeys } from "../constants/searchKeys";
import { usePinnedProjects } from "../hooks/usePinnedProjects";
import { useSearchPrefs } from "../hooks/useSearchPrefs";
import { useRunBrowseState } from "../hooks/useRunBrowseState";
import { useLazyRunBrowse } from "../hooks/useLazyRunBrowse";
import { useRunCaseListWindow } from "../hooks/useRunCaseListWindow";
import { useRunCaseSearchResults } from "../hooks/useRunCaseSearchResults";
import { useRunSearchBrowseState } from "../hooks/useRunSearchBrowseState";
import {
  isProjectDirectoryPath,
  mergeFolderSubtreeIntoTree,
} from "../utils/caseTree";
import {
  buildUnifiedRunTree,
  buildUnifiedRunTreeFromSearchResults,
  findRunFolderDisplayName,
  folderPrefixFromTreePath,
  parseRunTreePath,
  runSummaryFromList,
  runTreePathForRunId,
} from "../utils/runCaseTree";
import {
  effectiveSearchFolderPath,
  filterRowsByRunId,
  filterTreeToOpenedRoot,
} from "../utils/openFocusTreeFilter";
import { sanitizeNameForPath } from "../utils/sanitize";
import { registerAutoSaveFlush } from "../utils/autoSaveFlushRegistry";

const RUN_STORAGE_KEYS = {
  treeWidth: "testRun.col.treeWidth",
  listWidth: "testRun.col.listWidth",
};

/** Sanitize run name for filename (must match backend). Used for duplicate-name check. */
function sanitizeRunName(name) {
  return sanitizeNameForPath(name, "run").slice(0, 80);
}

/** Filter repository tree to selected project paths (and their descendants). Returns new structure. */
function filterTreeByProjects(nodes, projectPaths) {
  if (!nodes?.length || !projectPaths?.length) return [];
  return nodes
    .filter((node) => {
      const path = node.directory_path ?? "";
      return projectPaths.some((p) => path === p || path.startsWith(p + "/"));
    })
    .map((node) => ({
      ...node,
      children: node.children?.length ? filterTreeByProjects(node.children, projectPaths) : node.children ?? [],
    }));
}

/** Derive directory (folder) from file path for run case tree. */
function directoryFromFilePath(filePath) {
  const p = (filePath || "").replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

function buildRunDetailAfterRemove(detail, paths) {
  if (!detail) return detail;
  const pathSet = new Set(paths);
  const nextCases = (detail.cases ?? []).filter((c) => !pathSet.has(c.file_path));
  return {
    ...detail,
    run: {
      ...detail.run,
      total_cases: Math.max(0, nextCases.length),
      passed: nextCases.filter((c) => c.result === "passed").length,
      failed: nextCases.filter((c) => c.result === "failed").length,
      skipped: nextCases.filter((c) => c.result === "skipped").length,
    },
    cases: nextCases,
  };
}

function TestRun({
  activeRepoSlug,
  filterOptions = {},
  runFilterOptions = {},
  runs = [],
  runsLoading = false,
  runsIncludeArchived = false,
  onRunsIncludeArchivedChange,
  onReloadRuns,
  onAfterRepoWrite,
  caseFilesDirty = false,
  runFilesDirty = false,
  initialRunId,
  onClearInitialRunId,
  onOpenAddCasesToRun,
  optimisticRunCasesAdded,
  onClearOptimisticRunCasesAdded,
  sidebarFooter,
  sidebarTitleRight,
  onOpenExportRuns,
  readOnly = false,
  reviewEnabled = true,
  gitProfileVersion = 0,
  allUsernames = null,
  onNavigateToTicket = null,
  onNavigateToRelease = null,
  onNavigateToWiki = null,
}) {
  const confirm = useConfirm();
  const [error, setError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  /** Run page: DB as single source of truth. Tree and detail from runDetailsByRunId (loaded via getRun from DB). */
  const [detailLoading, setDetailLoading] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [addCasesModalOpen, setAddCasesModalOpen] = useState(false);
  const [repoCases, setRepoCases] = useState([]);
  const [selectedCasePaths, setSelectedCasePaths] = useState(new Set());
  const [addCasesLoading, setAddCasesLoading] = useState(false);
  /** Selected case id in run (for right panel); cleared when leaving run or when case is removed. */
  const [selectedCaseIdInRun, setSelectedCaseIdInRun] = useState(null);
  /** Per-run modifier-key selection for bulk remove-from-run. */
  const [selectedRunCasePathsByRunId, setSelectedRunCasePathsByRunId] = useState({});
  const {
    runDetailsByRunId,
    setRunDetailsByRunId,
    runFolderTreeByRunId,
    savedRunResults,
    setSavedRunResults,
    headerLoadingRunId,
    ensureRunHeaderLoaded,
    loadRunHeader,
    loadRunCaseComments,
    loadRunProjectNodes,
    loadRunFolderSubtree,
    loadRunFolderTree,
    reloadRunFolderTree,
    invalidateRunCasesCache,
    mergeCasesIntoRunCache,
    patchRunFolderTree,
    restoreRunFolderTree,
  } = useLazyRunBrowse(activeRepoSlug);
  /** When set, add-cases modal is in "create new run" flow; single "Create run" button creates with or without selected cases. */
  const [pendingNewRun, setPendingNewRun] = useState(null);
  const [runSearchOpen, setRunSearchOpen] = useState(false);
  const [runSearchChips, setRunSearchChips] = useState([]);
  const [runSearchRefreshKey, setRunSearchRefreshKey] = useState(0);
  const [archivedViewOpen, setArchivedViewOpen] = useState(false);
  const [archivedRuns, setArchivedRuns] = useState([]);
  const { history: runHistory, favorites: runFavorites, pushHistory: pushRunHistory, toggleFavorite: toggleRunFav, isFavorite: isRunFav } =
    useSearchPrefs("run");

  useEffect(() => {
    if (readOnly) {
      setIsEditingRunSummary(false);
      setCreatingRun(false);
      setCreateModalOpen(false);
      setAddCasesModalOpen(false);
      setDuplicateModalRun(null);
      setRenamingRunId(null);
    }
  }, [readOnly]);

  /** Create flow: 1=name/desc, 2=projects, 3=tree+cases */
  const [createStep, setCreateStep] = useState(1);
  const [dashboardProjects, setDashboardProjects] = useState([]);
  const [selectedProjectPaths, setSelectedProjectPaths] = useState(new Set());
  const [repoTree, setRepoTree] = useState([]);
  const [createFolderPath, setCreateFolderPath] = useState(null);
  const [createTagFilter, setCreateTagFilter] = useState("");
  const [createCasesLoading, setCreateCasesLoading] = useState(false);
  const [createStepCases, setCreateStepCases] = useState([]);
  const [selectedCasesForCreate, setSelectedCasesForCreate] = useState([]);
  const [createTreeExpanded, setCreateTreeExpanded] = useState(new Set());
  const [createTreeStructureLoading, setCreateTreeStructureLoading] = useState(() => new Set());
  const loadedCreateTreePrefixesRef = useRef(new Set());
  const createPrefetchGenerationRef = useRef(0);
  const [contextMenuRun, setContextMenuRun] = useState(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [openedRunPath, setOpenedRunPath] = useState(null);
  const [duplicateModalRun, setDuplicateModalRun] = useState(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateDesc, setDuplicateDesc] = useState("");
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [renamingRunId, setRenamingRunId] = useState(null);
  const [isEditingRunSummary, setIsEditingRunSummary] = useState(false);

  const savedRunResultsRef = useRef({});
  savedRunResultsRef.current = savedRunResults;
  const runDetailsByRunIdRef = useRef(runDetailsByRunId);
  runDetailsByRunIdRef.current = runDetailsByRunId;
  const runCaseListWindowRef = useRef(null);
  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;
  const selectedCaseIdInRunRef = useRef(selectedCaseIdInRun);
  selectedCaseIdInRunRef.current = selectedCaseIdInRun;
  const runSearchOpenRef = useRef(runSearchOpen);
  runSearchOpenRef.current = runSearchOpen;
  const runSearchChipsRef = useRef(runSearchChips);
  runSearchChipsRef.current = runSearchChips;

  const onReloadRunsRef = useRef(onReloadRuns);
  onReloadRunsRef.current = onReloadRuns;
  const loadRunHeaderRef = useRef(loadRunHeader);
  loadRunHeaderRef.current = loadRunHeader;
  const invalidateRunCasesCacheRef = useRef(invalidateRunCasesCache);
  invalidateRunCasesCacheRef.current = invalidateRunCasesCache;
  const loadRunProjectNodesRef = useRef(loadRunProjectNodes);
  loadRunProjectNodesRef.current = loadRunProjectNodes;
  const loadRunCaseCommentsRef = useRef(loadRunCaseComments);
  loadRunCaseCommentsRef.current = loadRunCaseComments;
  /** Skip open-run invalidate after local result writes (those broadcast refresh). */
  const suppressOpenRunRefreshUntilRef = useRef(0);
  const noteLocalRunWrite = useCallback((ms = 2500) => {
    suppressOpenRunRefreshUntilRef.current = Date.now() + ms;
  }, []);

  /**
   * Stable identity — must not depend on selection, tree, or loadRunProjectNodes.
   * (Those deps recreated the callback on every case click → wipe/reload loop.)
   */
  const refreshOpenRunBrowse = useCallback(() => {
    if (Date.now() < suppressOpenRunRefreshUntilRef.current) return;
    onReloadRunsRef.current?.();
    if (runSearchOpenRef.current && (runSearchChipsRef.current?.length ?? 0) > 0) {
      setRunSearchRefreshKey((k) => k + 1);
    }
    const runId = selectedRunIdRef.current;
    if (!runId) return;

    void loadRunHeaderRef.current(runId);
    invalidateRunCasesCacheRef.current(runId);
    void loadRunProjectNodesRef.current(runId);
    runCaseListWindowRef.current?.invalidateForRun(runId);
    const casePath = selectedCaseIdInRunRef.current;
    if (casePath) void loadRunCaseCommentsRef.current(runId, casePath);
  }, []);

  useRefetchWhenActive(refreshOpenRunBrowse);
  useEffect(() => subscribeRefresh(() => refreshOpenRunBrowse()), [refreshOpenRunBrowse]);

  const runCaseSelectionKey =
    selectedRunId && selectedCaseIdInRun ? `${selectedRunId}\0${selectedCaseIdInRun}` : null;
  const fetchRunCaseContent = useCallback(() => {
    if (!selectedRunId || !selectedCaseIdInRun) return Promise.resolve(null);
    // Pass null repo when slug not ready so the backend can resolve the default workspace (same as explorer case detail).
    return getRunCaseContent(selectedRunId, selectedCaseIdInRun, activeRepoSlug ?? null);
  }, [selectedRunId, selectedCaseIdInRun, activeRepoSlug]);
  const [runCaseContent, runCaseContentKey] = useFetchedContent(runCaseSelectionKey, fetchRunCaseContent);

  useEffect(() => {
    const closeContextMenu = () => { setContextMenuRun(null); };
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
    };
  }, []);

  // When Archived view is open, fetch archived runs only.
  useEffect(() => {
    if (!archivedViewOpen || !activeRepoSlug) return;
    let cancelled = false;
    listRuns(activeRepoSlug, { archivedOnly: true })
      .then((data) => {
        if (!cancelled) setArchivedRuns(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setArchivedRuns([]);
      });
    return () => { cancelled = true; };
  }, [archivedViewOpen, activeRepoSlug]);

  const applyAdditionsToRunTree = useCallback(
    async (runId, addedCases) => {
      if (!runId || !addedCases?.length) return;
      runCaseListWindowRef.current?.invalidateForRun(runId);
      await ensureRunHeaderLoaded(runId);
      let tree = runFolderTreeByRunId[runId];
      if (tree === undefined) {
        tree = (await loadRunProjectNodes(runId)) ?? [];
      }
      const { tree: patched, missingPrefixes } = patchFolderTreeForAdditions(tree, addedCases);
      if (patched.length > 0) {
        patchRunFolderTree(runId, () => patched);
      }
      await Promise.all(
        missingPrefixes.map((prefix) => loadRunFolderSubtree(runId, prefix)),
      );
    },
    [
      ensureRunHeaderLoaded,
      runFolderTreeByRunId,
      loadRunProjectNodes,
      patchRunFolderTree,
      loadRunFolderSubtree,
    ],
  );

  /** When selected run changes, load header first then project tree nodes (non-blocking summary). */
  useEffect(() => {
    if (!selectedRunId) {
      setDetailLoading(false);
      return;
    }
    const hasListFallback = Boolean(runSummaryFromList(selectedRunId, runs, runDetailsByRunId));
    if (runDetailsByRunId[selectedRunId] !== undefined) {
      setDetailLoading(false);
      if (runFolderTreeByRunId[selectedRunId] === undefined) {
        loadRunProjectNodes(selectedRunId);
      }
      return;
    }
    setDetailLoading(!hasListFallback);
    ensureRunHeaderLoaded(selectedRunId).finally(() => setDetailLoading(false));
    if (runFolderTreeByRunId[selectedRunId] === undefined) {
      loadRunProjectNodes(selectedRunId);
    }
  }, [
    selectedRunId,
    activeRepoSlug,
    ensureRunHeaderLoaded,
    loadRunProjectNodes,
    runDetailsByRunId,
    runFolderTreeByRunId,
    runs,
  ]);

  const handleSelectCaseFromList = useCallback((runId, c) => {
    setSelectedRunId(runId);
    setSelectedCaseIdInRun(c?.file_path ?? null);
    if (runDetailsByRunId[runId] === undefined) ensureRunHeaderLoaded(runId);
  }, [ensureRunHeaderLoaded, runDetailsByRunId]);

  const handleSelectedRunCasePathsChange = useCallback((runId, next) => {
    setSelectedRunCasePathsByRunId((prev) => {
      const current = prev[runId] ?? new Set();
      const resolved = typeof next === "function" ? next(current) : next;
      return {
        ...prev,
        [runId]: resolved instanceof Set ? resolved : new Set(),
      };
    });
  }, []);

  // When navigating from Dashboard with a specific run, preselect it
  useEffect(() => {
    if (initialRunId) {
      setSelectedRunId(initialRunId);
      onClearInitialRunId?.();
    }
  }, [initialRunId, onClearInitialRunId]);

  // Optimistic update: merge newly added cases (from AddCasesToRunPage) into cache so list updates without refetch/flash
  useEffect(() => {
    const payload = optimisticRunCasesAdded;
    if (!payload?.runId || !payload.cases?.length) return;
    const { runId, cases: addedCases } = payload;
    const runInfo = runDetailsByRunId[runId]?.run ?? runs.find((r) => r.run_id === runId);
    const executedByHint = runInfo?.updated_by ?? null;
    const runAssignedHint = runInfo?.assigned_to?.trim() || null;
    const minimalCases = addedCases.map((c) =>
      withExecutionMeta(
        {
          file_path: c.file_path ?? "",
          case_id: c.case_id ?? c.file_path ?? "",
          title: c.case_id ?? c.file_path ?? "…",
          result: "pending",
          directory: directoryFromFilePath(c.file_path ?? ""),
          assigned_to: null,
          effective_assigned_to: runAssignedHint,
        },
        { result: "pending", executedByHint },
      ),
    );

    setRunDetailsByRunId((prev) => {
      const existing = prev[runId];
      const existingCases = existing?.cases ?? [];
      const existingPaths = new Set(existingCases.map((e) => e.file_path));
      const toAppend = minimalCases.filter((c) => c.file_path && !existingPaths.has(c.file_path));
      if (toAppend.length === 0 && existing) return prev;
      const run = runInfo
        ? {
            ...runInfo,
            total_cases: (runInfo.total_cases ?? existingCases.length) + toAppend.length,
          }
        : { run_id: runId, name: "", total_cases: minimalCases.length, passed: 0, failed: 0, skipped: 0 };
      const cases = existing ? [...existingCases, ...toAppend] : minimalCases;
      return { ...prev, [runId]: { run, cases } };
    });

    void applyAdditionsToRunTree(
      runId,
      minimalCases.map((c) => ({ file_path: c.file_path, result: c.result })),
    );
    onClearOptimisticRunCasesAdded?.();
  }, [
    optimisticRunCasesAdded,
    onClearOptimisticRunCasesAdded,
    runs,
    runDetailsByRunId,
    applyAdditionsToRunTree,
  ]);

  useEffect(() => {
    if (!createModalOpen || createStep !== 2 || !activeRepoSlug) return;
    getDashboardSummary(activeRepoSlug).then((d) => setDashboardProjects(d?.projects ?? [])).catch(() => setDashboardProjects([]));
  }, [createModalOpen, createStep, activeRepoSlug]);

  useEffect(() => {
    if (!createModalOpen || createStep !== 3 || !activeRepoSlug) return;
    const projectList = Array.from(selectedProjectPaths);
    if (!projectList.length) {
      setCreateStepCases([]);
      return;
    }
    setCreateCasesLoading(true);
    const params = {};
    if (createTagFilter.trim()) params.tag = createTagFilter.trim();
    if (createFolderPath) params.path_prefix = createFolderPath;
    else params.directories = projectList.join(",");
    fetchAllCases(activeRepoSlug, params)
      .then((items) => setCreateStepCases(items ?? []))
      .catch(() => setCreateStepCases([]))
      .finally(() => setCreateCasesLoading(false));
  }, [createModalOpen, createStep, activeRepoSlug, createFolderPath, createTagFilter, selectedProjectPaths]);

  /** Create flow: step 1 → step 2 (project selection). */
  const handleCreateRunNext = () => {
    const name = createName.trim();
    if (!name || !activeRepoSlug) return;
    setPendingNewRun({ name, description: createDesc.trim() });
    setCreateStep(2);
  };

  const handleCreateStepBackTo1 = () => {
    setCreateStep(1);
    setPendingNewRun(null);
    setDashboardProjects([]);
    setSelectedProjectPaths(new Set());
  };

  const prefetchCreateProjectSubtrees = useCallback(
    async (projectPaths, generation) => {
      if (!activeRepoSlug) return;
      const paths = Array.from(projectPaths || [])
        .map((p) => (p || "").trim().replace(/\\/g, "/").replace(/\/+$/, ""))
        .filter((p) => isProjectDirectoryPath(p) && !loadedCreateTreePrefixesRef.current.has(p));
      if (!paths.length) return;

      await runWithConcurrency(paths, 1, async (path) => {
        if (createPrefetchGenerationRef.current !== generation) return;
        try {
          const data = await getRepositoryTree({
            folderPrefix: path,
            depth: "full",
            repoSlug: activeRepoSlug,
          });
          if (createPrefetchGenerationRef.current !== generation) return;
          const nodes = Array.isArray(data) ? data : [];
          const projectNode = nodes.find((n) => n.directory_path === path) ?? nodes[0];
          if (projectNode) {
            setRepoTree((prev) => mergeFolderSubtreeIntoTree(prev, path, projectNode));
            loadedCreateTreePrefixesRef.current.add(path);
          }
        } catch {
          // ignore — expand can retry
        }
      });
    },
    [activeRepoSlug],
  );

  const handleCreateStep2Next = () => {
    if (selectedProjectPaths.size === 0 || !activeRepoSlug) return;
    setCreateStep(3);
    setCreateFolderPath(null);
    setCreateTagFilter("");
    setSelectedCasesForCreate([]);
    setCreateTreeExpanded(new Set());
    loadedCreateTreePrefixesRef.current = new Set();
    setCreateTreeStructureLoading(new Set());
    createPrefetchGenerationRef.current += 1;
    const generation = createPrefetchGenerationRef.current;
    const selectedPaths = new Set(selectedProjectPaths);
    getRepositoryTree({ depth: "projects", repoSlug: activeRepoSlug })
      .then((tree) => {
        const nodes = Array.isArray(tree) ? tree : [];
        setRepoTree(nodes);
        const run = () => {
          void prefetchCreateProjectSubtrees(selectedPaths, generation);
        };
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(run);
        } else {
          setTimeout(run, 0);
        }
      })
      .catch(() => setRepoTree([]));
  };

  const handleCreateStepBackTo2 = () => {
    setCreateStep(2);
    setRepoTree([]);
    setCreateStepCases([]);
    setSelectedCasesForCreate([]);
    setCreateFolderPath(null);
    setCreateTagFilter("");
    loadedCreateTreePrefixesRef.current = new Set();
    setCreateTreeStructureLoading(new Set());
    createPrefetchGenerationRef.current += 1;
  };

  const handleCreateTreeToggle = useCallback(
    async (path) => {
      const willExpand = !createTreeExpanded.has(path);
      setCreateTreeExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      if (
        !willExpand ||
        !path ||
        !isProjectDirectoryPath(path) ||
        loadedCreateTreePrefixesRef.current.has(path) ||
        !activeRepoSlug
      ) {
        return;
      }
      setCreateTreeStructureLoading((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      try {
        const data = await getRepositoryTree({
          folderPrefix: path,
          depth: "full",
          repoSlug: activeRepoSlug,
        });
        const nodes = Array.isArray(data) ? data : [];
        const projectNode = nodes.find((n) => n.directory_path === path) ?? nodes[0];
        if (projectNode) {
          setRepoTree((prev) => mergeFolderSubtreeIntoTree(prev, path, projectNode));
          loadedCreateTreePrefixesRef.current.add(path);
        }
      } catch {
        // ignore — user can retry expand
      } finally {
        setCreateTreeStructureLoading((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [createTreeExpanded, activeRepoSlug],
  );

  /** Create run from step 3 (with or without selected cases). */
  const handleConfirmCreateRun = async () => {
    if (readOnly) return;
    if (!pendingNewRun || !activeRepoSlug) return;
    setAddCasesLoading(true);
    try {
      const payload = { name: pendingNewRun.name, description: pendingNewRun.description };
      if (selectedCasesForCreate.length > 0) {
        payload.cases = selectedCasesForCreate.filter((c) => c.file_path).map((c) => ({ file_path: c.file_path }));
      }
      await createRun(payload, activeRepoSlug);
      setCreateModalOpen(false);
      setCreateStep(1);
      setCreateName("");
      setCreateDesc("");
      setPendingNewRun(null);
      setSelectedProjectPaths(new Set());
      setCreateStepCases([]);
      setSelectedCasesForCreate([]);
      setCreateFolderPath(null);
      setCreateTagFilter("");
      setRepoTree([]);
      onReloadRuns?.();
      onAfterRepoWrite?.();
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.message ?? "Create failed");
    } finally {
      setAddCasesLoading(false);
    }
  };

  const toggleCaseForCreate = (c) => {
    const item = { file_path: c.file_path, case_id: c.case_id ?? c.file_path };
    setSelectedCasesForCreate((prev) => {
      const has = prev.some((x) => x.file_path === c.file_path);
      if (has) return prev.filter((x) => x.file_path !== c.file_path);
      return [...prev, item];
    });
  };
  const isCaseSelectedForCreate = (filePath) => selectedCasesForCreate.some((x) => x.file_path === filePath);

  // --- Pass/Fail/Skip: unified debounced auto-save (same hook as case edit / run description) ---
  const resultsDraft = useMemo(() => {
    const detail = selectedRunId ? runDetailsByRunId[selectedRunId] : undefined;
    if (!detail?.cases || !selectedRunId) return [];
    return detail.cases.map((c) => ({ file_path: c.file_path, result: c.result || "pending" }));
  }, [selectedRunId, runDetailsByRunId]);

  const resultsPersisted = useMemo(() => {
    if (!selectedRunId) return [];
    return savedRunResults[selectedRunId] ?? [];
  }, [selectedRunId, savedRunResults]);

  const normalizeResults = useCallback((arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return [];
    return [...arr].sort((a, b) => a.file_path.localeCompare(b.file_path));
  }, []);

  const saveRunResultsForRun = useCallback(
    async (runId, draft) => {
      if (readOnly) return;
      if (!runId || !activeRepoSlug) return;
      const baseline = savedRunResultsRef.current[runId] ?? [];
      const baseMap = new Map(baseline.map((r) => [r.file_path, r.result]));
      const changed = draft.filter(
        (d) => d.result && d.result !== "pending" && baseMap.get(d.file_path) !== d.result,
      );
      if (changed.length === 0) return;
      noteLocalRunWrite();
      try {
        const res = await setRunResultsBatch(
          runId,
          { results: changed },
          activeRepoSlug,
        );
        setSavedRunResults((prev) => ({ ...prev, [runId]: [...draft] }));
        savedRunResultsRef.current = {
          ...savedRunResultsRef.current,
          [runId]: [...draft],
        };
        setRunDetailsByRunId((prev) => ({
          ...prev,
          [runId]: mergeRunResultsFromBatchResponse(
            prev[runId],
            res,
          ),
        }));
        onAfterRepoWrite?.();
      } catch (err) {
        setError(err?.response?.data?.detail ?? err?.message ?? "Update failed");
      }
    },
    [activeRepoSlug, noteLocalRunWrite, onAfterRepoWrite, readOnly],
  );

  /** Bound to the current run id so key-change snapshots keep the correct target. */
  const handleSaveRunResults = useCallback(
    (draft) => saveRunResultsForRun(selectedRunId, draft),
    [saveRunResultsForRun, selectedRunId],
  );

  const { flush: flushRunResults } = useDebouncedAutoSave({
    enabled: !!selectedRunId && !!activeRepoSlug && !readOnly,
    key: selectedRunId,
    draft: resultsDraft,
    persisted: resultsPersisted,
    normalize: normalizeResults,
    save: handleSaveRunResults,
    delayMs: DEBOUNCE_MS,
    silent: true,
  });

  useEffect(() => {
    return registerAutoSaveFlush(flushRunResults);
  }, [flushRunResults]);

  const openAddCasesModal = async () => {
    if (readOnly) return;
    if (!activeRepoSlug) return;
    setAddCasesModalOpen(true);
    setAddCasesLoading(true);
    setSelectedCasePaths(new Set());
    try {
      const items = await fetchAllCases(activeRepoSlug);
      setRepoCases(items ?? []);
    } catch (err) {
      setRepoCases([]);
    } finally {
      setAddCasesLoading(false);
    }
  };

  const toggleCaseForAdd = (filePath) => {
    setSelectedCasePaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const handleArchiveRun = async (run, archived) => {
    if (readOnly) return;
    if (!activeRepoSlug) return;
    setContextMenuRun(null);
    try {
      await archiveRun(run.run_id, archived, activeRepoSlug);
      setRunDetailsByRunId((prev) => {
        const entry = prev[run.run_id];
        if (!entry?.run) return prev;
        return { ...prev, [run.run_id]: { ...entry, run: { ...entry.run, archived } } };
      });
      onReloadRuns?.();
      onAfterRepoWrite?.();
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.message ?? "Archive failed");
    }
  };

  const openDuplicateModal = (run) => {
    setContextMenuRun(null);
    setDuplicateModalRun(run);
    setDuplicateName(`${run.name} (copy)`);
    setDuplicateDesc(run.description || "");
  };

  const handleDuplicateRun = async () => {
    if (readOnly) return;
    if (!duplicateModalRun || !activeRepoSlug || !duplicateName.trim()) return;
    setDuplicateLoading(true);
    try {
      await duplicateRun(duplicateModalRun.run_id, { name: duplicateName.trim(), description: duplicateDesc.trim() }, activeRepoSlug);
      setDuplicateModalRun(null);
      setDuplicateName("");
      setDuplicateDesc("");
      onReloadRuns?.();
      onAfterRepoWrite?.();
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.message ?? "Duplicate failed");
    } finally {
      setDuplicateLoading(false);
    }
  };

  const startRenameRun = (run) => {
    setContextMenuRun(null);
    setRenamingRunId(run.run_id);
  };

  const handleRenameRunCommit = useCallback(
    async (runId, newName) => {
      if (readOnly) {
        setRenamingRunId(null);
        return;
      }
      if (!activeRepoSlug || !newName?.trim()) {
        setRenamingRunId(null);
        return;
      }
      const name = newName.trim();
      const otherRuns = runs.filter((r) => r.run_id !== runId);
      if (otherRuns.some((r) => sanitizeRunName(r.name) === sanitizeRunName(name))) {
        setError("A run with this name already exists.");
        return;
      }
      setError("");
      try {
        await patchRun(runId, { name }, activeRepoSlug);
        setRenamingRunId(null);
        setRunDetailsByRunId((prev) => {
          const entry = prev[runId];
          if (!entry) return prev;
          return { ...prev, [runId]: { ...entry, run: { ...entry.run, name } } };
        });
        onReloadRuns?.();
        onAfterRepoWrite?.();
      } catch (err) {
        const detail = err?.response?.data?.detail;
        setError(typeof detail === "string" ? detail : "Rename failed");
      }
    },
    [activeRepoSlug, runs, onReloadRuns, onAfterRepoWrite, readOnly]
  );

  const handleRenameRunCancel = useCallback(() => {
    setRenamingRunId(null);
  }, []);

  const handleAddCases = async () => {
    if (readOnly) return;
    if (!selectedRunId || !activeRepoSlug || selectedCasePaths.size === 0) return;
    setAddCasesLoading(true);
    const pathsToAdd = Array.from(selectedCasePaths);
    const detail = runDetailsByRunId[selectedRunId];
    const executedByHint =
      detail?.run?.updated_by ??
      runs.find((r) => r.run_id === selectedRunId)?.updated_by ??
      null;
    const runAssignedHint = detail?.run?.assigned_to?.trim() || null;

    setRunDetailsByRunId((prev) => {
      const entry = prev[selectedRunId];
      if (!entry) return prev;
      const existingPaths = new Set((entry.cases ?? []).map((c) => c.file_path));
      const newRows = pathsToAdd
        .filter((file_path) => !existingPaths.has(file_path))
        .map((file_path) => {
          const repoCase = repoCases.find((x) => x.file_path === file_path);
          return withExecutionMeta(
            {
              file_path,
              case_id: repoCase?.case_id ?? file_path,
              title: repoCase?.title ?? null,
              tags: repoCase?.tags ?? [],
              priority: repoCase?.priority ?? null,
              result: "pending",
              assigned_to: null,
              effective_assigned_to: runAssignedHint,
            },
            { result: "pending", executedByHint },
          );
        });
      if (newRows.length === 0) return prev;
      const nextCases = [...(entry.cases ?? []), ...newRows];
      const nextRun = {
        ...(entry.run ?? {}),
        total_cases: nextCases.length,
      };
      return { ...prev, [selectedRunId]: { ...entry, cases: nextCases, run: nextRun } };
    });
    setAddCasesModalOpen(false);
    setSelectedCasePaths(new Set());

    try {
      const cases = pathsToAdd
        .map((file_path) => repoCases.find((x) => x.file_path === file_path))
        .filter((c) => c?.file_path)
        .map((c) => ({ file_path: c.file_path }));
      const res = await addRunCases(selectedRunId, { cases }, activeRepoSlug);
      await applyAdditionsToRunTree(
        selectedRunId,
        cases.map((c) => ({ file_path: c.file_path, result: "pending" })),
      );
      const executedByFromApi = res?.executed_by?.trim() || null;
      const runAssignedFromApi =
        (typeof res?.run_assigned_to === "string" ? res.run_assigned_to.trim() : "") || null;
      if (executedByFromApi || runAssignedFromApi) {
        setRunDetailsByRunId((prev) => {
          let next = prev[selectedRunId];
          if (executedByFromApi) {
            next = applyExecutedByToPaths(next, pathsToAdd, executedByFromApi);
          }
          if (runAssignedFromApi) {
            next = applyRunAssignedToPaths(next, pathsToAdd, runAssignedFromApi);
          }
          return { ...prev, [selectedRunId]: next };
        });
      }
      onReloadRuns?.();
      onAfterRepoWrite?.();
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.message ?? "Add cases failed");
    } finally {
      setAddCasesLoading(false);
    }
  };

  const noWorkspaceSelected = !activeRepoSlug;
  const topMessage = noWorkspaceSelected ? (
    <div className="flex flex-1 items-center justify-center">
      <PageMessage variant="hint" title="Select or add a workspace from the header first." />
    </div>
  ) : null;

  /** Single source: panel always reads from DB-backed cache for the selected run. */
  const runDetailForPanel = selectedRunId ? runDetailsByRunId[selectedRunId] : undefined;
  const casesForPanel = runDetailForPanel?.cases ?? [];
  const runIdForPanel = selectedRunId;

  const runsByCreated = useSortedRuns(runs, "created");
  const archivedRunsByCreated = useSortedRuns(archivedRuns, "created");
  const baseArchivedRuns = archivedRunsByCreated;

  const runSearchActive = runSearchOpen && runSearchChips.length > 0;
  const runSearchResetKey = useMemo(
    () =>
      (runSearchChips ?? [])
        .map((c) => `${c.key}:${c.value ?? ""}`)
        .join("|"),
    [runSearchChips],
  );

  const { results: runSearchCases, loading: runSearchLoading, setResults: setRunSearchCases } =
    useRunCaseSearchResults(
    activeRepoSlug,
    runSearchChips,
    {
      includeArchived: archivedViewOpen || runsIncludeArchived,
      enabled: runSearchActive,
      refreshKey: runSearchRefreshKey,
    },
  );

  const openedRunId = useMemo(
    () => parseRunTreePath(openedRunPath)?.runId ?? null,
    [openedRunPath],
  );

  const scopedRunSearchCases = useMemo(
    () => filterRowsByRunId(runSearchCases, openedRunId),
    [runSearchCases, openedRunId],
  );

  const handleSetResult = useCallback(
    async (runId, filePath, result) => {
      if (readOnly) return;
      if (!runId || !activeRepoSlug) return;

      if (runDetailsByRunIdRef.current[runId] === undefined) {
        await ensureRunHeaderLoaded(runId);
      }

      let detail = runDetailsByRunIdRef.current[runId];
      if (!detail) return;

      if (runSearchActive) {
        const searchRow = scopedRunSearchCases.find(
          (c) => c.run_id === runId && c.file_path === filePath,
        );
        if (searchRow) {
          const hydrated = mergeSearchCaseIntoRunDetail(detail, searchRow);
          if (hydrated !== detail) {
            detail = hydrated;
            runDetailsByRunIdRef.current = { ...runDetailsByRunIdRef.current, [runId]: hydrated };
            setRunDetailsByRunId((prev) => ({ ...prev, [runId]: hydrated }));
          }
        }
      }

      const currentCase = (detail.cases ?? []).find((c) => c.file_path === filePath);
      if (!currentCase || currentCase.result === result) return;

      noteLocalRunWrite();

      const oldResult = currentCase.result ?? "pending";
      if (oldResult !== result) {
        patchRunFolderTree(runId, (tree) =>
          patchFolderTreeForResultChange(tree, filePath, oldResult, result),
        );
      }

      const executedByHint = detail.run?.updated_by ?? null;
      const updatedCases = (detail.cases ?? []).map((c) =>
        c.file_path === filePath ? withExecutionMeta(c, { result, executedByHint }) : c,
      );
      const updatedRun = { ...(detail.run ?? {}) };
      updatedRun.passed = updatedCases.filter((c) => c.result === "passed").length;
      updatedRun.failed = updatedCases.filter((c) => c.result === "failed").length;
      updatedRun.skipped = updatedCases.filter((c) => c.result === "skipped").length;
      const nextDetail = { ...detail, cases: updatedCases, run: updatedRun };
      setRunDetailsByRunId((prev) => ({ ...prev, [runId]: nextDetail }));
      runDetailsByRunIdRef.current = { ...runDetailsByRunIdRef.current, [runId]: nextDetail };

      if (runSearchActive) {
        setRunSearchCases((prev) =>
          prev.map((c) =>
            c.run_id === runId && c.file_path === filePath ? { ...c, result } : c,
          ),
        );
      } else {
        runCaseListWindowRef.current?.patchLocal({
          update: [{ filePath, partial: { result } }],
        });
      }

      if (runId !== selectedRunId) {
        setRunResultsBatch(runId, { results: [{ file_path: filePath, result }] }, activeRepoSlug)
          .then((res) => {
            setSavedRunResults((prev) => {
              const next = { ...prev };
              const existing = next[runId] ?? [];
              const updated = existing.some((r) => r.file_path === filePath)
                ? existing.map((r) => (r.file_path === filePath ? { ...r, result } : r))
                : [...existing, { file_path: filePath, result }];
              next[runId] = updated;
              return next;
            });
            setRunDetailsByRunId((prev) => ({
              ...prev,
              [runId]: mergeRunResultsFromBatchResponse(prev[runId], res),
            }));
            onAfterRepoWrite?.();
          })
          .catch((err) => {
            setError(err?.response?.data?.detail ?? err?.message ?? "Update failed");
          });
      }
    },
    [
      readOnly,
      activeRepoSlug,
      runSearchActive,
      scopedRunSearchCases,
      ensureRunHeaderLoaded,
      noteLocalRunWrite,
      patchRunFolderTree,
      selectedRunId,
      setRunSearchCases,
      setRunDetailsByRunId,
      setSavedRunResults,
      onAfterRepoWrite,
    ],
  );

  const searchMatchingRuns = useMemo(() => {
    if (!runSearchActive) return [];
    const ids = new Set(scopedRunSearchCases.map((c) => c.run_id));
    const pool = archivedViewOpen ? baseArchivedRuns : runsByCreated;
    return pool.filter((r) => ids.has(r.run_id));
  }, [runSearchActive, scopedRunSearchCases, archivedViewOpen, baseArchivedRuns, runsByCreated]);

  const searchUnifiedRunTree = useMemo(
    () => buildUnifiedRunTreeFromSearchResults(searchMatchingRuns, scopedRunSearchCases),
    [searchMatchingRuns, scopedRunSearchCases],
  );

  const {
    searchFolderPath: runSearchFolderPath,
    searchExpanded: runSearchExpanded,
    setSearchExpanded: setRunSearchExpanded,
    setSearchFolderPath: setRunSearchFolderPath,
    folderScopedCases: runSearchFolderScopedCases,
    selectedRunId: runSearchSelectedRunId,
    folderLabel: runSearchFolderLabel,
    handleSelectSearchFolder,
  } = useRunSearchBrowseState({
    searchTree: searchUnifiedRunTree,
    matchingCases: scopedRunSearchCases,
    searchActive: runSearchActive,
    searchResetKey: runSearchResetKey,
  });

  const runsForList = archivedViewOpen ? baseArchivedRuns : runsByCreated;

  const unifiedRunTree = useMemo(
    () => buildUnifiedRunTree(runsForList, runDetailsByRunId, runFolderTreeByRunId),
    [runsForList, runDetailsByRunId, runFolderTreeByRunId],
  );

  const { pinnedProjectPaths, isPinned, togglePin } = usePinnedProjects(
    activeRepoSlug,
    unifiedRunTree,
  );

  const {
    selectedFolderPath,
    expanded: folderExpanded,
    setExpanded: setFolderExpanded,
    handleSelectBrowseFolder,
  } = useRunBrowseState({
    tree: unifiedRunTree,
    selectedRunId,
    selectedCaseFilePath: selectedCaseIdInRun,
    searchOpen: runSearchOpen,
    enabled: runsForList.length > 0,
  });

  const handleRunCasesFetched = useCallback(
    (runId, items) => {
      mergeCasesIntoRunCache(runId, items);
    },
    [mergeCasesIntoRunCache],
  );

  const runCaseListWindow = useRunCaseListWindow({
    runId: selectedRunId,
    folderPath: selectedFolderPath,
    repoSlug: activeRepoSlug,
    enabled: !runSearchActive && Boolean(selectedRunId && selectedFolderPath),
    onItemsFetched: handleRunCasesFetched,
  });
  runCaseListWindowRef.current = runCaseListWindow;

  const handleRemoveCases = useCallback(
    async (runId, filePaths) => {
      if (readOnly) return;
      if (!runId || !activeRepoSlug) return;
      const paths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
      if (paths.length === 0) return;

      const pathSet = new Set(paths);
      const prevDetail = runDetailsByRunId[runId];
      const prevFolderTree = runFolderTreeByRunId[runId];
      const removals = paths.map((p) => ({
        file_path: p,
        result: (prevDetail?.cases ?? []).find((c) => c.file_path === p)?.result ?? "pending",
      }));
      const prevSelectedCaseId =
        selectedRunId === runId && selectedCaseIdInRun && pathSet.has(selectedCaseIdInRun)
          ? selectedCaseIdInRun
          : null;
      const prevSelectedPaths = selectedRunCasePathsByRunId[runId];

      if (prevSelectedCaseId) {
        setSelectedCaseIdInRun(null);
      }

      setSelectedRunCasePathsByRunId((prev) => {
        const existing = prev?.[runId];
        if (!(existing instanceof Set) || existing.size === 0) return prev;
        const next = new Set(existing);
        for (const p of paths) next.delete(p);
        return { ...prev, [runId]: next };
      });

      if (removals.length > 0) {
        patchRunFolderTree(runId, (tree) => patchFolderTreeForRemovals(tree, removals));
      }

      if (prevDetail) {
        setRunDetailsByRunId((prev) => ({
          ...prev,
          [runId]: buildRunDetailAfterRemove(prevDetail, paths),
        }));
      }

      runCaseListWindowRef.current?.patchLocal({ remove: paths });

      try {
        await removeRunCases(runId, { file_paths: paths }, activeRepoSlug);
        void reloadRunFolderTree(runId);
        onReloadRuns?.();
        onAfterRepoWrite?.();
      } catch (err) {
        if (prevDetail) {
          setRunDetailsByRunId((prev) => ({ ...prev, [runId]: prevDetail }));
        }
        restoreRunFolderTree(runId, prevFolderTree);
        if (prevSelectedCaseId) {
          setSelectedCaseIdInRun(prevSelectedCaseId);
        }
        if (prevSelectedPaths instanceof Set) {
          setSelectedRunCasePathsByRunId((prev) => ({
            ...prev,
            [runId]: new Set(prevSelectedPaths),
          }));
        }
        invalidateRunCasesCache(runId);
        runCaseListWindowRef.current?.invalidateForRun(runId);
        setError(err?.response?.data?.detail ?? err?.message ?? "Remove failed");
      }
    },
    [
      readOnly,
      activeRepoSlug,
      runDetailsByRunId,
      runFolderTreeByRunId,
      selectedRunId,
      selectedCaseIdInRun,
      selectedRunCasePathsByRunId,
      patchRunFolderTree,
      restoreRunFolderTree,
      reloadRunFolderTree,
      onReloadRuns,
      onAfterRepoWrite,
      invalidateRunCasesCache,
    ],
  );

  const handleSelectBrowseFolderWithRun = useCallback(
    async (path) => {
      if (!path) return;
      try {
        await flushRunResults();
      } catch (_) {
        /* keep navigating; autosave errors are already reported via setError */
      }
      handleSelectBrowseFolder(path);
      const parsed = parseRunTreePath(path);
      if (!parsed?.runId) return;
      if (parsed.runId !== selectedRunId) {
        setSelectedRunId(parsed.runId);
        setSelectedCaseIdInRun(null);
        setIsEditingRunSummary(false);
        setSelectedRunCasePathsByRunId((prev) => ({
          ...prev,
          [parsed.runId]: prev[parsed.runId] ?? new Set(),
        }));
      } else if (parsed.isRunRoot) {
        setSelectedCaseIdInRun(null);
        setIsEditingRunSummary(false);
      }
      if (runDetailsByRunId[parsed.runId] === undefined) {
        ensureRunHeaderLoaded(parsed.runId);
      }
      if (runFolderTreeByRunId[parsed.runId] === undefined) {
        loadRunProjectNodes(parsed.runId);
      }
    },
    [
      flushRunResults,
      handleSelectBrowseFolder,
      selectedRunId,
      runDetailsByRunId,
      runFolderTreeByRunId,
      ensureRunHeaderLoaded,
      loadRunProjectNodes,
    ],
  );

  const visibleRunTree = useMemo(
    () => filterTreeToOpenedRoot(unifiedRunTree, openedRunPath),
    [unifiedRunTree, openedRunPath],
  );

  const handleOpenRun = useCallback(
    (pathOrNode) => {
      const path =
        typeof pathOrNode === "string"
          ? pathOrNode
          : pathOrNode?.directory_path ||
            (pathOrNode?.run_id ? runTreePathForRunId(pathOrNode.run_id) : null);
      if (!path) return;
      const parsed = parseRunTreePath(path);
      if (!parsed?.runId || !parsed.isRunRoot) return;
      const runPath = runTreePathForRunId(parsed.runId);
      const runNode =
        (unifiedRunTree || []).find((n) => n.directory_path === runPath) ||
        (typeof pathOrNode === "object" ? pathOrNode : null);
      setOpenedRunPath(runPath);
      void handleSelectBrowseFolderWithRun(runPath);
      const expandKey = runNode?.name || runPath;
      setFolderExpanded((prev) => new Set([...prev, expandKey]));
      if (runSearchOpen) {
        setRunSearchFolderPath(runPath);
      }
    },
    [
      handleSelectBrowseFolderWithRun,
      runSearchOpen,
      setFolderExpanded,
      setRunSearchFolderPath,
      unifiedRunTree,
    ],
  );

  const handleCloseOpenedRun = useCallback(() => {
    const path = openedRunPath;
    const runNode = (unifiedRunTree || []).find((n) => n.directory_path === path);
    const expandKey = runNode?.name || path;
    setOpenedRunPath(null);
    if (expandKey) {
      setFolderExpanded((prev) => {
        if (!prev.has(expandKey)) return prev;
        const next = new Set(prev);
        next.delete(expandKey);
        return next;
      });
    }
    if (runSearchOpen) {
      setRunSearchFolderPath(null);
    }
  }, [openedRunPath, setFolderExpanded, unifiedRunTree, runSearchOpen, setRunSearchFolderPath]);

  useEffect(() => {
    if (!openedRunPath || !(unifiedRunTree || []).length) return;
    if (!(unifiedRunTree || []).some((n) => n.directory_path === openedRunPath)) {
      setOpenedRunPath(null);
    }
  }, [openedRunPath, unifiedRunTree]);

  useEffect(() => {
    if (archivedViewOpen) setOpenedRunPath(null);
  }, [archivedViewOpen]);

  useEffect(() => {
    if (!runSearchOpen || !openedRunPath) return;
    if (runSearchFolderPath == null) {
      setRunSearchFolderPath(openedRunPath);
    }
  }, [runSearchOpen, openedRunPath, runSearchFolderPath, setRunSearchFolderPath]);

  const handleSelectSearchFolderWithRun = useCallback(
    (path) => {
      if (!path) return;
      handleSelectSearchFolder(path);
      const parsed = parseRunTreePath(path);
      if (!parsed?.runId) return;
      setSelectedRunId(parsed.runId);
      setSelectedCaseIdInRun(null);
      setIsEditingRunSummary(false);
    },
    [handleSelectSearchFolder],
  );

  const handleRunFolderExpand = useCallback(
    (path) => {
      const parsed = parseRunTreePath(path);
      if (!parsed?.runId) return;
      if (runDetailsByRunId[parsed.runId] === undefined) {
        ensureRunHeaderLoaded(parsed.runId);
      }
      if (runFolderTreeByRunId[parsed.runId] === undefined) {
        loadRunProjectNodes(parsed.runId);
      }
      if (parsed.repoPath) {
        const tree = runFolderTreeByRunId[parsed.runId] ?? [];
        const node = tree.find((n) => n.directory_path === parsed.repoPath);
        if (node?.is_project && !(node.children?.length > 0)) {
          loadRunFolderSubtree(parsed.runId, parsed.repoPath);
        }
      }
    },
    [
      runDetailsByRunId,
      runFolderTreeByRunId,
      ensureRunHeaderLoaded,
      loadRunProjectNodes,
      loadRunFolderSubtree,
    ],
  );

  useEffect(() => {
    if (runSearchOpen || !selectedFolderPath) return;
    const parsed = parseRunTreePath(selectedFolderPath);
    if (parsed?.runId && parsed.runId !== selectedRunId) {
      setSelectedRunId(parsed.runId);
      if (runDetailsByRunId[parsed.runId] === undefined) {
        ensureRunHeaderLoaded(parsed.runId);
      }
      if (runFolderTreeByRunId[parsed.runId] === undefined) {
        loadRunProjectNodes(parsed.runId);
      }
    }
  }, [
    selectedFolderPath,
    selectedRunId,
    runSearchOpen,
    runDetailsByRunId,
    runFolderTreeByRunId,
    ensureRunHeaderLoaded,
    loadRunProjectNodes,
  ]);

  useEffect(() => {
    if (!selectedRunId || !selectedCaseIdInRun) return;
    loadRunCaseComments(selectedRunId, selectedCaseIdInRun);
  }, [selectedRunId, selectedCaseIdInRun, loadRunCaseComments]);

  const folderLabel = findRunFolderDisplayName(unifiedRunTree, selectedFolderPath);
  const hasListRunFallback = Boolean(
    runSummaryFromList(selectedRunId, runs, runDetailsByRunId),
  );
  const runDetailLoading = Boolean(
    selectedRunId && runDetailForPanel === undefined && !hasListRunFallback,
  );

  const browseListLoading =
    runDetailLoading ||
    (headerLoadingRunId === selectedRunId && !selectedFolderPath && !hasListRunFallback) ||
    (Boolean(selectedFolderPath) && runCaseListWindow.loading && runCaseListWindow.items.length === 0);

  const handleSelectCaseInList = useCallback(
    async (c) => {
      const runId = resolveRunIdForCaseSelection({
        searchActive: runSearchActive,
        caseRow: c,
        searchSelectedRunId: runSearchSelectedRunId,
        browseSelectedRunId: selectedRunId,
      });
      if (!runId || !c?.file_path) return;

      if (runSearchActive) {
        await hydrateSearchRunCaseSelection({
          runId,
          filePath: c.file_path,
          searchCases: runSearchCases,
          ensureRunHeaderLoaded,
          setRunDetailsByRunId,
        });
      }

      handleSelectCaseFromList(runId, c);
    },
    [
      runSearchActive,
      runSearchSelectedRunId,
      selectedRunId,
      runSearchCases,
      ensureRunHeaderLoaded,
      setRunDetailsByRunId,
      handleSelectCaseFromList,
    ],
  );

  const runCaseSelectionConfig = useMemo(() => {
    if (archivedViewOpen || readOnly || !selectedRunId) return null;
    const selectedPaths = selectedRunCasePathsByRunId[selectedRunId] ?? new Set();
    const orderedPaths = runSearchActive
      ? runSearchFolderScopedCases.map((c) => c.file_path).filter(Boolean)
      : runCaseListWindow.items.map((c) => c.file_path).filter(Boolean);
    return {
      selectedPaths,
      onChange: (next) => handleSelectedRunCasePathsChange(selectedRunId, next),
      orderedPaths,
    };
  }, [
    archivedViewOpen,
    readOnly,
    selectedRunId,
    selectedRunCasePathsByRunId,
    runSearchActive,
    runSearchFolderScopedCases,
    runCaseListWindow.items,
    handleSelectedRunCasePathsChange,
  ]);

  const suiteRemoveInFlightRef = useRef(false);

  const getRunFolderContextMenuItems = useCallback(
    (node, closeMenu) => {
      if (archivedViewOpen || readOnly) return [];
      if (node?.is_run) return [];
      const parsed = parseRunTreePath(node.directory_path);
      if (!parsed?.runId || parsed.isRunRoot) return [];
      const runId = parsed.runId;
      const caseCount = node.case_count ?? 0;
      if (caseCount === 0) return [];
      const isProject = node.is_project === true;
      const bulkSuffix = caseCount > 1 ? ` (${caseCount})` : "";
      return [
        {
          icon: Trash2,
          label: isProject
            ? `Remove project${bulkSuffix}`
            : `Remove suite${bulkSuffix}`,
          variant: "danger",
          disabled: suiteRemoveInFlightRef.current,
          onClick: () => {
            if (suiteRemoveInFlightRef.current) return;
            suiteRemoveInFlightRef.current = true;
            const folderPrefix = folderPrefixFromTreePath(node.directory_path);
            void fetchAllRunCasesForFolder(runId, activeRepoSlug, folderPrefix)
              .then((items) => {
                const filePaths = (items ?? []).map((c) => c.file_path).filter(Boolean);
                if (filePaths.length > 0) {
                  return handleRemoveCases(runId, filePaths);
                }
              })
              .finally(() => {
                suiteRemoveInFlightRef.current = false;
                closeMenu(null);
              });
          },
        },
      ];
    },
    [
      archivedViewOpen,
      readOnly,
      activeRepoSlug,
      handleRemoveCases,
    ],
  );

  const getRunCaseContextMenuItems = useCallback(
    (caseRow, closeMenu) => {
      if (archivedViewOpen || readOnly || !selectedRunId) return [];
      const clickedPath = caseRow?.file_path;
      if (!clickedPath) return [];
      const selected = selectedRunCasePathsByRunId[selectedRunId];
      const targets =
        selected?.size > 0 && selected.has(clickedPath)
          ? Array.from(selected)
          : [clickedPath];
      const bulkSuffix = targets.length > 1 ? ` (${targets.length})` : "";
      return [
        {
          icon: Trash2,
          label: `Remove from run${bulkSuffix}`,
          variant: "danger",
          onClick: () => {
            handleRemoveCases(selectedRunId, targets);
            closeMenu(null);
          },
        },
      ];
    },
    [
      archivedViewOpen,
      readOnly,
      selectedRunId,
      selectedRunCasePathsByRunId,
      handleRemoveCases,
    ],
  );

  const handleRunSearch = useCallback((chips) => {
    if (chips.length > 0) pushRunHistory(chips);
    setRunSearchChips(chips);
  }, [pushRunHistory]);

  const handleCloseRunSearch = useCallback(() => {
    const folderFromSearch = runSearchFolderPath;
    setRunSearchChips([]);
    setRunSearchOpen(false);
    if (folderFromSearch) {
      handleSelectBrowseFolderWithRun(folderFromSearch);
    }
  }, [runSearchFolderPath, handleSelectBrowseFolderWithRun]);

  const handleCloseArchivedView = useCallback(() => {
    setArchivedViewOpen(false);
  }, []);

  const handleArchivedClick = useCallback(() => {
    if (archivedViewOpen) {
      handleCloseArchivedView();
    } else {
      handleCloseRunSearch();
      setArchivedViewOpen(true);
    }
  }, [archivedViewOpen, handleCloseArchivedView, handleCloseRunSearch]);

  const handleRestoreRun = useCallback(
    async (run) => {
      if (readOnly) return;
      if (!activeRepoSlug) return;
      try {
        await restoreRun(run.run_id, activeRepoSlug);
        setArchivedRuns((prev) => prev.filter((r) => r.run_id !== run.run_id));
        if (selectedRunId === run.run_id) {
          setSelectedRunId(null);
          setSelectedCaseIdInRun(null);
        }
        onReloadRuns?.();
      } catch (err) {
        setError(err?.response?.data?.detail ?? err?.message ?? "Failed to restore run");
      }
    },
    [activeRepoSlug, selectedRunId, onReloadRuns, readOnly]
  );

  const handleDeleteRun = useCallback(
    async (run) => {
      if (readOnly) return;
      if (!activeRepoSlug) return;
      const ok = await confirm({
        title: "Delete run?",
        description: `Delete run "${run.name}" permanently? This cannot be undone.`,
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        variant: "danger",
      });
      if (!ok) return;
      try {
        await deleteRun(run.run_id, activeRepoSlug);
        setArchivedRuns((prev) => prev.filter((r) => r.run_id !== run.run_id));
        if (selectedRunId === run.run_id) {
          setSelectedRunId(null);
          setSelectedCaseIdInRun(null);
        }
        onReloadRuns?.();
      } catch (err) {
        setError(err?.response?.data?.detail ?? err?.message ?? "Failed to delete run");
      }
    },
    [activeRepoSlug, confirm, selectedRunId, onReloadRuns, readOnly]
  );

  const runSearchButton = (
    <SearchToggleButton
      isOpen={runSearchOpen}
      hasActiveChips={runSearchChips.length > 0}
      onClick={() => {
        if (runSearchOpen) {
          handleCloseRunSearch();
        } else {
          if (archivedViewOpen) {
            setArchivedViewOpen(false);
          }
          setRunSearchOpen(true);
        }
      }}
      ariaLabelWhenClosed="Filter runs"
    />
  );

  const archivedButton = (
    <Tooltip label={archivedViewOpen ? "Back to tree" : "Archived runs"} placement="bottom">
      <button
        type="button"
        onClick={handleArchivedClick}
        className={`${TOOLBAR_BTN_BASE} ${archivedViewOpen ? TOOLBAR_BTN_SELECTED : ""}`}
        aria-label={archivedViewOpen ? "Back to tree" : "Archived runs"}
      >
        {archivedViewOpen ? (
          <ArrowLeft className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
      </button>
    </Tooltip>
  );

  const runToolbar = (
    <TreeToolbar
      addButton={
        readOnly ? null : (
          <TitleBarAddButton
            tooltip="Create new run"
            onClick={() => setCreatingRun(true)}
            ariaLabel="Create new run"
          />
        )
      }
      sortButton={null}
      searchNode={runSearchButton}
      extraActions={
        <>
          {onOpenExportRuns ? (
            <Tooltip
              label={runFilesDirty ? "Push run changes first, then export" : "Export runs (CSV or PDF)"}
              placement="bottom"
            >
              <button
                type="button"
                onClick={() => {
                  if (runFilesDirty) return;
                  if (runSearchOpen) handleCloseRunSearch();
                  if (archivedViewOpen) setArchivedViewOpen(false);
                  onOpenExportRuns?.();
                }}
                disabled={runFilesDirty}
                className={TOOLBAR_BTN_BASE}
                aria-label="Export runs"
                title={runFilesDirty ? "Push run changes first, then export" : undefined}
              >
                <FileDown className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : null}
          {archivedButton}
        </>
      }
      // Only close search on capture; do NOT close archived view here — TreeToolbar wraps extraActions
      // with onClickCapture(beforeAction), so handleCloseArchivedView would fire on Expand/Archive and exit archive.
      onBeforeAction={runSearchOpen ? handleCloseRunSearch : undefined}
    />
  );

  const handleCommitCreateRun = async (name) => {
    if (readOnly) return;
    setCreatingRun(false);
    if (!name?.trim() || !activeRepoSlug) return;
    try {
      const data = await createRun({ name: name.trim() }, activeRepoSlug);
      onReloadRuns?.();
      onAfterRepoWrite?.();
      if (data?.run_id) {
        setSelectedRunId(data.run_id);
      }
    } catch (err) {
      setError(err?.response?.data?.detail ?? err?.message ?? "Failed to create run");
    }
  };

  const runTreeEmptyMessage = archivedViewOpen
    ? "No archived runs."
    : runSearchActive
      ? "No matching runs found."
      : "No test runs yet.";

  const renderRunFolderTree = (tree, emptyMessage, searchMode = false) => {
    if (runsLoading || (searchMode && runSearchLoading)) return <SidebarLoading />;
    const showCreateRun =
      !searchMode && !archivedViewOpen && !runSearchOpen && !openedRunPath && creatingRun;
    if (!tree.length && !showCreateRun) {
      return (
        <div className="px-2 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
          {emptyMessage}
        </div>
      );
    }
    return (
      <RepositoryFolderTree
        tree={tree}
        selectedFolderPath={
          searchMode
            ? effectiveSearchFolderPath(runSearchFolderPath, openedRunPath)
            : selectedFolderPath
        }
        onSelectFolder={searchMode ? handleSelectSearchFolderWithRun : handleSelectBrowseFolderWithRun}
        onFolderExpand={searchMode ? undefined : handleRunFolderExpand}
        expanded={searchMode ? runSearchExpanded : folderExpanded}
        onExpandedChange={searchMode ? setRunSearchExpanded : setFolderExpanded}
        creatingRun={showCreateRun}
        onCommitCreateRun={handleCommitCreateRun}
        renamingRunId={renamingRunId}
        onRenameRunCommit={handleRenameRunCommit}
        onRenameRunCancel={handleRenameRunCancel}
        onContextMenuRun={(node, e) => {
          const run = runsForList.find((r) => r.run_id === node.run_id);
          if (!run) return;
          setContextMenuRun(run);
          setContextMenuPos({ x: e.clientX, y: e.clientY });
        }}
        editorLocked
        getFolderContextMenuItems={getRunFolderContextMenuItems}
        pinningEnabled={!searchMode && !openedRunPath}
        pinnedProjectPaths={searchMode || openedRunPath ? null : pinnedProjectPaths}
        onTogglePinProject={searchMode || openedRunPath ? null : togglePin}
        isPinnedProject={searchMode || openedRunPath ? null : isPinned}
        onOpenRun={handleOpenRun}
        openedRunPath={openedRunPath}
        onCloseOpenedRun={handleCloseOpenedRun}
      />
    );
  };

  const visibleSearchRunTree = useMemo(
    () => filterTreeToOpenedRoot(searchUnifiedRunTree, openedRunPath),
    [searchUnifiedRunTree, openedRunPath],
  );

  const activeRunFolderPath = runSearchActive
    ? effectiveSearchFolderPath(runSearchFolderPath, openedRunPath)
    : selectedFolderPath;
  const activeFolderLabel = runSearchActive ? runSearchFolderLabel : folderLabel;
  const activeListRunId = runSearchActive ? runSearchSelectedRunId : selectedRunId;
  const activeListLoading = runSearchActive ? runSearchLoading : browseListLoading;
  const activeSearchListTitle = runSearchActive
    ? activeRunFolderPath
      ? activeFolderLabel
      : "Search results"
    : activeListRunId
      ? activeFolderLabel
      : null;

  const treeColumnBody = runSearchOpen ? (
    <SearchPanel
      searchKeys={runSearchKeys()}
      filterOptions={runFilterOptions}
      onSearch={handleRunSearch}
      onClose={handleCloseRunSearch}
      history={runHistory}
      favorites={runFavorites}
      onToggleFavorite={toggleRunFav}
      isFavorite={isRunFav}
      freeTextSearchKey="q"
      freeTextPlaceholder="Search by case ID, title, run name…"
      resultsInSeparateColumn
      sidebarResultsContent={renderRunFolderTree(
        visibleSearchRunTree,
        "No matching runs found.",
        true,
      )}
    />
  ) : (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {archivedViewOpen ? (
        <HiddenViewBanner
          label="Archived"
          tooltip="Only archived runs are shown. Click the toolbar button to go back to the main list."
        />
      ) : null}
      {renderRunFolderTree(visibleRunTree, runTreeEmptyMessage)}
    </div>
  );

  const caseListColumn = (
    <RunVirtualCaseList
      cases={runSearchActive ? runSearchFolderScopedCases : runCaseListWindow.items}
      total={runSearchActive ? runSearchFolderScopedCases.length : runCaseListWindow.total}
      loading={activeListLoading}
      loadingMore={!runSearchActive && runCaseListWindow.loadingMore}
      hasMore={!runSearchActive && runCaseListWindow.hasMore}
      onLoadMore={runSearchActive ? undefined : runCaseListWindow.loadMore}
      folderPath={activeRunFolderPath}
      listTitle={activeSearchListTitle}
      showNoRunWhenEmpty={!runSearchActive}
      showNoFolderWhenEmpty={false}
      noRunMessage="Select a run"
      noFolderMessage="Select a project or suite"
      emptyMessage={runSearchActive ? "No matching cases found." : "No cases in this folder"}
      selectedCaseFilePath={selectedCaseIdInRun}
      onSelectCase={handleSelectCaseInList}
      defaultRunId={selectedRunId}
      onSetResult={
        archivedViewOpen || readOnly
          ? undefined
          : (runId, filePath, result) => handleSetResult(runId, filePath, result)
      }
      caseSelectionConfig={runCaseSelectionConfig}
      getContextMenuItems={getRunCaseContextMenuItems}
    />
  );

  // Only use full run detail for summary panel; no fallback to list run (avoids showing empty description when switching to Run B before its detail has loaded).
  const runForSummary = runSummaryFromList(selectedRunId, runs, runDetailsByRunId);

  // Same branch order as Review run mode: run vs case mutually exclusive; show case panel only when run detail loaded and selected case is in this run
  const showCasePanel =
    selectedRunId &&
    selectedCaseIdInRun &&
    runDetailForPanel != null &&
    casesForPanel.some((c) => c.file_path === selectedCaseIdInRun);

  const handlePostRunComment = useCallback(
    async (runId, text) => {
      if (readOnly) return;
      const result = await postRunComment(runId, text, activeRepoSlug);
      if (result?.comments) {
        setRunDetailsByRunId((prev) => {
          const existing = prev[runId];
          if (!existing?.run) return prev;
          return {
            ...prev,
            [runId]: { ...existing, run: { ...existing.run, comments: result.comments } },
          };
        });
      }
      onAfterRepoWrite?.();
    },
    [readOnly, activeRepoSlug, onAfterRepoWrite],
  );

  const handlePostRunCaseComment = useCallback(
    async (runId, filePath, text) => {
      if (readOnly) return;
      const result = await postRunCaseComment(runId, filePath, text, activeRepoSlug);
      if (result?.comments) {
        setRunDetailsByRunId((prev) => {
          const existing = prev[runId];
          if (!existing?.cases) return prev;
          return {
            ...prev,
            [runId]: {
              ...existing,
              cases: existing.cases.map((c) =>
                c.file_path === filePath ? { ...c, comments: result.comments } : c,
              ),
            },
          };
        });
      }
      onAfterRepoWrite?.();
    },
    [readOnly, activeRepoSlug, onAfterRepoWrite],
  );

  const handlePatchRunCase = useCallback(
    async (runId, filePath, payload) => {
      if (readOnly) return;
      const updated = await patchRunCase(runId, filePath, payload, activeRepoSlug);
      if (updated?.file_path) {
        setRunDetailsByRunId((prev) => {
          const existing = prev[runId];
          if (!existing?.cases) return prev;
          return {
            ...prev,
            [runId]: {
              ...existing,
              cases: existing.cases.map((c) =>
                c.file_path === filePath ? { ...c, ...updated } : c,
              ),
            },
          };
        });
      }
      onAfterRepoWrite?.();
    },
    [readOnly, activeRepoSlug, onAfterRepoWrite],
  );

  const handleDeleteRunComment = useCallback(
    async (runId, index) => {
      if (readOnly) return;
      const result = await deleteRunComment(runId, index, activeRepoSlug);
      if (result?.comments) {
        setRunDetailsByRunId((prev) => {
          const existing = prev[runId];
          if (!existing?.run) return prev;
          return {
            ...prev,
            [runId]: { ...existing, run: { ...existing.run, comments: result.comments } },
          };
        });
      }
      onAfterRepoWrite?.();
    },
    [readOnly, activeRepoSlug, onAfterRepoWrite],
  );

  const handleDeleteRunCaseComment = useCallback(
    async (runId, filePath, index) => {
      if (readOnly) return;
      const result = await deleteRunCaseComment(runId, filePath, index, activeRepoSlug);
      if (result?.comments) {
        setRunDetailsByRunId((prev) => {
          const existing = prev[runId];
          if (!existing?.cases) return prev;
          return {
            ...prev,
            [runId]: {
              ...existing,
              cases: existing.cases.map((c) =>
                c.file_path === filePath ? { ...c, comments: result.comments } : c,
              ),
            },
          };
        });
      }
      onAfterRepoWrite?.();
    },
    [readOnly, activeRepoSlug, onAfterRepoWrite],
  );

  const detailColumn =
    selectedRunId && selectedCaseIdInRun && runDetailForPanel === undefined ? (
      <DetailPanel>
        <DetailPanelLoading message="Loading run…" />
      </DetailPanel>
    ) : showCasePanel ? (
      <RunCaseDetailPanel
        selectedCaseId={selectedCaseIdInRun}
        runCases={casesForPanel}
        runId={runIdForPanel}
        runAssignedTo={runForSummary?.assigned_to ?? null}
        runCaseContent={runCaseContent}
        reviewEnabled={reviewEnabled}
        readOnly={readOnly}
        repoSlug={activeRepoSlug}
        onPostRunCaseComment={handlePostRunCaseComment}
        onDeleteRunCaseComment={handleDeleteRunCaseComment}
        onPatchRunCase={readOnly ? undefined : handlePatchRunCase}
        gitProfileVersion={gitProfileVersion}
        allUsernames={allUsernames}
        onOpenTicket={onNavigateToTicket}
        onOpenWikiPage={onNavigateToWiki}
      />
    ) : selectedRunId && runForSummary ? (
      <RunSummaryPanel
        run={runForSummary}
        runCases={casesForPanel}
        loading={runDetailForPanel === undefined}
        reviewEnabled={reviewEnabled}
        readOnly={readOnly}
        isEditing={isEditingRunSummary}
        onToggleEdit={readOnly ? undefined : setIsEditingRunSummary}
        onSaveRun={async (payload) => {
          if (readOnly) return;
          const runId = payload?.run_id;
          if (!runId) return;
          await patchRun(runId, payload, activeRepoSlug);
          if (runId === selectedRunId) {
            setRunDetailsByRunId((prev) => {
              const existing = prev[runId];
              if (!existing?.run) return prev;
              return { ...prev, [runId]: { ...existing, run: { ...existing.run, ...payload } } };
            });
          }
          onAfterRepoWrite?.();
        }}
        repoSlug={activeRepoSlug}
        onPostRunComment={handlePostRunComment}
        onDeleteRunComment={handleDeleteRunComment}
        gitProfileVersion={gitProfileVersion}
        allUsernames={allUsernames}
        onOpenTicket={onNavigateToTicket}
        onNavigateToRelease={onNavigateToRelease}
      />
    ) : selectedRunId ? (
      <DetailPanel>
        <DetailPanelLoading message="Loading run…" />
      </DetailPanel>
    ) : (
      <DetailPanel>
        <DetailPanelEmpty
          title="Select a run"
          description="Choose a run to browse its cases, set Pass / Fail / Skip, and view details"
        />
      </DetailPanel>
    );

  if (topMessage) return topMessage;

  return (
    <>
      <TestRepositoryThreeColumnLayout
        storageKeys={RUN_STORAGE_KEYS}
        treeColumn={
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
              <SidebarSection
                title="Test runs"
                titleRight={sidebarTitleRight}
                toolbar={runToolbar}
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

      {error && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Add cases modal only when full-page picker not used (onOpenAddCasesToRun not provided) */}
      {addCasesModalOpen && !onOpenAddCasesToRun && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" aria-hidden onClick={() => setAddCasesModalOpen(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-ui border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Add cases from repo</h2>
              <button type="button" onClick={() => setAddCasesModalOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto p-4">
              {addCasesLoading && !repoCases.length ? (
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" />
              ) : (
                <ul className="space-y-1">
                  {repoCases.map((c) => (
                    <li key={c.file_path} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedCasePaths.has(c.file_path)}
                        onChange={() => toggleCaseForAdd(c.file_path)}
                        className="rounded border-slate-300"
                      />
                      <span className="truncate text-sm text-slate-800 dark:text-slate-200">
                        {c.case_id} · {c.file_path}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
              <button type="button" onClick={() => setAddCasesModalOpen(false)} className="rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button type="button" onClick={handleAddCases} disabled={addCasesLoading || selectedCasePaths.size === 0} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Add {selectedCasePaths.size} case{selectedCasePaths.size !== 1 ? "s" : ""}</button>
            </div>
          </div>
        </>
      )}

      {contextMenuRun && (
        <ContextMenu
          open
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          onClose={() => setContextMenuRun(null)}
          items={
            archivedViewOpen || contextMenuRun.archived
              ? [
                  {
                    icon: RotateCcw,
                    label: "Restore run",
                    onClick: () => {
                      handleRestoreRun(contextMenuRun);
                      setContextMenuRun(null);
                    },
                  },
                  {
                    icon: Trash2,
                    label: "Delete permanently",
                    variant: "danger",
                    onClick: () => {
                      handleDeleteRun(contextMenuRun);
                      setContextMenuRun(null);
                    },
                  },
                ]
              : [
                  ...(openedRunPath !== runTreePathForRunId(contextMenuRun.run_id)
                    ? [
                        {
                          icon: FolderOpen,
                          label: "Open Run",
                          hint: "Double-click",
                          onClick: () => {
                            handleOpenRun(runTreePathForRunId(contextMenuRun.run_id));
                            setContextMenuRun(null);
                          },
                        },
                      ]
                    : []),
                  {
                    icon: Plus,
                    label: "Add cases",
                    onClick: () => {
                      setSelectedRunId(contextMenuRun.run_id);
                      if (onOpenAddCasesToRun) {
                        onOpenAddCasesToRun(contextMenuRun.run_id, contextMenuRun.name);
                      } else {
                        openAddCasesModal();
                      }
                    },
                    disabled: caseFilesDirty,
                    title: caseFilesDirty ? "Save case changes first" : undefined,
                  },
                  {
                    icon: Pencil,
                    label: "Rename run",
                    onClick: () => startRenameRun(contextMenuRun),
                  },
                  {
                    icon: Archive,
                    label: contextMenuRun.archived ? "Unarchive" : "Archive",
                    onClick: () => handleArchiveRun(contextMenuRun, !contextMenuRun.archived),
                  },
                  { type: "separator" },
                  {
                    icon: Copy,
                    label: "Copy",
                    onClick: () => openDuplicateModal(contextMenuRun),
                  },
                ]
          }
        />
      )}

      {/* Duplicate run modal */}
      {duplicateModalRun && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" aria-hidden onClick={() => { setDuplicateModalRun(null); setDuplicateName(""); setDuplicateDesc(""); }} />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-ui border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Copy run</h2>
              <button type="button" onClick={() => { setDuplicateModalRun(null); setDuplicateName(""); setDuplicateDesc(""); }} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Create a new run with the same cases as &quot;{duplicateModalRun.name}&quot;. Results are not copied.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                <input
                  type="text"
                  value={duplicateName}
                  onChange={(e) => setDuplicateName(e.target.value)}
                  placeholder="e.g. My run (copy)"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description (optional)</label>
                <input
                  type="text"
                  value={duplicateDesc}
                  onChange={(e) => setDuplicateDesc(e.target.value)}
                  placeholder="Brief description"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
              <button type="button" onClick={() => { setDuplicateModalRun(null); setDuplicateName(""); setDuplicateDesc(""); }} className="rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button type="button" onClick={handleDuplicateRun} disabled={!duplicateName.trim() || duplicateLoading} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {duplicateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create copy"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create run modal — Step 1: name/desc, Step 2: projects, Step 3: tree + cases */}
      {createModalOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" aria-hidden onClick={() => { setCreateModalOpen(false); setCreateStep(1); }} />
          <div className={`fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-ui border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900 ${createStep === 3 ? "max-w-4xl" : "max-w-md"}`}>
            {createStep === 1 && (
              <>
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">New test run — Step 1</h2>
                  <button type="button" onClick={() => setCreateModalOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4 p-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                    <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="e.g. Release test 2025-02" className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description (optional)</label>
                    <input type="text" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="Brief description" className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
                  <button type="button" onClick={() => setCreateModalOpen(false)} className="rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                  <button type="button" onClick={handleCreateRunNext} disabled={!createName.trim()} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Next</button>
                </div>
              </>
            )}
            {createStep === 2 && (
              <>
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Select projects — Step 2</h2>
                  <button type="button" onClick={handleCreateStepBackTo1} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="h-5 w-5" /></button>
                </div>
                <div className="max-h-80 overflow-y-auto p-4">
                  <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">Choose one or more projects to pick test cases from.</p>
                  <ul className="space-y-2">
                    {dashboardProjects.map((p) => (
                      <li key={p.project_path} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedProjectPaths.has(p.project_path)}
                          onChange={() => {
                            setSelectedProjectPaths((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.project_path)) next.delete(p.project_path);
                              else next.add(p.project_path);
                              return next;
                            });
                          }}
                          className="rounded border-slate-300"
                        />
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{p.project_name ?? p.project_path}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{p.project_path}</span>
                      </li>
                    ))}
                  </ul>
                  {!dashboardProjects.length && <p className="text-sm text-slate-500 dark:text-slate-400">No projects found. Add test project folders in Repository first.</p>}
                </div>
                <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
                  <button type="button" onClick={handleCreateStepBackTo1} className="rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Back</button>
                  <button type="button" onClick={handleCreateStep2Next} disabled={selectedProjectPaths.size === 0} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Next</button>
                </div>
              </>
            )}
            {createStep === 3 && (
              <>
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Select test cases — Step 3</h2>
                  <button type="button" onClick={handleCreateStepBackTo2} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="h-5 w-5" /></button>
                </div>
                <div className="flex max-h-[70vh] min-h-[320px]">
                  <div className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 dark:border-slate-700">
                    {(() => {
                      const filtered = filterTreeByProjects(repoTree, Array.from(selectedProjectPaths));
                      const renderNode = (node, depth = 0) => {
                        const path = node.directory_path ?? "";
                        const hasChildren = node.children?.length > 0;
                        const isProject = Boolean(node.is_project) || isProjectDirectoryPath(path);
                        const canExpand = hasChildren || isProject;
                        const expanded = createTreeExpanded.has(path);
                        const structureLoading = createTreeStructureLoading.has(path);
                        const selected = createFolderPath === path;
                        return (
                          <div key={path || "root"} style={{ paddingLeft: depth * 12 }}>
                            <button type="button" onClick={() => setCreateFolderPath(path || null)} className={`flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm ${selected ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                              {canExpand ? (
                                <button type="button" onClick={(e) => { e.stopPropagation(); handleCreateTreeToggle(path); }} className="shrink-0 p-0.5">
                                  {structureLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                  ) : expanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              ) : <span className="w-5 shrink-0" />}
                              {expanded || !canExpand ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" /> : <Folder className="h-4 w-4 shrink-0 text-amber-500" />}
                              <span className="min-w-0 truncate">{node.display_name ?? node.name ?? (path || "Root")}</span>
                            </button>
                            {canExpand && expanded && hasChildren && node.children.map((child) => renderNode(child, depth + 1))}
                          </div>
                        );
                      };
                      return (
                        <div className="py-2">
                          <button type="button" onClick={() => setCreateFolderPath(null)} className={`mx-2 flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm ${createFolderPath === null ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                            <Folder className="h-4 w-4 shrink-0 text-amber-500" /> All selected projects
                          </button>
                          {filtered.map((node) => renderNode(node, 0))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
                      <label className="text-sm text-slate-600 dark:text-slate-400">Tag:</label>
                      <select value={createTagFilter} onChange={(e) => setCreateTagFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        <option value="">All</option>
                        {(filterOptions?.tags ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                      {createCasesLoading ? <Loader2 className="mx-auto mt-4 h-8 w-8 animate-spin text-slate-400" /> : (
                        <ul className="space-y-1">
                          {createStepCases.map((c) => (
                            <li key={c.file_path} className="flex items-center gap-2">
                              <input type="checkbox" checked={isCaseSelectedForCreate(c.file_path)} onChange={() => toggleCaseForCreate(c)} className="rounded border-slate-300" />
                              <span className="truncate text-sm text-slate-800 dark:text-slate-200">{c.case_id ?? c.file_path}</span>
                              <span className="truncate text-xs text-slate-500 dark:text-slate-400">{c.file_path}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!createCasesLoading && !createStepCases.length && <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">No cases in this folder. Select a folder or change the tag.</p>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
                  <span className="text-sm text-slate-500 dark:text-slate-400">{selectedCasesForCreate.length} case{selectedCasesForCreate.length !== 1 ? "s" : ""} selected</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleCreateStepBackTo2} className="rounded px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">Back</button>
                    <button type="button" onClick={handleConfirmCreateRun} disabled={addCasesLoading} className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">Create run</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default TestRun;
