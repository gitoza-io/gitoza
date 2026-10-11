import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSortedRuns } from "../hooks/useSortedRuns";
import {
  AlertTriangle,
  Check,
  File,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import {
  approveCase,
  approveRun,
  getCaseDetail,
  getRepositoryTree,
  getRunCaseContent,
  listRuns,
  patchRun,
  patchRunCase,
  postRunComment,
  postRunCaseComment,
  deleteRunComment,
  deleteRunCaseComment,
} from "../services/api";
import { fetchAllCases } from "../utils/caseQuery";
import {
  buildCaseTree,
  findFolderDisplayName,
  getRecursiveCasesInFolder,
  pruneEmptyNodes,
} from "../utils/caseTree";
import {
  buildUnifiedRunTree,
  buildUnifiedRunTreeFromSearchResults,
  findRunFolderDisplayName,
  parseRunTreePath,
  runSummaryFromList,
} from "../utils/runCaseTree";
import { useRunBrowseState, REVIEW_LAST_FOLDER_KEY } from "../hooks/useRunBrowseState";
import { useLazyRunBrowse } from "../hooks/useLazyRunBrowse";
import { useRunCaseListWindow } from "../hooks/useRunCaseListWindow";
import { useRunCaseSearchResults } from "../hooks/useRunCaseSearchResults";
import { useRunSearchBrowseState } from "../hooks/useRunSearchBrowseState";
import { usePickerBrowseState } from "../hooks/usePickerBrowseState";
import { useCaseListWindow } from "../hooks/useCaseListWindow";
import { useSearchFolderTree } from "../hooks/useSearchFolderTree";
import ApproveStatusBadge from "../components/ApproveStatusBadge";
import RepositoryFolderTree from "../components/RepositoryFolderTree";
import RepositoryVirtualCaseList from "../components/RepositoryVirtualCaseList";
import RunVirtualCaseList from "../components/RunVirtualCaseList";
import SidebarSection from "../components/SidebarSection";
import TestRepositoryThreeColumnLayout from "../components/TestRepositoryThreeColumnLayout";
import DetailPanel from "../components/DetailPanel";
import RunSummaryPanel from "../components/RunSummaryPanel";
import { SidebarEmpty, SidebarLoading } from "../components/SidebarSection";
import TreeToolbar from "../components/TreeToolbar";
import SearchPanel from "../components/SearchPanel";
import SearchToggleButton from "../components/SearchToggleButton";
import CaseDetailView from "../components/CaseDetailView";
import PageMessage from "../components/PageMessage";
import DetailPanelEmpty from "../components/DetailPanelEmpty";
import DetailPanelLoading from "../components/DetailPanelLoading";
import RunCaseDetailPanel from "../components/RunCaseDetailPanel";
import { TestRunIcon, TestCaseIcon } from "../components/TestEntityIcons";
import { useRefetchWhenActive } from "../components/PersistentView";
import { subscribeRefresh } from "../services/wsRefresh";
import { useFetchedContent } from "../hooks/useFetchedContent";
import { useSearchPrefs } from "../hooks/useSearchPrefs";
import { CASE_SEARCH_KEYS, runSearchKeys } from "../constants/searchKeys";
import {
  hydrateSearchRunCaseSelection,
  resolveRunIdForCaseSelection,
} from "../utils/hydrateSearchRunCaseSelection";

const REVIEW_STORAGE_KEYS = {
  treeWidth: "review.col.treeWidth",
  listWidth: "review.col.listWidth",
};

function Review({
  activeRepoSlug,
  filterOptions = {},
  runFilterOptions = {},
  workspaceDisplayName,
  onAfterApprove,
  sidebarFooter,
  sidebarTitleRight,
  repositoryTree: repositoryTreeProp = [],
  readOnly = false,
  gitProfileVersion = 0,
  allUsernames = null,
  onNavigateToTicket = null,
  onNavigateToWiki = null,
}) {
  const [listMode, setListMode] = useState("run"); // "run" | "case"
  const [cases, setCases] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedCase, setSelectedCase] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const reviewHasDataRef = useRef(false);

  const [reviewSearchOpen, setReviewSearchOpen] = useState(false);
  const [reviewSearchChips, setReviewSearchChips] = useState([]);
  const [runSearchRefreshKey, setRunSearchRefreshKey] = useState(0);
  const runPrefs = useSearchPrefs("review_run");
  const casePrefs = useSearchPrefs("review_case");

  // Case mode: tree structure (project → suite → case)
  const [localTree, setLocalTree] = useState([]);
  // Run mode: same shape as TestRun for list + detail
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedCaseIdInRun, setSelectedCaseIdInRun] = useState(null);
  const {
    runDetailsByRunId,
    setRunDetailsByRunId,
    runFolderTreeByRunId,
    headerLoadingRunId,
    ensureRunHeaderLoaded,
    loadRunHeader,
    loadRunProjectNodes,
    loadRunFolderSubtree,
    loadRunCaseComments,
    invalidateRunCasesCache,
    mergeCasesIntoRunCache,
  } = useLazyRunBrowse(activeRepoSlug);
  const [isEditingRunSummary, setIsEditingRunSummary] = useState(false);
  const runCaseListWindowRef = useRef(null);
  const listModeRef = useRef(listMode);
  listModeRef.current = listMode;
  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;
  const selectedCaseIdInRunRef = useRef(selectedCaseIdInRun);
  selectedCaseIdInRunRef.current = selectedCaseIdInRun;
  const reviewSearchChipsRef = useRef(reviewSearchChips);
  reviewSearchChipsRef.current = reviewSearchChips;

  useEffect(() => {
    if (readOnly) setIsEditingRunSummary(false);
  }, [readOnly]);

  const caseDetailKey = selectedCase?.file_path ?? null;
  const fetchCaseDetail = useCallback(() => {
    if (!caseDetailKey) return Promise.resolve(null);
    return getCaseDetail(caseDetailKey, activeRepoSlug ?? null);
  }, [caseDetailKey, activeRepoSlug]);
  const [caseDetailContent, caseDetailContentKey] = useFetchedContent(caseDetailKey, fetchCaseDetail);

  const runCaseSelectionKey =
    selectedRunId && selectedCaseIdInRun ? `${selectedRunId}\0${selectedCaseIdInRun}` : null;
  const fetchRunCaseContent = useCallback(() => {
    if (!selectedRunId || !selectedCaseIdInRun) return Promise.resolve(null);
    return getRunCaseContent(selectedRunId, selectedCaseIdInRun, activeRepoSlug ?? null);
  }, [selectedRunId, selectedCaseIdInRun, activeRepoSlug]);
  const [runCaseContent] = useFetchedContent(runCaseSelectionKey, fetchRunCaseContent);

  const loadCases = useCallback(async () => {
    if (!activeRepoSlug) return;
    try {
      const data = await fetchAllCases(activeRepoSlug, { approve_status: "draft" });
      setCases(Array.isArray(data) ? data : []);
    } catch (e) {
      setCases([]);
    }
  }, [activeRepoSlug]);

  const loadRuns = useCallback(async () => {
    if (!activeRepoSlug) return;
    try {
      const data = await listRuns(activeRepoSlug, { includeArchived: false });
      setRuns(Array.isArray(data) ? data : []);
    } catch (e) {
      setRuns([]);
    }
  }, [activeRepoSlug]);

  const load = useCallback(async () => {
    if (!activeRepoSlug) {
      setCases([]);
      setRuns([]);
      reviewHasDataRef.current = false;
      setLoading(false);
      return;
    }
    if (!reviewHasDataRef.current) setLoading(true);
    setError("");
    try {
      await Promise.all([loadCases(), loadRuns()]);
      reviewHasDataRef.current = true;
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load review data");
      reviewHasDataRef.current = true;
    } finally {
      setLoading(false);
    }
  }, [activeRepoSlug, loadCases, loadRuns]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const loadRunHeaderRef = useRef(loadRunHeader);
  loadRunHeaderRef.current = loadRunHeader;
  const invalidateRunCasesCacheRef = useRef(invalidateRunCasesCache);
  invalidateRunCasesCacheRef.current = invalidateRunCasesCache;
  const loadRunProjectNodesRef = useRef(loadRunProjectNodes);
  loadRunProjectNodesRef.current = loadRunProjectNodes;
  const loadRunCaseCommentsRef = useRef(loadRunCaseComments);
  loadRunCaseCommentsRef.current = loadRunCaseComments;

  /** Stable identity — must not depend on loadRunProjectNodes (tied to folder tree state). */
  const refreshFromBackend = useCallback(() => {
    void loadRef.current();
    if (listModeRef.current === "run" && (reviewSearchChipsRef.current?.length ?? 0) > 0) {
      setRunSearchRefreshKey((k) => k + 1);
    }
    if (listModeRef.current !== "run") return;
    const runId = selectedRunIdRef.current;
    if (!runId) return;

    void loadRunHeaderRef.current(runId);
    invalidateRunCasesCacheRef.current(runId);
    void loadRunProjectNodesRef.current(runId);
    runCaseListWindowRef.current?.invalidateForRun(runId);
    const casePath = selectedCaseIdInRunRef.current;
    if (casePath) void loadRunCaseCommentsRef.current(runId, casePath);
  }, []);

  useRefetchWhenActive(refreshFromBackend);
  useEffect(() => subscribeRefresh(() => refreshFromBackend()), [refreshFromBackend]);

  const runsByCreated = useSortedRuns(runs, "created");
  const draftRuns = useMemo(
    () => runsByCreated.filter((r) => (r.approve_status || "draft").toLowerCase() === "draft"),
    [runsByCreated],
  );

  const runSearchActive = listMode === "run" && reviewSearchChips.length > 0;
  const runSearchResetKey = useMemo(
    () =>
      (reviewSearchChips ?? [])
        .map((c) => `${c.key}:${c.value ?? ""}`)
        .join("|"),
    [reviewSearchChips],
  );

  const { results: runSearchCases, loading: runSearchLoading } = useRunCaseSearchResults(
    activeRepoSlug,
    reviewSearchChips,
    { enabled: runSearchActive, refreshKey: runSearchRefreshKey },
  );

  const searchMatchingRuns = useMemo(() => {
    if (!runSearchActive) return [];
    const ids = new Set(runSearchCases.map((c) => c.run_id));
    return draftRuns.filter((r) => ids.has(r.run_id));
  }, [runSearchActive, runSearchCases, draftRuns]);

  const searchUnifiedRunTree = useMemo(
    () => buildUnifiedRunTreeFromSearchResults(searchMatchingRuns, runSearchCases),
    [searchMatchingRuns, runSearchCases],
  );

  const {
    searchFolderPath: runSearchFolderPath,
    searchExpanded: runSearchExpanded,
    setSearchExpanded: setRunSearchExpanded,
    folderScopedCases: runSearchFolderScopedCases,
    selectedRunId: runSearchSelectedRunId,
    folderLabel: runSearchFolderLabel,
    handleSelectSearchFolder,
  } = useRunSearchBrowseState({
    searchTree: searchUnifiedRunTree,
    matchingCases: runSearchCases,
    searchActive: runSearchActive,
    searchResetKey: runSearchResetKey,
  });

  const filteredCases = useMemo(() => {
    const hasApproveStatusChip = reviewSearchChips.some((ch) => ch.key === "approve_status");
    let list = cases;
    if (!hasApproveStatusChip) {
      list = cases.filter((c) => (c.approve_status || "draft").toLowerCase() === "draft");
    }
    if (reviewSearchChips.length === 0) return list;
    return list.filter((c) =>
      reviewSearchChips.every((chip) => {
        const v = chip.value.toLowerCase();
        switch (chip.key) {
          case "q":
            return (
              (c.case_id || "").toLowerCase().includes(v) ||
              (c.title || "").toLowerCase().includes(v) ||
              (c.file_path || "").toLowerCase().includes(v) ||
              (c.tags || []).some((t) => t.toLowerCase().includes(v))
            );
          case "caseID": return (c.case_id || "").toLowerCase().includes(v);
          case "title": return (c.title || "").toLowerCase().includes(v);
          case "tag": return (c.tags || []).some((t) => t.toLowerCase() === v);
          case "status": return (c.status || "").toLowerCase() === v;
          case "priority": return (c.priority || "").toLowerCase() === v;
          case "approve_status": return (c.approve_status || "draft").toLowerCase() === v;
          case "updated_by": return (c.updated_by || "").toLowerCase().includes(v);
          default: return true;
        }
      }),
    );
  }, [cases, reviewSearchChips]);

  // Case tree: use repositoryTreeProp from App; fetch locally if not available
  const caseTree = repositoryTreeProp.length > 0 ? repositoryTreeProp : localTree;
  useEffect(() => {
    if (repositoryTreeProp.length > 0 || !activeRepoSlug) return;
    let cancelled = false;
    getRepositoryTree({ depth: "projects", repoSlug: activeRepoSlug })
      .then((data) => { if (!cancelled) setLocalTree(Array.isArray(data) ? data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeRepoSlug, repositoryTreeProp.length]);

  const casePickerTree = useMemo(() => {
    const tw = buildCaseTree(caseTree, filteredCases);
    return pruneEmptyNodes(tw);
  }, [caseTree, filteredCases]);

  const caseSearchActive = listMode === "case" && reviewSearchChips.length > 0;
  const caseSearchResetKey = useMemo(
    () =>
      (reviewSearchChips ?? [])
        .map((c) => `${c.key}:${c.value ?? ""}`)
        .join("|"),
    [reviewSearchChips],
  );

  const {
    searchTree: caseSearchTree,
    searchFolderPath: caseSearchFolderPath,
    searchExpanded: caseSearchExpanded,
    setSearchExpanded: setCaseSearchExpanded,
    handleSelectSearchFolder: handleSelectCaseSearchFolder,
  } = useSearchFolderTree({
    apiTree: caseTree,
    rows: filteredCases,
    searchActive: caseSearchActive,
    searchResetKey: caseSearchResetKey,
  });

  const {
    selectedFolderPath: caseFolderPath,
    expanded: caseFolderExpanded,
    setExpanded: setCaseFolderExpanded,
    handleSelectBrowseFolder: handleSelectCaseFolder,
  } = usePickerBrowseState({
    tree: caseSearchActive ? caseSearchTree : casePickerTree,
    selectedCaseFilePath: selectedCase?.file_path,
    searchOpen: reviewSearchOpen && listMode === "case",
    searchActive: caseSearchActive,
    enabled: listMode === "case" && !loading,
  });

  const caseFolderTree = caseSearchActive ? caseSearchTree : casePickerTree;
  const activeCaseFolderPath = caseSearchActive ? caseSearchFolderPath : caseFolderPath;

  const caseListTitle = useMemo(() => {
    if (listMode !== "case") return null;
    if (caseSearchActive && !caseSearchFolderPath) return "Search results";
    const path = activeCaseFolderPath;
    if (path) return findFolderDisplayName(caseFolderTree, path);
    return caseSearchActive ? "Search results" : null;
  }, [listMode, caseSearchActive, caseSearchFolderPath, activeCaseFolderPath, caseFolderTree]);

  const reviewCaseListChips = useMemo(() => {
    const draftChip = { key: "approve_status", value: "draft" };
    const hasApproveChip = reviewSearchChips.some((c) => c.key === "approve_status");
    if (!caseSearchActive) return [draftChip];
    if (hasApproveChip) return reviewSearchChips;
    return [...reviewSearchChips, draftChip];
  }, [caseSearchActive, reviewSearchChips]);

  const caseListWindowEnabled = useMemo(() => {
    if (listMode !== "case" || loading) return false;
    if (reviewSearchOpen && listMode === "case") return caseSearchActive;
    return Boolean(caseFolderPath);
  }, [listMode, loading, reviewSearchOpen, caseSearchActive, caseFolderPath]);

  const caseListWindow = useCaseListWindow({
    repoSlug: activeRepoSlug,
    folderPath: activeCaseFolderPath,
    searchChips: reviewCaseListChips,
    enabled: caseListWindowEnabled,
  });

  useEffect(() => {
    if (listMode !== "run" || !selectedRunId) return;
    if (runDetailsByRunId[selectedRunId] !== undefined) {
      if (runFolderTreeByRunId[selectedRunId] === undefined) {
        loadRunProjectNodes(selectedRunId);
      }
      return;
    }
    ensureRunHeaderLoaded(selectedRunId);
    if (runFolderTreeByRunId[selectedRunId] === undefined) {
      loadRunProjectNodes(selectedRunId);
    }
  }, [
    listMode,
    selectedRunId,
    runDetailsByRunId,
    runFolderTreeByRunId,
    ensureRunHeaderLoaded,
    loadRunProjectNodes,
  ]);

  const runDetailForPanel = selectedRunId ? runDetailsByRunId[selectedRunId] : undefined;
  const runCasesForPanel = runDetailForPanel?.cases ?? [];

  const unifiedRunTree = useMemo(
    () => buildUnifiedRunTree(draftRuns, runDetailsByRunId, runFolderTreeByRunId),
    [draftRuns, runDetailsByRunId, runFolderTreeByRunId],
  );

  const {
    selectedFolderPath: runFolderPath,
    expanded: runFolderExpanded,
    setExpanded: setRunFolderExpanded,
    handleSelectBrowseFolder: handleSelectRunFolder,
  } = useRunBrowseState({
    tree: unifiedRunTree,
    selectedRunId,
    selectedCaseFilePath: selectedCaseIdInRun,
    searchOpen: reviewSearchOpen && listMode === "run",
    enabled: listMode === "run" && !loading && draftRuns.length > 0,
    lastFolderStorageKey: REVIEW_LAST_FOLDER_KEY,
  });

  const handleRunCasesFetched = useCallback(
    (runId, items) => {
      mergeCasesIntoRunCache(runId, items);
    },
    [mergeCasesIntoRunCache],
  );

  const runCaseListWindow = useRunCaseListWindow({
    runId: selectedRunId,
    folderPath: runFolderPath,
    repoSlug: activeRepoSlug,
    enabled: listMode === "run" && !runSearchActive && Boolean(selectedRunId && runFolderPath),
    onItemsFetched: handleRunCasesFetched,
  });
  runCaseListWindowRef.current = runCaseListWindow;

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

  const handleSelectRunFolderWithRun = useCallback(
    (path) => {
      if (!path) return;
      handleSelectRunFolder(path);
      const parsed = parseRunTreePath(path);
      if (!parsed?.runId) return;
      if (parsed.runId !== selectedRunId) {
        setSelectedRunId(parsed.runId);
        setSelectedCaseIdInRun(null);
        setIsEditingRunSummary(false);
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
      handleSelectRunFolder,
      selectedRunId,
      runDetailsByRunId,
      runFolderTreeByRunId,
      ensureRunHeaderLoaded,
      loadRunProjectNodes,
    ],
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
    if (listMode !== "run" || reviewSearchOpen || !runFolderPath) return;
    const parsed = parseRunTreePath(runFolderPath);
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
    listMode,
    runFolderPath,
    selectedRunId,
    reviewSearchOpen,
    runDetailsByRunId,
    runFolderTreeByRunId,
    ensureRunHeaderLoaded,
    loadRunProjectNodes,
  ]);

  useEffect(() => {
    if (listMode !== "run" || !selectedRunId || !selectedCaseIdInRun) return;
    loadRunCaseComments(selectedRunId, selectedCaseIdInRun);
  }, [listMode, selectedRunId, selectedCaseIdInRun, loadRunCaseComments]);

  const runFolderLabel = findRunFolderDisplayName(unifiedRunTree, runFolderPath);
  const hasListRunFallback = Boolean(
    runSummaryFromList(selectedRunId, draftRuns, runDetailsByRunId),
  );
  const runDetailLoading = Boolean(
    selectedRunId && runDetailForPanel === undefined && !hasListRunFallback,
  );

  const browseListLoading =
    runDetailLoading ||
    (headerLoadingRunId === selectedRunId && !runFolderPath && !hasListRunFallback) ||
    (Boolean(runFolderPath) && runCaseListWindow.loading && runCaseListWindow.items.length === 0);

  const handleSelectCaseFromRun = useCallback((runId, c) => {
    setSelectedRunId(runId);
    setSelectedCaseIdInRun(c?.file_path ?? null);
    if (runId && runDetailsByRunId[runId] === undefined) {
      ensureRunHeaderLoaded(runId);
    }
  }, [ensureRunHeaderLoaded, runDetailsByRunId]);

  const handleOpenCase = useCallback((row) => {
    setSelectedCase(row);
  }, []);

  const handleSelectRunCaseInList = useCallback(
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

      handleSelectCaseFromRun(runId, c);
    },
    [
      runSearchActive,
      runSearchSelectedRunId,
      selectedRunId,
      runSearchCases,
      ensureRunHeaderLoaded,
      setRunDetailsByRunId,
      handleSelectCaseFromRun,
    ],
  );

  /** Shared approve/reject: only the write call (approveCase vs approveRun) branches. */
  const handleSetApproval = async (entityType, entityId, status) => {
    if (readOnly) return;
    setActionLoading(true);
    try {
      if (entityType === "case") {
        await approveCase(entityId, status, activeRepoSlug);
      } else {
        await approveRun(entityId, status, activeRepoSlug);
      }
      onAfterApprove?.();
      if (entityType === "case") {
        caseListWindow.patchLocal({ remove: [entityId] });
        await loadCases();
        setSelectedCase(null);
      } else {
        await loadRuns();
        setSelectedRunId(null);
        setSelectedCaseIdInRun(null);
      }
    } catch (e) {
      const action = status === "approved" ? "approve" : "reject";
      const label = entityType === "case" ? "case" : "run";
      setError(e?.response?.data?.detail || e?.message || `Failed to ${action} ${label}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveCase = () => {
    if (!selectedCase?.file_path) return;
    handleSetApproval("case", selectedCase.file_path, "approved");
  };

  const handleRejectCase = () => {
    if (!selectedCase?.file_path) return;
    handleSetApproval("case", selectedCase.file_path, "rejected");
  };

  const handleApproveRun = (runId) => {
    handleSetApproval("run", runId, "approved");
  };

  const handleRejectRun = (runId) => {
    handleSetApproval("run", runId, "rejected");
  };

  const handleApproveCaseFromList = (e, row) => {
    e.stopPropagation();
    handleSetApproval("case", row.file_path, "approved");
  };

  const handleRejectCaseFromList = (e, row) => {
    e.stopPropagation();
    handleSetApproval("case", row.file_path, "rejected");
  };

  const handleBulkCaseApproval = useCallback(
    async (filePaths, status) => {
      if (readOnly || !activeRepoSlug || !filePaths?.length) return;
      setActionLoading(true);
      setError("");
      const pathSet = new Set(filePaths);
      try {
        for (const fp of filePaths) {
          await approveCase(fp, status, activeRepoSlug);
        }
        onAfterApprove?.();
        caseListWindow.patchLocal({ remove: filePaths });
        await loadCases();
        if (selectedCase?.file_path && pathSet.has(selectedCase.file_path)) {
          setSelectedCase(null);
        }
      } catch (e) {
        const action = status === "approved" ? "approve" : "reject";
        setError(e?.response?.data?.detail || e?.message || `Failed to ${action} case`);
        caseListWindow.invalidate();
        await loadCases();
      } finally {
        setActionLoading(false);
      }
    },
    [
      readOnly,
      activeRepoSlug,
      loadCases,
      onAfterApprove,
      selectedCase,
      caseListWindow.patchLocal,
      caseListWindow.invalidate,
    ],
  );

  const getReviewCaseFolderContextMenuItems = useCallback(
    (node, closeMenu) => {
      if (readOnly || actionLoading || node?.is_run) return [];
      const directoryPath = node?.directory_path;
      if (!directoryPath) return [];
      const filePaths = getRecursiveCasesInFolder(filteredCases, directoryPath)
        .map((c) => c.file_path)
        .filter(Boolean);
      if (filePaths.length === 0) return [];
      const isProject = node.is_project === true;
      const bulkSuffix = ` (${filePaths.length})`;
      const approveLabel = isProject ? `Approve project${bulkSuffix}` : `Approve suite${bulkSuffix}`;
      const rejectLabel = isProject ? `Reject project${bulkSuffix}` : `Reject suite${bulkSuffix}`;
      return [
        {
          icon: Check,
          label: approveLabel,
          onClick: () => {
            handleBulkCaseApproval(filePaths, "approved");
            closeMenu(null);
          },
        },
        { type: "separator" },
        {
          icon: XCircle,
          label: rejectLabel,
          variant: "danger",
          onClick: () => {
            handleBulkCaseApproval(filePaths, "rejected");
            closeMenu(null);
          },
        },
      ];
    },
    [readOnly, actionLoading, filteredCases, handleBulkCaseApproval],
  );

  const handleApproveRunFromList = (e, run) => {
    e.stopPropagation();
    handleApproveRun(run.run_id);
  };

  const handleRejectRunFromList = (e, run) => {
    e.stopPropagation();
    handleRejectRun(run.run_id);
  };

  const noWorkspaceSelected = !activeRepoSlug;

  const handleReviewSearch = useCallback((chips) => {
    if (chips.length > 0) {
      const prefs = listMode === "run" ? runPrefs : casePrefs;
      prefs.pushHistory(chips);
    }
    setReviewSearchChips(chips);
  }, [listMode, runPrefs, casePrefs]);

  const handleCloseReviewSearch = useCallback(() => {
    const folderFromSearch = listMode === "run" ? runSearchFolderPath : null;
    setReviewSearchChips([]);
    setReviewSearchOpen(false);
    if (folderFromSearch) {
      handleSelectRunFolderWithRun(folderFromSearch);
    }
  }, [listMode, runSearchFolderPath, handleSelectRunFolderWithRun]);

  const reviewSearchButton = (
    <SearchToggleButton
      isOpen={reviewSearchOpen}
      hasActiveChips={reviewSearchChips.length > 0}
      onClick={() =>
        reviewSearchOpen ? handleCloseReviewSearch() : setReviewSearchOpen(true)
      }
      ariaLabelWhenClosed="Filter"
    />
  );

  const reviewToolbar = (
    <>
      <TreeToolbar
        tabs={[
          { id: "run", label: "Test Run", icon: <FlaskConical className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />, iconOnly: true },
          { id: "case", label: "Test Case", icon: <File className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />, iconOnly: true },
        ]}
        activeTabId={listMode}
        onTabChange={(id) => { setListMode(id); setReviewSearchChips([]); }}
        sortButton={null}
        searchNode={reviewSearchButton}
        onBeforeAction={reviewSearchOpen ? handleCloseReviewSearch : undefined}
      />
      {error && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}
    </>
  );

  const approveRejectRunButtons = (run) => (
    <span className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={(e) => handleApproveRunFromList(e, run)}
        disabled={readOnly || actionLoading}
        className="rounded bg-blue-600 px-1.5 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        title="Approve"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => handleRejectRunFromList(e, run)}
        disabled={readOnly || actionLoading}
        className="rounded border border-red-300 bg-white px-1.5 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-slate-800 dark:text-red-400"
        title="Reject"
      >
        <XCircle className="h-3 w-3" />
      </button>
    </span>
  );

  const approveRejectCaseButtons = (row) => (
    <span className="flex shrink-0 gap-1">
      <button
        type="button"
        onClick={(e) => handleApproveCaseFromList(e, row)}
        disabled={readOnly || actionLoading}
        className="rounded bg-blue-600 px-1.5 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        title="Approve"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => handleRejectCaseFromList(e, row)}
        disabled={readOnly || actionLoading}
        className="rounded border border-red-300 bg-white px-1.5 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-slate-800 dark:text-red-400"
        title="Reject"
      >
        <XCircle className="h-3 w-3" />
      </button>
    </span>
  );

  const runTreeEmptyMessage = runSearchActive
    ? "No matching runs."
    : "No runs pending review.";

  const renderRunFolderTree = (tree, searchMode = false) => {
    if (loading || (searchMode && runSearchLoading)) return <SidebarLoading />;
    if (!tree.length) {
      return <SidebarEmpty message={runTreeEmptyMessage} />;
    }
    return (
      <RepositoryFolderTree
        tree={tree}
        selectedFolderPath={searchMode ? runSearchFolderPath : runFolderPath}
        onSelectFolder={searchMode ? handleSelectSearchFolderWithRun : handleSelectRunFolderWithRun}
        onFolderExpand={searchMode ? undefined : handleRunFolderExpand}
        expanded={searchMode ? runSearchExpanded : runFolderExpanded}
        onExpandedChange={searchMode ? setRunSearchExpanded : setRunFolderExpanded}
        runRowRight={(node) => {
          const run = (searchMode ? searchMatchingRuns : draftRuns).find((r) => r.run_id === node.run_id);
          return run ? approveRejectRunButtons(run) : null;
        }}
        editorLocked
      />
    );
  };

  const activeRunFolderPath = runSearchActive ? runSearchFolderPath : runFolderPath;
  const activeRunFolderLabel = runSearchActive ? runSearchFolderLabel : runFolderLabel;
  const activeRunListLoading = runSearchActive ? runSearchLoading : browseListLoading;
  const activeRunSearchListTitle = runSearchActive
    ? activeRunFolderPath
      ? activeRunFolderLabel
      : "Search results"
    : selectedRunId
      ? activeRunFolderLabel
      : null;

  const caseFolderTreeSection =
    listMode === "case" && !reviewSearchOpen && caseFolderTree.length > 0 ? (
      <RepositoryFolderTree
        tree={caseFolderTree}
        selectedFolderPath={activeCaseFolderPath}
        onSelectFolder={
          caseSearchActive ? handleSelectCaseSearchFolder : handleSelectCaseFolder
        }
        expanded={caseSearchActive ? caseSearchExpanded : caseFolderExpanded}
        onExpandedChange={caseSearchActive ? setCaseSearchExpanded : setCaseFolderExpanded}
        badgeSourceRows={filteredCases}
        editorLocked
        getFolderContextMenuItems={getReviewCaseFolderContextMenuItems}
      />
    ) : listMode === "case" && !reviewSearchOpen ? (
      <SidebarEmpty message={reviewSearchChips.length ? "No matching cases." : "No draft cases."} />
    ) : null;

  const caseSearchSidebarTree = useMemo(() => {
    if (!caseSearchActive) return null;
    if (caseSearchTree.length > 0) {
      return (
        <RepositoryFolderTree
          tree={caseSearchTree}
          selectedFolderPath={caseSearchFolderPath}
          onSelectFolder={handleSelectCaseSearchFolder}
          expanded={caseSearchExpanded}
          onExpandedChange={setCaseSearchExpanded}
          badgeSourceRows={filteredCases}
          editorLocked
          getFolderContextMenuItems={getReviewCaseFolderContextMenuItems}
        />
      );
    }
    return (
      <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
        No matching cases in any folder.
      </div>
    );
  }, [
    caseSearchActive,
    caseSearchTree,
    caseSearchFolderPath,
    caseSearchExpanded,
    setCaseSearchExpanded,
    handleSelectCaseSearchFolder,
    filteredCases,
    getReviewCaseFolderContextMenuItems,
  ]);

  const treeColumnBody = noWorkspaceSelected ? (
    <div className="flex flex-1 items-center justify-center">
      <PageMessage variant="hint" title="Select a workspace from the header to view review items." />
    </div>
  ) : reviewSearchOpen ? (
    <SearchPanel
      searchKeys={listMode === "run" ? runSearchKeys() : CASE_SEARCH_KEYS}
      filterOptions={listMode === "run" ? runFilterOptions : filterOptions}
      onSearch={handleReviewSearch}
      onClose={handleCloseReviewSearch}
      history={listMode === "run" ? runPrefs.history : casePrefs.history}
      favorites={listMode === "run" ? runPrefs.favorites : casePrefs.favorites}
      onToggleFavorite={listMode === "run" ? runPrefs.toggleFavorite : casePrefs.toggleFavorite}
      isFavorite={listMode === "run" ? runPrefs.isFavorite : casePrefs.isFavorite}
      freeTextSearchKey="q"
      freeTextPlaceholder={
        listMode === "run"
          ? "Search by case ID, title, run name…"
          : "Search by ID, title, tag, path…"
      }
      resultsInSeparateColumn
      sidebarResultsContent={
        listMode === "run"
          ? renderRunFolderTree(searchUnifiedRunTree, true)
          : caseSearchSidebarTree
      }
    />
  ) : listMode === "run" ? (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {renderRunFolderTree(unifiedRunTree)}
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {loading ? <SidebarLoading /> : caseFolderTreeSection}
    </div>
  );

  const caseListColumn =
    listMode === "run" ? (
      <RunVirtualCaseList
        cases={runSearchActive ? runSearchFolderScopedCases : runCaseListWindow.items}
        total={runSearchActive ? runSearchFolderScopedCases.length : runCaseListWindow.total}
        loading={activeRunListLoading}
        loadingMore={!runSearchActive && runCaseListWindow.loadingMore}
        hasMore={!runSearchActive && runCaseListWindow.hasMore}
        onLoadMore={runSearchActive ? undefined : runCaseListWindow.loadMore}
        folderPath={activeRunFolderPath}
        listTitle={activeRunSearchListTitle}
        showNoRunWhenEmpty={!runSearchActive}
        showNoFolderWhenEmpty={false}
        noRunMessage="Select a run"
        noFolderMessage="Select a project or suite"
        emptyMessage={runSearchActive ? "No matching cases found." : "No cases in this folder"}
        selectedCaseFilePath={selectedCaseIdInRun}
        onSelectCase={handleSelectRunCaseInList}
        caseResultMode="icon"
      />
    ) : (
      <RepositoryVirtualCaseList
        cases={caseListWindow.items}
        total={caseListWindow.total}
        loading={caseListWindow.loading}
        loadingMore={caseListWindow.loadingMore}
        hasMore={caseListWindow.hasMore}
        onLoadMore={caseListWindow.loadMore}
        folderPath={activeCaseFolderPath}
        listTitle={caseListTitle}
        showNoFolderWhenEmpty={!caseSearchActive}
        emptyMessage={caseSearchActive ? "No matching cases found." : "No cases in this folder"}
        selectedCaseFilePath={selectedCase?.file_path}
        onSelectCase={handleOpenCase}
        editorLocked
        renderRowRight={approveRejectCaseButtons}
      />
    );

  let detailColumn;

  if (noWorkspaceSelected) {
    detailColumn = (
      <DetailPanel>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <PageMessage variant="hint" title="Select a workspace from the header to view review details." />
        </div>
      </DetailPanel>
    );
  } else if (listMode === "run") {
    const runDetail = runDetailsByRunId[selectedRunId];
    const run = runSummaryFromList(selectedRunId, draftRuns, runDetailsByRunId);
    const runCases = runDetail?.cases ?? [];

    const showCasePanel =
      selectedRunId &&
      selectedCaseIdInRun &&
      runDetail != null &&
      runCases.some((c) => c.file_path === selectedCaseIdInRun);

    const handlePostRunComment = async (runId, text) => {
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
    };

    const handlePostRunCaseComment = async (runId, filePath, text) => {
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
    };

    const handlePatchRunCase = async (runId, filePath, payload) => {
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
    };

    const handleDeleteRunComment = async (runId, index) => {
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
    };

    const handleDeleteRunCaseComment = async (runId, filePath, index) => {
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
    };

    if (selectedRunId && selectedCaseIdInRun && runDetail === undefined) {
      detailColumn = (
        <DetailPanel>
          <DetailPanelLoading message="Loading run…" />
        </DetailPanel>
      );
    } else if (showCasePanel) {
      detailColumn = (
        <RunCaseDetailPanel
          selectedCaseId={selectedCaseIdInRun}
          runCases={runCases}
          runId={selectedRunId}
          runAssignedTo={run?.assigned_to ?? null}
          runCaseContent={runCaseContent}
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
      );
    } else if (selectedRunId && run) {
      detailColumn = (
        <RunSummaryPanel
          run={run}
          runCases={runCases}
          loading={runDetail === undefined}
          statusBadge={<ApproveStatusBadge status={run.approve_status} entityType="run" />}
          readOnly={readOnly}
          isEditing={isEditingRunSummary}
          onToggleEdit={readOnly ? undefined : setIsEditingRunSummary}
          onSaveRun={async (payload) => {
            if (readOnly) return;
            await patchRun(run.run_id, payload, activeRepoSlug);
            setRunDetailsByRunId((prev) => {
              const existing = prev[run.run_id];
              if (!existing?.run) return prev;
              return { ...prev, [run.run_id]: { ...existing, run: { ...existing.run, ...payload } } };
            });
          }}
          repoSlug={activeRepoSlug}
          onPostRunComment={handlePostRunComment}
          onDeleteRunComment={handleDeleteRunComment}
          gitProfileVersion={gitProfileVersion}
          allUsernames={allUsernames}
          onOpenTicket={onNavigateToTicket}
        />
      );
    } else if (selectedRunId) {
      detailColumn = (
        <DetailPanel>
          <DetailPanelLoading message="Loading run…" />
        </DetailPanel>
      );
    } else {
      detailColumn = (
        <DetailPanel>
          <DetailPanelEmpty
            iconComponent={TestRunIcon}
            title="Select a test run from the list, or switch to Test Case to review draft cases."
          />
        </DetailPanel>
      );
    }
  } else {
    if (selectedCase && (caseDetailContent || caseDetailContentKey === null)) {
      const caseToShow = caseDetailContent || selectedCase;
      detailColumn = (
        <DetailPanel>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CaseDetailView
              testCase={caseToShow}
              repoSlug={activeRepoSlug}
              onOpenTicket={onNavigateToTicket}
              onOpenWikiPage={onNavigateToWiki}
            />
          </div>
        </DetailPanel>
      );
    } else if (selectedCase) {
      detailColumn = (
        <DetailPanel>
          <DetailPanelLoading message="Loading case…" />
        </DetailPanel>
      );
    } else {
      detailColumn = (
        <DetailPanel>
          <DetailPanelEmpty
            iconComponent={TestCaseIcon}
            title="Select a test case from the list, or switch to Test Run to review runs pending review."
          />
        </DetailPanel>
      );
    }
  }

  return (
    <TestRepositoryThreeColumnLayout
      storageKeys={REVIEW_STORAGE_KEYS}
      treeColumn={
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
            <SidebarSection
              title="Review"
              titleRight={sidebarTitleRight}
              toolbar={reviewToolbar}
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

export default Review;
