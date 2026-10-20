import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import Sidebar from "./components/Sidebar";
import FramelessWindowChrome from "./components/FramelessWindowChrome";
import OnboardingPageShell from "./components/OnboardingPageShell";
import WorkspaceSwitcher from "./components/WorkspaceSwitcher";
import PersistentView from "./components/PersistentView";
import TestCaseDetailModal from "./components/TestCaseDetailModal";
import ConfirmChangesView from "./pages/ConfirmChangesView";
import {
  CONFLICT_BANNER_ADDITIONAL,
  CONFLICT_BANNER_FIRST,
  CONFLICT_CANCEL_FAILED,
  CONFLICT_OVERLAPPING_FOUND,
  CONFLICT_SAVE_FAILED,
} from "./copy/conflictResolutionCopy";
import ResolveConflictsView from "./pages/ResolveConflictsView";
import PushFailedModal from "./components/PushFailedModal";
import CloseUnsyncedModal from "./components/CloseUnsyncedModal";
import SyncProgressOverlay, {
  SYNC_PROGRESS_STEP_LABELS,
  SYNC_PROGRESS_STEP_LABELS_WITH_ASSETS,
} from "./components/SyncProgressOverlay";
import { useConfirm } from "./components/ConfirmProvider";
import CreateProjectModal from "./components/CreateProjectModal";
import AddRepoWizard from "./components/AddRepoWizard";
import WorkflowStatusAndSync from "./components/WorkflowStatusAndSync";
import RefreshWorkspaceModal from "./components/RefreshWorkspaceModal";
import IndexSuccessToast from "./components/IndexSuccessToast";
import UpdateNotificationToast from "./components/UpdateNotificationToast.jsx";
import {
  LONG_OPERATION_TITLE_FULL_REINDEX,
  LONG_OPERATION_TITLE_INCREMENTAL_REFRESH,
} from "./copy/longOperationCopy";
import AppErrorModal from "./components/AppErrorModal";
import ConnectRepository from "./pages/ConnectRepository";
import BackendBootError from "./components/BackendBootError";
import TermsOfServiceOverlay from "./components/TermsOfServiceOverlay";
import Review from "./pages/Review";
import HelpModal from "./components/HelpModal";
import SettingsPage from "./pages/SettingsPage";
import AddCasesToRunPage from "./pages/AddCasesToRunPage";
import ExportCasesPage from "./pages/ExportCasesPage";
import ExportRunsPage from "./pages/ExportRunsPage";
import TestRepository from "./pages/TestRepository";
import TicketsPage from "./pages/TicketsPage";
import ReleasesPage from "./pages/ReleasesPage";
import WikiPage from "./pages/WikiPage";
import TestRun from "./pages/TestRun";
import Automation from "./pages/Automation";
import { exportCasesAsCsv, exportCasesAsPdf } from "./utils/exportCases";
import { exportRunsAsCsv, exportRunsAsPdf } from "./utils/exportRuns";
import { getBootConnectionErrorMessage } from "./utils/apiBootError";
import {
  abortRebase,
  addRunCases,
  capturePendingChanges,
  clearPendingChanges,
  confirmChanges,
  syncPendingAssets,
  createFolder,
  createProject,
  createTestCase,
  createTestCasesBatch,
  archiveCase,
  archiveCases,
  archiveFolder,
  restoreFolder,
  deleteFolder,
  deleteProject,
  deleteCase,
  forceReindex,
  reindexTickets,
  reindexReleases,
  reindexWiki,
  getCaseDetail,
  getCaseFilters,
  getWorkspaceUsernames,
  getRunCaseFilters,
  getDashboardSummary,
  getAgbStatus,
  getRun,
  getRunCaseContent,
  getRepoConnection,
  getRepos,
  getRepoStatus,
  getProjectSyncConfig,
  setProjectFeatureFlags,
  setProjectSyncConfig as persistProjectSyncConfig,
  getPushFailedStatus,
  indexFromGitStatus,
  listRuns,
  moveCase,
  quickSyncRepo,
  renameFolder,
  resolveRebase,
  restoreCase,
  restoreCases,
  recordAgbAcceptance,
  recoverConfirmWorkflow,
  playgroundSaveChanges,
  syncGitUserCache,
  updateCase,
  postCaseComment,
  deleteCaseComment,
} from "./services/api";
const isCancel = (err) => err && err.name === "AbortError";
import { startRefreshWebSocket, subscribeRefresh } from "./services/wsRefresh";
import {
  checkForUpdatesOnLaunch,
  subscribeUpdateEvents,
} from "./services/updater.js";
import {
  isArchivedCasePath,
  isArchivedDirectoryPath,
  isArchivedProjectDirectoryPath,
  isArchivedSuiteDirectoryPath,
} from "./constants/casePaths";
import { sanitizeNameForPath } from "./utils/sanitize";
import { flushAllAutoSavesBeforeSync, flushAllAutoSavesBeforeIndex } from "./utils/autoSaveFlushRegistry";
import { resetAllReleasesCaches } from "./utils/releasesCacheRegistry";
import { isTauri } from "./utils/tauriEnv";
import { dismissUpdateNotice } from "./utils/updateNotificationPrefs.js";
import { isMacTauri } from "./utils/platform";
import { isStorageSyncConfigured } from "./utils/isStorageSyncConfigured";
import { shouldWarnOnAppClose } from "./utils/appCloseGuard";
import {
  DEFAULT_PROJECT_MODULES,
  DEFAULT_REPO_FEATURE_FLAGS,
  featureFlagsEqual,
  firstEnabledNavView,
  isViewEnabledByFeatures,
  mirrorRepoStatusFeatures,
  normalizeRepoFeatureFlags,
  readRepoModulesMirror,
  writeRepoModulesMirror,
} from "./utils/repoModulesMirror";
import { openExternalUrl } from "./utils/openExternalUrl";
import {
  readLastActiveRepoSlug,
  resolveInitialActiveView,
  resolveInitialRepoSlug,
  writeLastActiveRepoSlug,
  writeLastActiveView,
} from "./utils/workspacePrefs";
import { mergeCaseFilterTags, mergeCaseFilterParams, mergeTagsIntoFilters, mergeParamsIntoFilters, mergeFilterAssignees, mergeFilterUpdatedBy } from "./utils/caseFilters";
import {
  collectPathKeyForFolderPath,
  findFolderNode,
  getParentDirectoryPath,
  isProjectDirectoryPath,
  projectPathFromDirectory,
} from "./utils/caseTree";
import { useLazyRepositoryTree, scheduleIdleTask } from "./hooks/useLazyRepositoryTree";
import {
  computeRenamedFolderPath,
  patchRepositoryTreeForCaseAdditions,
  patchRepositoryTreeForCaseRemovals,
  patchRepositoryTreeForActiveCaseRemovals,
  patchRepositoryTreeForArchiveCaseRemovals,
  patchRepositoryTreeForFolderCreate,
  patchRepositoryTreeForFolderDelete,
  patchRepositoryTreeForFolderRename,
  remapPathUnderPrefix,
} from "./utils/patchRepositoryTree";
import { remapPinnedProjectInStorage } from "./hooks/usePinnedProjects";
import { useCaseCatalog } from "./hooks/useCaseCatalog";
import { useCaseSearchResults } from "./hooks/useCaseSearchResults";
import {
  buildCaseMoves,
  buildMovedCaseRows,
  parentFolderOfCasePath,
  resolveCaseRowsForSnapshot,
} from "./utils/caseCatalogMove";
import {
  getRenameConflictDisplayName,
  isApiConflictError,
  RenameNameConflictError,
} from "./utils/renameConflict";
import { filterRowsForFolder } from "./utils/caseListWindowPatch";
import {
  THEME_KEY,
  applyThemeToDocument,
  isDarkTheme,
  readStoredTheme,
} from "./utils/theme";

/** Stable empty list when no rebase conflicts are active (avoids new [] each render). */
const EMPTY_CONFLICT_FILE_CONTENTS = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function App() {
  const confirm = useConfirm();
  const [appError, setAppError] = useState(() => ({
    open: false,
    title: "Something went wrong",
    message: "",
  }));

  const showAppError = useCallback((message, opts = {}) => {
    const msg =
      typeof message === "string"
        ? message
        : message?.message != null
          ? String(message.message)
          : message != null
            ? String(message)
            : "";
    const title =
      typeof opts?.title === "string" && opts.title.trim()
        ? opts.title.trim()
        : "Something went wrong";
    setAppError({
      open: true,
      title,
      message: msg.trim() || "An unexpected error occurred.",
    });
  }, []);

  const dismissAppError = useCallback(() => {
    setAppError((prev) => ({ ...prev, open: false }));
  }, []);
  const [agbChecked, setAgbChecked] = useState(false);
  const [agbAccepted, setAgbAccepted] = useState(false);
  const [agbSubmitting, setAgbSubmitting] = useState(false);
  const [agbError, setAgbError] = useState("");
  const [agbDisplayVersion, setAgbDisplayVersion] = useState(null);
  const allowCloseRef = useRef(false);

  const closeApplication = useCallback(async () => {
    allowCloseRef.current = true;
    if (isTauri()) {
      await getCurrentWindow().destroy();
      return;
    }
    window.close();
  }, []);

  const handleDeclineAgb = useCallback(async () => {
    setAgbError("");
    try {
      await closeApplication();
    } catch (err) {
      setAgbError(err?.message || "Could not close the application.");
    }
  }, [closeApplication]);

  const handleAgreeAgb = useCallback(async () => {
    setAgbError("");
    setAgbSubmitting(true);
    try {
      const status = await recordAgbAcceptance();
      if (status?.accepted !== true) {
        throw new Error("AGB acceptance could not be persisted.");
      }
      if (status?.displayVersion) {
        setAgbDisplayVersion(status.displayVersion);
      }
      setAgbAccepted(true);
    } catch (err) {
      setAgbError(err?.message || "Failed to store AGB acceptance.");
    } finally {
      setAgbSubmitting(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAgbStatus()
      .then((status) => {
        if (cancelled) return;
        setAgbAccepted(status?.accepted === true);
        setAgbDisplayVersion(status?.displayVersion ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setAgbAccepted(false);
        setAgbError(err?.message || "Could not read AGB status.");
      })
      .finally(() => {
        if (!cancelled) setAgbChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shouldShowAgbOverlay = agbChecked && !agbAccepted;

  const [activeView, setActiveView] = useState(() => resolveInitialActiveView());
  const [theme, setTheme] = useState(() => readStoredTheme());
  const [repoStatus, setRepoStatus] = useState(null);
  const [featureFlags, setFeatureFlags] = useState(() => ({
    ...DEFAULT_REPO_FEATURE_FLAGS,
    modules: { ...DEFAULT_PROJECT_MODULES },
  }));
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [caseFilters, setCaseFilters] = useState({});
  const [workspaceUsernames, setWorkspaceUsernames] = useState([]);
  const [runCaseFilters, setRunCaseFilters] = useState({});
  const [loading, setLoading] = useState(true); // only true during initial boot


  const [priorityFilter, setPriorityFilter] = useState("all");
  const [repositorySearchChips, setRepositorySearchChips] = useState([]);
  const [addCasesSearchChips, setAddCasesSearchChips] = useState([]);
  const [projectFilter, setProjectFilter] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("project")) return null;
    return params.get("project");
  });
  /** CSV import target project only — does not set global `projectFilter` (tree stays multi-project). */
  const [csvImportProjectDir, setCsvImportProjectDir] = useState(null);
  const [selectedTestCase, setSelectedTestCase] = useState(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState(null);
  const [connectionChecked, setConnectionChecked] = useState(false);
  /** Set when bootstrap requests fail or time out — distinct from "no repo" (showConnectWizard). */
  const [bootApiError, setBootApiError] = useState(null);
  const [bootRetryNonce, setBootRetryNonce] = useState(0);
  const [showConnectWizard, setShowConnectWizard] = useState(false);
  const [storageSyncSectionFocusKey, setStorageSyncSectionFocusKey] = useState(0);
  const [settingsInitialSection, setSettingsInitialSection] = useState("general");
  const [projectSyncConfig, setProjectSyncConfig] = useState(null);
  const [showAddRepoModal, setShowAddRepoModal] = useState(false);
  const [reposList, setReposList] = useState([]);
  const [activeRepoSlug, setActiveRepoSlug] = useState(null);
  const [gitProfileVersion, setGitProfileVersion] = useState(0);
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  const [conflictFileContents, setConflictFileContents] = useState(null);
  const [conflictResolverMessage, setConflictResolverMessage] = useState("");
  const [resolveLoading, setResolveLoading] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  const [captureLoading, setCaptureLoading] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  /** 'incremental' | 'full' | null — which refresh action is running */
  const [indexOperation, setIndexOperation] = useState(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [refreshWorkspaceOpen, setRefreshWorkspaceOpen] = useState(false);
  const [indexToastOpen, setIndexToastOpen] = useState(false);
  const [updateNotice, setUpdateNotice] = useState(null);
  const [indexChooserError, setIndexChooserError] = useState(null);
  const [contextTargetFolder, setContextTargetFolder] = useState(null);
  /** When in confirmChanges view, which view to return to on Cancel or after Process. */
  const [confirmChangesReturnView, setConfirmChangesReturnView] = useState("explorer");
  /** Bumped after each successful capture so ConfirmChangesView reloads snapshot even if already on this view. */
  const [confirmCaptureEpoch, setConfirmCaptureEpoch] = useState(0);
  /** Latest capture-pending-changes payload; seeds Confirm columns 1–2 without re-fetch flash. */
  const [confirmCaptureSnapshot, setConfirmCaptureSnapshot] = useState(null);
  /** True when Confirm Changes has no Gitoza-relevant items (Process disabled). */
  const [confirmChangesEmpty, setConfirmChangesEmpty] = useState(false);
  const [discardLoading, setDiscardLoading] = useState(false);
  const [showPushFailedModal, setShowPushFailedModal] = useState(false);
  const [showCloseUnsyncedModal, setShowCloseUnsyncedModal] = useState(false);
  const [pushFailedReason, setPushFailedReason] = useState("network");
  const closeGuardSnapshotRef = useRef({
    workplaceMode: null,
    pushFailed: false,
    workspaceKind: "remote_git",
  });
  const activeViewRef = useRef(activeView);
  const handleSyncClickRef = useRef(null);
  const [syncProgressOpen, setSyncProgressOpen] = useState(false);
  /** 'idle' | 'running' | 'success' | 'error' — only 'idle' when overlay is closed */
  const [syncProgressPhase, setSyncProgressPhase] = useState("idle");
  const [syncStepLabels, setSyncStepLabels] = useState(SYNC_PROGRESS_STEP_LABELS);
  const [syncStepStatuses, setSyncStepStatuses] = useState(() => [
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
  const [syncProgressError, setSyncProgressError] = useState(null);
  const [initialRunId, setInitialRunId] = useState(null);
  const [pendingOpenTicket, setPendingOpenTicket] = useState(null);
  /** Deep-link from ticket “Tested by”: open case in Explorer by file_path (case_id is not unique). */
  const [pendingOpenCase, setPendingOpenCase] = useState(null);
  /** Deep-link from ticket Release field: open release focus on Releases view. */
  const [pendingOpenRelease, setPendingOpenRelease] = useState(null);
  /** Deep-link from ticket body [[wiki:…]]: open wiki page by file_path. */
  const [pendingOpenWiki, setPendingOpenWiki] = useState(null);
  const [addCasesToRunRunId, setAddCasesToRunRunId] = useState(null);
  const [addCasesToRunRunName, setAddCasesToRunRunName] = useState(null);

  /** Optimistic update: after adding cases to a run from AddCasesToRunPage, pass { runId, cases } so TestRun can merge without refetch. */
  const [optimisticRunCasesAdded, setOptimisticRunCasesAdded] = useState(null);
  // Run list for Test Run view (loaded in App like repositoryTree for instant display on view switch)
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const runsHaveDataRef = useRef(false);
  const [runsIncludeArchived, setRunsIncludeArchived] = useState(false);
  const [runsRefreshTrigger, setRunsRefreshTrigger] = useState(0);
  // Obsidian-style explorer: right panel selection and mode (no modals)
  const [selectedCaseFilePath, setSelectedCaseFilePath] = useState(null);
  const [caseDetail, setCaseDetail] = useState(null);
  const [isEditingCase, setIsEditingCase] = useState(false);
  const [showCreateFormInPanel, setShowCreateFormInPanel] = useState(false);
  /** Dedicated Archived view: when true, sidebar shows only archived cases in project/suite tree. */
  const [archivedViewOpen, setArchivedViewOpen] = useState(false);
  /** Transient remap for TestRepository expanded keys after optimistic folder rename. */
  const [folderRenameRemap, setFolderRenameRemap] = useState(null);
  const handleFolderRenameRemapConsumed = useCallback(() => setFolderRenameRemap(null), []);

  const caseCatalog = useCaseCatalog(activeRepoSlug, {
    searchChips: repositorySearchChips,
    archiveMode: archivedViewOpen,
    projectFilter,
  });
  const {
    visibleRows: catalogVisibleRows,
    browseRows: catalogBrowseRows,
    loadCasesForPrefix,
    loadAllProjectPrefixes,
    reloadAllLoadedPrefixes,
    snapshotCaseRows,
    removeCasesFromCache,
    addCasesToCache,
    moveCasesInCache,
    renameCaseInCache,
    resortCasesInFolder,
    removeCasesByPathPrefix,
    renameCasesByPathPrefix,
    patchCaseInCache,
    loadingPrefixes,
    loadedPrefixes,
  } = caseCatalog;
  const reloadCaseCatalogRef = useRef(reloadAllLoadedPrefixes);
  reloadCaseCatalogRef.current = reloadAllLoadedPrefixes;
  const caseListWindowApiRef = useRef(null);
  const registerCaseListWindow = useCallback((api) => {
    caseListWindowApiRef.current = api;
  }, []);
  const invalidateCaseListWindow = useCallback(() => {
    caseListWindowApiRef.current?.invalidate?.();
  }, []);
  const invalidateAllCaseListWindowCaches = useCallback(() => {
    caseListWindowApiRef.current?.invalidateAll?.();
  }, []);
  const patchCaseListWindow = useCallback((patch) => {
    caseListWindowApiRef.current?.patchLocal?.(patch);
  }, []);
  const patchCaseListWindowForFolder = useCallback(
    (patch, folderPath = selectedFolderPath) => {
      if (!folderPath) {
        caseListWindowApiRef.current?.patchLocal?.(patch);
        return;
      }
      const add = filterRowsForFolder(patch?.add, folderPath);
      caseListWindowApiRef.current?.patchLocalForFolder?.(folderPath, {
        remove: patch?.remove,
        update: patch?.update,
        ...(add.length ? { add } : {}),
      });
    },
    [selectedFolderPath],
  );
  const sortCaseListWindow = useCallback(() => {
    caseListWindowApiRef.current?.sortLocal?.();
  }, []);
  const snapshotCaseListWindowRows = useCallback((filePaths) => {
    return caseListWindowApiRef.current?.snapshotRows?.(filePaths) ?? [];
  }, []);
  const buildCaseSnapshotRows = useCallback(
    (paths, rowOrBulk) =>
      resolveCaseRowsForSnapshot(
        paths,
        rowOrBulk,
        snapshotCaseListWindowRows(paths),
        snapshotCaseRows(paths),
      ),
    [snapshotCaseListWindowRows, snapshotCaseRows],
  );

  const selectedCaseFilePathRef = useRef(selectedCaseFilePath);
  selectedCaseFilePathRef.current = selectedCaseFilePath;
  const isEditingCaseRef = useRef(isEditingCase);
  isEditingCaseRef.current = isEditingCase;

  /** Monotonic id for explorer case-detail fetch; only the latest fetch may apply setCaseDetail. */
  const caseDetailFetchIdRef = useRef(0);
  const caseDetailAbortRef = useRef(null);
  const [caseDetailLoading, setCaseDetailLoading] = useState(false);

  const projectFilterRef = useRef(projectFilter);
  projectFilterRef.current = projectFilter;
  const activeRepoSlugRef = useRef(activeRepoSlug);
  activeRepoSlugRef.current = activeRepoSlug;
  const runsIncludeArchivedRef = useRef(runsIncludeArchived);
  runsIncludeArchivedRef.current = runsIncludeArchived;
  const archivedViewOpenRef = useRef(archivedViewOpen);
  archivedViewOpenRef.current = archivedViewOpen;
  const prevArchivedViewOpenForLoadRef = useRef(archivedViewOpen);
  const localWriteSuppressUntilRef = useRef(0);
  const localWriteBatchDepthRef = useRef(0);

  const suppressRefreshEvents = useCallback((ms = 5000) => {
    localWriteSuppressUntilRef.current = Date.now() + ms;
  }, []);

  const beginLocalWriteBatch = useCallback(() => {
    localWriteBatchDepthRef.current += 1;
    suppressRefreshEvents(30000);
  }, [suppressRefreshEvents]);

  const endLocalWriteBatch = useCallback(() => {
    localWriteBatchDepthRef.current = Math.max(0, localWriteBatchDepthRef.current - 1);
  }, []);

  const {
    repositoryTree,
    setRepositoryTree,
    projectsReady,
    treeStructureLoadingPrefixes,
    loadProjectNodes,
    loadProjectNodesForMode,
    loadFolderSubtree,
    prefetchArchiveProjectNodes,
    reloadArchiveProjectNodesInBackground,
    reloadBrowseProjectNodesInBackground,
    invalidateArchiveProjectNodes,
    invalidateBrowseProjectNodes,
    isArchiveProjectsReady,
    isArchiveBucketDirty,
    resetTree,
    invalidateSubtree,
    invalidateAllSubtrees,
    loadedTreePrefixesRef,
  } = useLazyRepositoryTree(activeRepoSlug, { archiveMode: archivedViewOpen });

  const refreshArchiveTreeInBackground = useCallback(() => {
    invalidateArchiveProjectNodes();
    void reloadArchiveProjectNodesInBackground();
  }, [invalidateArchiveProjectNodes, reloadArchiveProjectNodesInBackground]);

  const refreshBrowseTreeInBackground = useCallback(
    (summaryOverride = null) => {
      invalidateBrowseProjectNodes();
      void reloadBrowseProjectNodesInBackground(summaryOverride ?? dashboardSummary);
    },
    [invalidateBrowseProjectNodes, reloadBrowseProjectNodesInBackground, dashboardSummary],
  );

  const refreshDashboardAndBrowseTree = useCallback(async () => {
    if (!activeRepoSlug) return null;
    const summary = await getDashboardSummary(activeRepoSlug);
    setDashboardSummary(summary ?? null);
    invalidateBrowseProjectNodes();
    await loadProjectNodesForMode(false, summary ?? null, { background: true });
    return summary;
  }, [activeRepoSlug, loadProjectNodesForMode, invalidateBrowseProjectNodes]);
  const displayedRepositoryTree = useMemo(() => {
    if (archivedViewOpen || !projectFilter) return repositoryTree;
    const norm = projectFilter.replace(/\\/g, "/").replace(/\/+$/, "");
    return repositoryTree.filter((n) => n.directory_path === norm);
  }, [repositoryTree, projectFilter, archivedViewOpen]);

  const reloadLoadedProjectSubtrees = useCallback(async () => {
    const prefixes = [...loadedTreePrefixesRef.current];
    for (const prefix of prefixes) {
      invalidateSubtree(prefix);
      await loadFolderSubtree(prefix, { force: true });
    }
  }, [invalidateSubtree, loadFolderSubtree, loadedTreePrefixesRef]);

  const reloadProjectSubtreeForPath = useCallback(
    async (folderPath) => {
      const projectPath = isProjectDirectoryPath(folderPath, {
        archiveMode: archivedViewOpen,
      })
        ? folderPath
        : projectPathFromDirectory(folderPath);
      if (!projectPath) return;
      invalidateSubtree(projectPath);
      await loadFolderSubtree(projectPath, { force: true });
    },
    [invalidateSubtree, loadFolderSubtree, archivedViewOpen],
  );

  const refreshRepositoryTreeAfterDataChange = useCallback(
    async (summaryOverride = null) => {
      if (archivedViewOpen) {
        await loadProjectNodes(null);
      } else {
        await loadProjectNodes(summaryOverride ?? dashboardSummary);
      }
      await reloadLoadedProjectSubtrees();
    },
    [loadProjectNodes, reloadLoadedProjectSubtrees, dashboardSummary, archivedViewOpen],
  );

  const workflowState = useMemo(() => {
    const mode = repoStatus?.workplace_mode;
    if (mode === "editing") return "drafting";
    return "baseline";
  }, [repoStatus?.workplace_mode]);

  const activeRepoMeta = reposList.find((r) => r.slug === activeRepoSlug);
  const workspaceKind =
    activeRepoMeta?.workspace_kind ?? repoStatus?.workspace_kind ?? "remote_git";
  const isPlaygroundWorkspace = workspaceKind === "playground";

  activeViewRef.current = activeView;
  closeGuardSnapshotRef.current = {
    workplaceMode: repoStatus?.workplace_mode ?? null,
    pushFailed: Boolean(repoStatus?.push_failed_due_to_remote),
    workspaceKind,
  };

  useEffect(() => {
    writeLastActiveView(activeView);
  }, [activeView]);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let unlisten = null;
    let alive = true;
    void (async () => {
      try {
        // Tauri 2: once a close-requested listener exists, the window will not close
        // by itself. Always preventDefault first, then flush drafts, re-check status,
        // and destroy() when quit is allowed (requires core:window:allow-destroy).
        const fn = await getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          const finishClose = async () => {
            try {
              await getCurrentWindow().destroy();
            } catch (err) {
              console.error("[close-guard] destroy failed:", err);
            }
          };
          if (allowCloseRef.current) {
            allowCloseRef.current = false;
            await finishClose();
            return;
          }

          await flushAllAutoSavesBeforeSync();

          let snap = closeGuardSnapshotRef.current;
          const slug = activeRepoSlugRef.current;
          if (slug) {
            try {
              const repoData = await getRepoStatus(slug, { sync: false });
              if (repoData) {
                setRepoStatus(repoData);
                snap = {
                  workplaceMode: repoData.workplace_mode ?? null,
                  pushFailed: Boolean(repoData.push_failed_due_to_remote),
                  workspaceKind: closeGuardSnapshotRef.current.workspaceKind,
                };
                closeGuardSnapshotRef.current = snap;
              }
            } catch {
              /* use pre-flush snapshot */
            }
          }

          if (shouldWarnOnAppClose(snap)) {
            setShowCloseUnsyncedModal(true);
            return;
          }
          await finishClose();
        });
        if (!alive) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {
        /* window API unavailable */
      }
    })();
    return () => {
      alive = false;
      if (typeof unlisten === "function") unlisten();
    };
  }, []);

  const handleCloseUnsyncedStay = useCallback(() => {
    setShowCloseUnsyncedModal(false);
  }, []);

  const handleCloseUnsyncedGoToConfirm = useCallback(() => {
    setShowCloseUnsyncedModal(false);
    const view = activeViewRef.current;
    if (view === "confirmChanges" || view === "resolveConflicts") return;
    void handleSyncClickRef.current?.();
  }, []);

  const handleCloseUnsyncedAnyway = useCallback(async () => {
    setShowCloseUnsyncedModal(false);
    allowCloseRef.current = true;
    if (isTauri()) {
      try {
        await getCurrentWindow().destroy();
      } catch {
        allowCloseRef.current = false;
      }
      return;
    }
    window.close();
  }, []);

  const reviewEnabled = featureFlags.enable_review_system !== false;
  const projectModules = featureFlags.modules ?? DEFAULT_PROJECT_MODULES;
  const storageSyncConfigured = isStorageSyncConfigured(projectSyncConfig);

  useEffect(() => {
    if (!activeRepoSlug) {
      setFeatureFlags({
        ...DEFAULT_REPO_FEATURE_FLAGS,
        modules: { ...DEFAULT_PROJECT_MODULES },
      });
      return;
    }
    setFeatureFlags(readRepoModulesMirror(activeRepoSlug));
  }, [activeRepoSlug]);

  useEffect(() => {
    if (!activeRepoSlug || !repoStatus) return;
    setFeatureFlags((prev) => {
      const next = normalizeRepoFeatureFlags({
        enable_review_system: repoStatus.enable_review_system,
        // Keep current modules if status omits them (avoids all-on flash).
        modules: repoStatus.modules ?? prev.modules,
      });
      if (featureFlagsEqual(prev, next)) return prev;
      mirrorRepoStatusFeatures(activeRepoSlug, next);
      return next;
    });
  }, [activeRepoSlug, repoStatus]);

  useEffect(() => {
    if (activeView === "dashboard") {
      setActiveView("explorer");
      return;
    }
    if (!isViewEnabledByFeatures(activeView, featureFlags)) {
      setActiveView(firstEnabledNavView(featureFlags));
    }
  }, [featureFlags, activeView]);

  useEffect(() => {
    if (!activeRepoSlug || !isTauri()) {
      setProjectSyncConfig(null);
      return;
    }
    let cancelled = false;
    getProjectSyncConfig(activeRepoSlug)
      .then((cfg) => {
        if (!cancelled) setProjectSyncConfig(cfg ?? null);
      })
      .catch(() => {
        if (!cancelled) setProjectSyncConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRepoSlug]);

  // Lock sidebar / workspace navigation while sync/confirm workflow is in-flight.
  // Users can still abort only via explicit "Cancel" buttons inside the workflow views.
  const workflowGitBusy =
    captureLoading ||
    confirmLoading ||
    resolveLoading ||
    syncProgressOpen ||
    discardLoading ||
    activeView === "confirmChanges" ||
    activeView === "resolveConflicts";

  const navigationLocked = workflowGitBusy || isIndexing;

  const activeRepoDisplayName =
    activeRepoSlug && reposList.length
      ? (reposList.find((r) => r.slug === activeRepoSlug)?.display_name ?? activeRepoSlug)
      : "Workspace";

  // Derive the effective project path (.gitoza/test/cases/<project>) from the dropdown filter,
  // the currently selected sidebar folder, or the context-menu target folder.
  const effectiveProjectDir = useMemo(() => {
    if (projectFilter) return projectFilter;
    const folderHint = selectedFolderPath || contextTargetFolder;
    if (!folderHint || !folderHint.startsWith(".gitoza/test/cases/")) return null;
    const parts = folderHint.split("/");
    if (parts.length >= 4) return parts.slice(0, 4).join("/");
    return null;
  }, [projectFilter, selectedFolderPath, contextTargetFolder]);

  /** CSV import target: explicit picker choice, or tree filter only when that project exists on disk. */
  const csvImportDirectory = useMemo(() => {
    if (csvImportProjectDir) return csvImportProjectDir;
    if (!effectiveProjectDir) return null;
    const projects = dashboardSummary?.projects ?? [];
    if (projects.some((p) => p.project_path === effectiveProjectDir)) {
      return effectiveProjectDir;
    }
    return null;
  }, [csvImportProjectDir, effectiveProjectDir, dashboardSummary?.projects]);

  // URL-based initial view
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectParam = params.get("project");
    if (window.location.pathname === "/repository" || params.has("project")) {
      setActiveView("explorer");
      setProjectFilter(projectParam);
    } else if (
      window.location.pathname === "/tickets" ||
      window.location.pathname === "/tasks"
    ) {
      setActiveView("tickets");
    } else if (window.location.pathname === "/wiki") {
      setActiveView("wiki");
    }
  }, []);

  // Launch update check (Tauri desktop only)
  useEffect(() => {
    if (!isTauri()) return undefined;

    checkForUpdatesOnLaunch();
    const unsub = subscribeUpdateEvents((event) => {
      if (event.type === "available") {
        setUpdateNotice(event);
      } else if (event.type === "clear") {
        setUpdateNotice(null);
      }
    });

    return unsub;
  }, []);

  // Connection check + discover repos → load data. Always fetch repos so that
  // existing workspaces are shown even when connection returns false (e.g. no default path in config).
  useEffect(() => {
    let cancelled = false;

    Promise.all([getRepoConnection(), getRepos()])
      .then(([connData, reposData]) => {
        if (cancelled) return;
        setBootApiError(null);
        setConnectionChecked(true);
        const repos = Array.isArray(reposData?.repos) ? reposData.repos : [];
        const hasRepos = repos.length > 0;
        const connected = connData?.connected === true;
        if (hasRepos) {
          setShowConnectWizard(false);
          setReposList(repos);
          const slug = resolveInitialRepoSlug(reposData);
          writeLastActiveRepoSlug(slug);
          setActiveRepoSlug(slug);
          syncGitUserCache(slug).catch(() => {});
          loadData(slug, { skipSync: true });
          quickSyncRepo(slug).catch(() => {});
        } else if (connected) {
          setShowConnectWizard(false);
          setReposList([]);
          writeLastActiveRepoSlug(null);
          setActiveRepoSlug(null);
          loadData(null);
        } else {
          setShowConnectWizard(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBootApiError(getBootConnectionErrorMessage(err));
        setConnectionChecked(true);
        setShowConnectWizard(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bootRetryNonce]);

  const handleBootRetry = useCallback(() => {
    setBootApiError(null);
    setConnectionChecked(false);
    setBootRetryNonce((n) => n + 1);
  }, []);

  // Explicit confirm-workflow recovery (app start / repo switch).
  // Avoid recovery triggers from `/repo-status` polling so user conflict resolution
  // doesn't get aborted/reset unexpectedly.
  const lastRecoveredRepoRef = useRef(null);
  useEffect(() => {
    if (!connectionChecked || !activeRepoSlug) return;
    if (isPlaygroundWorkspace) return;
    if (lastRecoveredRepoRef.current === activeRepoSlug) return;
    lastRecoveredRepoRef.current = activeRepoSlug;
    recoverConfirmWorkflow(activeRepoSlug).catch(() => {});
  }, [activeRepoSlug, connectionChecked, isPlaygroundWorkspace]);

  /**
   * Load all workspace data from the YAML/SQLite backend.
   * DB data (cases, summary) is loaded first so the list renders immediately; repo status follows.
   * @param {string|null} repoSlug
   * @param {{ silent?: boolean, skipSync?: boolean }} opts
   *   — silent: no loading/error UI changes
   *   — skipSync: call repo-status with sync=false (no fetch/pull) for instant status on workspace switch
   */
  const loadData = async (repoSlug = activeRepoSlug, { silent = false, skipSync = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const [summaryData, filtersData, runFiltersData, usernamesData] = await Promise.all([
        getDashboardSummary(repoSlug),
        getCaseFilters(repoSlug).catch(() => null),
        getRunCaseFilters(repoSlug).catch(() => null),
        getWorkspaceUsernames(repoSlug).catch(() => null),
      ]);
      setDashboardSummary(summaryData ?? null);
      if (filtersData) setCaseFilters(filtersData);
      if (runFiltersData) setRunCaseFilters(runFiltersData);
      if (usernamesData?.usernames) setWorkspaceUsernames(usernamesData.usernames);
      await reloadCaseCatalogRef.current?.();

      getRepoStatus(repoSlug, { sync: !skipSync })
        .then((repoData) => setRepoStatus(repoData ?? null))
        .catch((err) => {
          if (!silent) {
            const message = err?.message || "Failed to load repo status";
            showAppError(message, { title: "Failed to load repo status" });
          }
        });

      return summaryData ?? null;
    } catch (err) {
      if (!silent) {
        const message = err?.message || "Failed to load dashboard data";
        showAppError(message, { title: "Failed to load data" });
      }
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleSyncClick = async () => {
    if (!activeRepoSlug) return;
    setConfirmError(null);

    if (isPlaygroundWorkspace) {
      setCaptureLoading(true);
      try {
        await flushAllAutoSavesBeforeSync();
        await playgroundSaveChanges(activeRepoSlug);
        await refreshRepoStatus();
      } catch (err) {
        const msg = err?.message ?? "Failed to save changes";
        setConfirmError(Array.isArray(msg) ? msg.join(", ") : msg);
      } finally {
        setCaptureLoading(false);
      }
      return;
    }

    setCaptureLoading(true);
    try {
      await flushAllAutoSavesBeforeSync();
      const snapshot = await capturePendingChanges(activeRepoSlug);
      setConfirmCaptureSnapshot(snapshot);
      setConfirmCaptureEpoch((n) => n + 1);
      if (activeView !== "confirmChanges") setConfirmChangesReturnView(activeView);
      setActiveView("confirmChanges");
    } catch (err) {
      const msg = err?.message ?? "Failed to capture changes";
      setConfirmError(Array.isArray(msg) ? msg.join(", ") : msg);
    } finally {
      setCaptureLoading(false);
    }
  };
  handleSyncClickRef.current = handleSyncClick;

  const handleCancelConfirmView = () => {
    clearPendingChanges(activeRepoSlug, { unstage: true }).catch(() => {});
    setConfirmCaptureSnapshot(null);
    setConfirmChangesEmpty(false);
    setDiscardLoading(false);
    setActiveView(confirmChangesReturnView);
    void refreshRepoStatus();
  };

  const handleAllDiscardedConfirmView = () => {
    clearPendingChanges(activeRepoSlug).catch(() => {});
    setConfirmCaptureSnapshot(null);
    setConfirmChangesEmpty(false);
    setDiscardLoading(false);
    setActiveView(confirmChangesReturnView);
    void refreshRepoStatus();
  };

  const handleProcessConfirmView = () => {
    if (confirmChangesEmpty) return;
    setActiveView(confirmChangesReturnView);
    clearPendingChanges(activeRepoSlug).catch(() => {});
    handleConfirmChanges();
  };

  const closeSyncOverlayQuiet = () => {
    setSyncProgressOpen(false);
    setSyncProgressPhase("idle");
    setSyncProgressError(null);
    setSyncStepLabels(SYNC_PROGRESS_STEP_LABELS);
    setSyncStepStatuses(["pending", "pending", "pending", "pending"]);
  };

  const finishSyncSuccessCelebration = async () => {
    const n = syncStepLabels.length || SYNC_PROGRESS_STEP_LABELS.length;
    setSyncStepStatuses(Array.from({ length: n }, () => "done"));
    setSyncProgressPhase("success");
    await sleep(700);
    closeSyncOverlayQuiet();
  };

  const handleDismissSyncError = () => {
    closeSyncOverlayQuiet();
    setConfirmLoading(false);
  };

  const formatAssetSyncErrorMessage = (err) => {
    const raw =
      typeof err === "string"
        ? err
        : err?.message != null
          ? String(err.message)
          : err != null
            ? String(err)
            : "";

    const msg = raw.trim() || "Image upload failed.";
    const lower = msg.toLowerCase();

    const looksLikeAuthError =
      lower.includes("accessdenied") ||
      lower.includes("invalidaccesskeyid") ||
      lower.includes("signaturedoesnotmatch") ||
      lower.includes("expiredtoken") ||
      lower.includes("forbidden") ||
      lower.includes("unauthorized") ||
      lower.includes("invalid credentials") ||
      lower.includes("invalid credential") ||
      lower.includes("403");

    if (looksLikeAuthError) {
      return (
        "Image upload failed due to invalid or expired Storage Sync credentials.\n" +
        "Update them in Settings → Storage Sync, then try again.\n\n" +
        msg
      );
    }

    const looksLikeNetworkError =
      lower.includes("offline") ||
      lower.includes("network") ||
      lower.includes("dns") ||
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("connection") ||
      lower.includes("s3 upload failed");

    if (looksLikeNetworkError) {
      return (
        "Image upload failed due to a network error.\n" +
        "Check your internet connection, then try again.\n\n" +
        msg
      );
    }

    return msg;
  };

  const handleConfirmChanges = async () => {
    if (!activeRepoSlug) return;
    setConfirmError(null);
    setConflictFileContents(null);
    setResolveError(null);
    setConfirmLoading(true);
    setSyncProgressOpen(true);
    setSyncProgressPhase("running");
    setSyncProgressError(null);

    const useAssetStep = isTauri();
    const stepLabels = useAssetStep
      ? SYNC_PROGRESS_STEP_LABELS_WITH_ASSETS
      : SYNC_PROGRESS_STEP_LABELS;
    const stepCount = stepLabels.length;
    const gitOffset = useAssetStep ? 1 : 0;
    setSyncStepLabels(stepLabels);
    setSyncStepStatuses(
      Array.from({ length: stepCount }, (_, i) => (i === 0 ? "active" : "pending")),
    );

    let conflictShown = false;
    let keepLoadingForSyncError = false;

    try {
      if (useAssetStep) {
        try {
          await syncPendingAssets(activeRepoSlug);
          setSyncStepStatuses(
            Array.from({ length: stepCount }, (_, i) =>
              i === 0 ? "done" : i === gitOffset ? "active" : "pending",
            ),
          );
          await sleep(180);
        } catch (err) {
          keepLoadingForSyncError = true;
          setSyncProgressPhase("error");
          setSyncProgressError(formatAssetSyncErrorMessage(err));
          return;
        }
      }

      const result = await confirmChanges(activeRepoSlug);
      if (result?.success && !result?.push_failed_due_to_remote) {
        setConfirmError(null);
        setSyncStepStatuses(
          Array.from({ length: stepCount }, (_, i) => {
            if (i < gitOffset + 1) return "done";
            if (i === gitOffset + 1) return "active";
            return "pending";
          }),
        );
        await sleep(220);
        setSyncStepStatuses(
          Array.from({ length: stepCount }, (_, i) => {
            if (i < gitOffset + 2) return "done";
            if (i === gitOffset + 2) return "active";
            return "pending";
          }),
        );
        await sleep(220);
        setSyncStepStatuses(
          Array.from({ length: stepCount }, (_, i) => {
            if (i < gitOffset + 3) return "done";
            if (i === gitOffset + 3) return "active";
            return "pending";
          }),
        );

        const s = await getRepoStatus(activeRepoSlug);
        setRepoStatus(s ?? null);
        await loadData(activeRepoSlug, { silent: true });
        await refreshRepositoryTreeAfterDataChange();

        await finishSyncSuccessCelebration();
      } else if (result?.push_failed_due_to_remote) {
        closeSyncOverlayQuiet();
        setConfirmError(null);
        setPushFailedReason(result.push_failed_reason || "network");
        setShowPushFailedModal(true);
        try {
          const s = await getRepoStatus(activeRepoSlug, { sync: false });
          setRepoStatus(s ?? null);
          await loadData(activeRepoSlug, { silent: true });
          await refreshRepositoryTreeAfterDataChange();
        } catch (_) {}
      } else if (!result?.success) {
        const msg = result?.message || "Confirm failed.";
        const files = result?.conflict_files?.length ? `\nConflicts: ${result.conflict_files.join(", ")}` : "";
        keepLoadingForSyncError = true;
        setSyncProgressPhase("error");
        setSyncProgressError(msg + files);
      }
    } catch (err) {
      if (err?.code === "conflict") {
        const contents = Array.isArray(err?.conflict_file_contents) ? err.conflict_file_contents : [];
        if (contents.length > 0) {
          closeSyncOverlayQuiet();
          setConflictFileContents(contents);
          setConflictResolverMessage(CONFLICT_BANNER_FIRST);
          setConfirmError(null);
            setConfirmLoading(false);
            setActiveView("resolveConflicts");
          conflictShown = true;
        } else {
          keepLoadingForSyncError = true;
          setSyncProgressPhase("error");
          setSyncProgressError(CONFLICT_OVERLAPPING_FOUND);
        }
      } else {
        const msg = err?.message
          ? err.message + (err?.conflict_files?.length ? ` Conflicts: ${err.conflict_files.join(", ")}` : "")
          : "Confirm changes failed";
        keepLoadingForSyncError = true;
        setSyncProgressPhase("error");
        setSyncProgressError(msg);
      }
    } finally {
      if (!conflictShown && !keepLoadingForSyncError) setConfirmLoading(false);
    }
  };

  const handleResolveRebase = async (resolvedFiles) => {
    if (!activeRepoSlug) return;
    setResolveError(null);
    setResolveLoading(true);
    setSyncProgressOpen(true);
    setSyncProgressPhase("running");
    setSyncProgressError(null);
    setSyncStepStatuses(["active", "pending", "pending", "pending"]);

    let keepLoadingForSyncError = false;

    try {
      const result = await resolveRebase(resolvedFiles, activeRepoSlug);
      if (result?.success && !result?.push_failed_due_to_remote) {
        setConflictFileContents(null);
        setConflictResolverMessage("");
        setSyncStepStatuses(["done", "active", "pending", "pending"]);
        await sleep(220);
        setSyncStepStatuses(["done", "done", "active", "pending"]);
        await sleep(220);
        setSyncStepStatuses(["done", "done", "done", "active"]);

        const s = await getRepoStatus(activeRepoSlug);
        setRepoStatus(s ?? null);
        await loadData(activeRepoSlug, { silent: true });
        await refreshRepositoryTreeAfterDataChange();

        await finishSyncSuccessCelebration();
        setActiveView(confirmChangesReturnView);
      } else if (result?.push_failed_due_to_remote) {
        closeSyncOverlayQuiet();
        setConflictFileContents(null);
        setConflictResolverMessage("");
        setActiveView(confirmChangesReturnView);
        setPushFailedReason(result.push_failed_reason || "network");
        setShowPushFailedModal(true);
        try {
          const s = await getRepoStatus(activeRepoSlug, { sync: false });
          setRepoStatus(s ?? null);
          await loadData(activeRepoSlug, { silent: true });
          await refreshRepositoryTreeAfterDataChange();
        } catch (_) {}
      } else {
        keepLoadingForSyncError = true;
        setSyncProgressPhase("error");
        setSyncProgressError(result?.message || "Resolve did not complete.");
      }
    } catch (err) {
      if (err?.code === "conflict") {
        const contents = Array.isArray(err?.conflict_file_contents) ? err.conflict_file_contents : [];
        if (contents.length > 0) {
          closeSyncOverlayQuiet();
          setConflictFileContents(contents);
          setConflictResolverMessage(CONFLICT_BANNER_ADDITIONAL);
          setActiveView("resolveConflicts");
        } else {
          keepLoadingForSyncError = true;
          setSyncProgressPhase("error");
          setSyncProgressError(CONFLICT_OVERLAPPING_FOUND);
        }
      } else {
        const msg = err?.message || CONFLICT_SAVE_FAILED;
        keepLoadingForSyncError = true;
        setSyncProgressPhase("error");
        setSyncProgressError(msg);
      }
    } finally {
      setResolveLoading(false);
      if (!keepLoadingForSyncError) setConfirmLoading(false);
    }
  };

  const handleAbortRebase = async () => {
    if (!activeRepoSlug) return;
    setResolveError(null);
    setResolveLoading(true);
    try {
      await abortRebase(activeRepoSlug);
      setConflictFileContents(null);
      setConflictResolverMessage("");
      setActiveView(confirmChangesReturnView);
      const s = await getRepoStatus(activeRepoSlug);
      setRepoStatus(s ?? null);
      await loadData(activeRepoSlug, { silent: true });
      await refreshRepositoryTreeAfterDataChange();
    } catch (err) {
      setResolveError(err?.message || CONFLICT_CANCEL_FAILED);
    } finally {
      setResolveLoading(false);
      setConfirmLoading(false);
    }
  };

  // Lazy repository tree: instant project nodes from dashboard; suite subtrees load on expand.
  useEffect(() => {
    const archiveViewChanged = prevArchivedViewOpenForLoadRef.current !== archivedViewOpen;
    prevArchivedViewOpenForLoadRef.current = archivedViewOpen;
    const suppressed = Date.now() < localWriteSuppressUntilRef.current;
    if (showConnectWizard || !connectionChecked || !activeRepoSlug) return;
    if (suppressed && !archiveViewChanged) return;
    if (archivedViewOpen) {
      if (isArchiveProjectsReady()) {
        if (isArchiveBucketDirty()) {
          void loadProjectNodes(null, { background: true });
        }
      } else {
        loadProjectNodes(null);
      }
    } else {
      loadProjectNodes(dashboardSummary);
    }
  }, [
    showConnectWizard,
    connectionChecked,
    activeRepoSlug,
    dashboardSummary,
    archivedViewOpen,
    loadProjectNodes,
    isArchiveProjectsReady,
    isArchiveBucketDirty,
  ]);

  // Warm archive project list in the idle bucket before the user opens Archived view.
  useEffect(() => {
    if (showConnectWizard || !connectionChecked || !activeRepoSlug) return;
    scheduleIdleTask(() => {
      void prefetchArchiveProjectNodes();
    });
  }, [showConnectWizard, connectionChecked, activeRepoSlug, prefetchArchiveProjectNodes]);

  useEffect(() => {
    if (!activeRepoSlug) {
      resetTree();
    }
  }, [activeRepoSlug, resetTree]);

  useEffect(() => {
    if (!projectFilter || !activeRepoSlug) return;
    loadFolderSubtree(projectFilter);
  }, [projectFilter, activeRepoSlug, loadFolderSubtree]);

  // Runs list fetch — symmetric to tree; runs when active repo or includeArchived changes
  useEffect(() => {
    let cancelled = false;
    if (!activeRepoSlug) {
      setRuns([]);
      runsHaveDataRef.current = false;
      setRunsLoading(false);
      return;
    }
    if (!runsHaveDataRef.current) setRunsLoading(true);
    listRuns(activeRepoSlug, { includeArchived: runsIncludeArchived })
      .then((data) => {
        if (!cancelled) {
          setRuns(Array.isArray(data) ? data : []);
          runsHaveDataRef.current = true;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuns([]);
          runsHaveDataRef.current = true;
        }
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeRepoSlug, runsIncludeArchived, runsRefreshTrigger]);

  const SILENT_REFETCH_DEBOUNCE_MS = 400;

  // Silent refetch (called by backend refresh events and after index rebuild)
  const silentRefetch = useRef(async () => {
    if (localWriteBatchDepthRef.current > 0) return;
    try {
      const slug = activeRepoSlugRef.current;
      const selectedPath = selectedCaseFilePathRef.current;
      const includeArchived = runsIncludeArchivedRef.current;
      const [summaryData, runsData, filtersData, runFiltersData] = await Promise.all([
        getDashboardSummary(slug),
        slug ? listRuns(slug, { includeArchived }) : Promise.resolve([]),
        slug ? getCaseFilters(slug).catch(() => null) : Promise.resolve(null),
        slug ? getRunCaseFilters(slug).catch(() => null) : Promise.resolve(null),
      ]);
      setDashboardSummary(summaryData ?? null);
      const skipTreeSubtreeReload = Date.now() < localWriteSuppressUntilRef.current;
      if (archivedViewOpenRef.current) {
        await loadProjectNodesForMode(true, null);
        void loadProjectNodesForMode(false, summaryData ?? null, { background: true });
      } else {
        await loadProjectNodesForMode(false, summaryData ?? null);
        void loadProjectNodesForMode(true, null, { background: true });
      }
      if (!skipTreeSubtreeReload) {
        const prefixes = [...loadedTreePrefixesRef.current];
        invalidateAllSubtrees();
        for (const prefix of prefixes) {
          await loadFolderSubtree(prefix, { force: true });
        }
      }
      if (slug) setRuns(Array.isArray(runsData) ? runsData : []);
      if (filtersData) setCaseFilters(filtersData);
      if (runFiltersData) setRunCaseFilters(runFiltersData);
      await reloadCaseCatalogRef.current?.();
      invalidateAllCaseListWindowCaches();

      if (selectedPath && slug && !isEditingCaseRef.current) {
        try {
          const freshDetail = await getCaseDetail(selectedPath, slug);
          if (selectedCaseFilePathRef.current === selectedPath) {
            setCaseDetail(freshDetail);
          }
        } catch (_) {
          // keep existing case detail on error
        }
      }
    } catch (_) {
      // keep current data on error
    }
  });

  const silentRefetchTimerRef = useRef(null);
  const scheduleSilentRefetch = useRef(() => {
    if (localWriteBatchDepthRef.current > 0) return;
    if (Date.now() < localWriteSuppressUntilRef.current) return;
    if (silentRefetchTimerRef.current) clearTimeout(silentRefetchTimerRef.current);
    silentRefetchTimerRef.current = window.setTimeout(() => {
      silentRefetchTimerRef.current = null;
      if (localWriteBatchDepthRef.current > 0) return;
      if (Date.now() < localWriteSuppressUntilRef.current) return;
      silentRefetch.current?.();
    }, SILENT_REFETCH_DEBOUNCE_MS);
  });

  // WebSocket singleton — one connection regardless of HMR/Strict Mode
  useEffect(() => {
    startRefreshWebSocket();
    return subscribeRefresh(() => scheduleSilentRefetch.current?.());
  }, []);

  useEffect(
    () => () => {
      if (silentRefetchTimerRef.current) clearTimeout(silentRefetchTimerRef.current);
    },
    [],
  );

  // Keep workflow mode in sync with external edits (editor/CLI) without expensive fetch/pull.
  // Paused during capture/confirm to avoid git index.lock races with git add/reset.
  useEffect(() => {
    if (!activeRepoSlug) return undefined;
    const intervalId = window.setInterval(() => {
      if (workflowGitBusy) return;
      getRepoStatus(activeRepoSlug, { sync: false })
        .then((data) => setRepoStatus(data ?? null))
        .catch(() => {});
    }, 8000);
    return () => window.clearInterval(intervalId);
  }, [activeRepoSlug, workflowGitBusy]);

  // File-change-adjacent trigger for external edits: refresh status when app regains focus/visibility.
  useEffect(() => {
    if (!activeRepoSlug) return undefined;
    const refreshStatusOnFocus = () => {
      if (workflowGitBusy) return;
      getRepoStatus(activeRepoSlug, { sync: false })
        .then((data) => setRepoStatus(data ?? null))
        .catch(() => {});
    };
    const handleVisibility = () => {
      if (!document.hidden) refreshStatusOnFocus();
    };
    window.addEventListener("focus", refreshStatusOnFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", refreshStatusOnFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeRepoSlug, workflowGitBusy]);

  // Theme (DOM + native title bar on macOS when titleBarStyle is Overlay)
  useEffect(() => {
    applyThemeToDocument(theme);
    localStorage.setItem(THEME_KEY, theme);
    if (isTauri()) {
      getCurrentWindow()
        .setTheme(isDarkTheme(theme) ? "dark" : "light")
        .catch(() => {});
    }
  }, [theme]);

  const { results: addCasesSearchResults } = useCaseSearchResults(
    activeRepoSlug,
    addCasesSearchChips,
  );

  const addCasesPickerRows = useMemo(() => {
    if (addCasesSearchChips.length > 0) return addCasesSearchResults;
    return catalogBrowseRows;
  }, [addCasesSearchChips, addCasesSearchResults, catalogBrowseRows]);

  const effectiveCaseFilters = useMemo(
    () =>
      mergeFilterUpdatedBy(
        mergeFilterAssignees(
          mergeCaseFilterParams(mergeCaseFilterTags(caseFilters, catalogVisibleRows), catalogVisibleRows),
          { workspaceUsernames, cases: catalogVisibleRows },
        ),
        { workspaceUsernames, cases: catalogVisibleRows },
      ),
    [caseFilters, catalogVisibleRows, workspaceUsernames],
  );

  const effectiveRunCaseFilters = useMemo(
    () => mergeFilterAssignees(runCaseFilters, { workspaceUsernames }),
    [runCaseFilters, workspaceUsernames],
  );

  const addCasesFilterOptions = useMemo(
    () =>
      mergeFilterUpdatedBy(
        mergeFilterAssignees(
          mergeCaseFilterParams(mergeCaseFilterTags(caseFilters, addCasesPickerRows), addCasesPickerRows),
          { workspaceUsernames, cases: addCasesPickerRows },
        ),
        { workspaceUsernames, cases: addCasesPickerRows },
      ),
    [caseFilters, addCasesPickerRows, workspaceUsernames],
  );

  const filteredRows = useMemo(() => {
    const isSearchMode = repositorySearchChips.length > 0 && !archivedViewOpen;
    const rows = catalogVisibleRows.filter((row) => {
      const matchesProject =
        projectFilter == null || projectFilter === ""
          ? true
          : (row.directory || "") === projectFilter;
      const matchesPriority =
        priorityFilter === "all" ||
        (row.priority || "").toLowerCase() === priorityFilter.toLowerCase();

      if (isSearchMode) {
        return matchesProject && matchesPriority;
      }

      return matchesProject && matchesPriority;
    });
    return rows;
  }, [
    catalogVisibleRows,
    priorityFilter,
    projectFilter,
    repositorySearchChips.length,
  ]);

  const handleFolderExpand = useCallback(
    (directoryPath) => {
      if (
        isProjectDirectoryPath(directoryPath, { archiveMode: archivedViewOpen })
      ) {
        loadFolderSubtree(directoryPath);
      }
    },
    [loadFolderSubtree, archivedViewOpen],
  );

  /** After any YAML/repo write: refetch workplace_mode so baseline/editing updates immediately (no sync). */
  const refreshRepoStatus = async () => {
    if (!activeRepoSlug) return;
    const repoData = await getRepoStatus(activeRepoSlug, { sync: false });
    setRepoStatus(repoData ?? null);
  };

  const handleFeatureFlagsChange = async ({ enable_review_system, modules }) => {
    if (!activeRepoSlug) return;
    const next = normalizeRepoFeatureFlags({ enable_review_system, modules });
    // Optimistic UI first so sidebar/settings never flash defaults mid-save.
    setFeatureFlags(next);
    writeRepoModulesMirror(activeRepoSlug, next);
    setRepoStatus((prev) =>
      prev
        ? {
            ...prev,
            enable_review_system: next.enable_review_system,
            modules: next.modules,
            is_dirty: true,
            workplace_mode:
              prev.workplace_mode === "baseline" ? "editing" : prev.workplace_mode,
          }
        : prev,
    );
    await setProjectFeatureFlags(next, activeRepoSlug);
    // Background refresh only — do not await (avoids a second UI pass that feels like fade).
    void refreshRepoStatus();
  };

  const handleProjectSyncConfigSave = useCallback(
    async (payload) => {
      if (!activeRepoSlug) {
        throw new Error("Connect a workspace to save storage sync settings.");
      }
      const updated = await persistProjectSyncConfig(activeRepoSlug, payload);
      setProjectSyncConfig(updated ?? null);
      await refreshRepoStatus();
    },
    [activeRepoSlug, refreshRepoStatus],
  );

  const openStorageSyncSettings = useCallback(() => {
    setSettingsInitialSection("storage-sync");
    setStorageSyncSectionFocusKey((k) => k + 1);
    setActiveView("settings");
  }, []);

  const postIndexRefresh = useCallback(async () => {
    // Drop Releases lazy trees immediately so expanded nodes cannot keep stale rockets.
    resetAllReleasesCaches();
    await refreshRepoStatus();
    await silentRefetch.current?.();

    const path = selectedCaseFilePathRef.current;
    const slug = activeRepoSlugRef.current;
    if (!path || !slug) return;
    try {
      const detail = await getCaseDetail(path, slug);
      if (selectedCaseFilePathRef.current === path) setCaseDetail(detail);
    } catch (_) {
      // keep existing case detail on error
    }
  }, [refreshRepoStatus]);

  const runIncrementalRefresh = async () => {
    if (!activeRepoSlug) return;
    setConfirmError(null);
    setIndexChooserError(null);
    setIndexOperation("incremental");
    setIsIndexing(true);
    try {
      await flushAllAutoSavesBeforeIndex();
      await indexFromGitStatus(activeRepoSlug);
      await postIndexRefresh();
      setRefreshWorkspaceOpen(false);
    } catch (err) {
      const msg = err?.message ?? "Failed to refresh index from git status";
      const out = Array.isArray(msg) ? msg.join(", ") : msg;
      setConfirmError(out);
      setIndexChooserError(out);
    } finally {
      setIsIndexing(false);
      setIndexOperation(null);
    }
  };

  /**
   * When a user clicks a test case row (e.g. from table in other views), fetch detail and show modal.
   */
  const handleRowClick = async (row) => {
    try {
      const detail = await getCaseDetail(row.file_path, activeRepoSlug);
      setSelectedTestCase(detail);
    } catch (_) {
      setSelectedTestCase(row);
    }
  };

  /**
   * When a user selects a case from the tree in explorer, fetch full detail and show in right panel.
   * Aborts stale requests and ignores out-of-order responses so fast A→B navigation cannot show case A.
   * Previous case detail stays on screen until the new fetch completes (no blank panel / no full reload flash).
   * Edit mode is preserved when switching to another case (same as IDE tab behavior); use clear panel to exit edit.
   */
  const handleSelectCaseFromTree = async (row) => {
    const nextPath = row?.file_path ?? null;
    caseDetailAbortRef.current?.abort();
    caseDetailAbortRef.current = null;
    setSelectedCaseFilePath(nextPath);
    setShowCreateFormInPanel(false);
    if (!nextPath) {
      setCaseDetail(null);
      setCaseDetailLoading(false);
      return;
    }
    const fetchId = ++caseDetailFetchIdRef.current;
    const ac = new AbortController();
    caseDetailAbortRef.current = ac;
    setCaseDetailLoading(true);
    try {
      const detail = await getCaseDetail(nextPath, activeRepoSlug, { signal: ac.signal });
      if (caseDetailFetchIdRef.current !== fetchId) return;
      setCaseDetail(detail);
    } catch (err) {
      if (isCancel(err) || ac.signal.aborted) return;
      if (caseDetailFetchIdRef.current !== fetchId) return;
      setCaseDetail(row);
    } finally {
      if (caseDetailFetchIdRef.current === fetchId) {
        setCaseDetailLoading(false);
        if (caseDetailAbortRef.current === ac) caseDetailAbortRef.current = null;
      }
    }
  };

  // Deep-link from ticket “Tested by”: select case by file_path and reveal its folder.
  useEffect(() => {
    if (!pendingOpenCase?.file_path) return;
    const row = pendingOpenCase;
    setPendingOpenCase(null);
    setIsEditingCase(false);
    setShowCreateFormInPanel(false);
    const archived = isArchivedCasePath(row.file_path);
    setArchivedViewOpen(archived);
    const parent = getParentDirectoryPath(row.file_path);
    if (parent) setSelectedFolderPath(parent);
    void handleSelectCaseFromTree(row);
  }, [pendingOpenCase]);

  /** Clear right panel selection and exit edit/create mode. */
  const clearExplorerPanel = () => {
    caseDetailAbortRef.current?.abort();
    caseDetailAbortRef.current = null;
    caseDetailFetchIdRef.current += 1;
    setSelectedCaseFilePath(null);
    setCaseDetail(null);
    setCaseDetailLoading(false);
    setIsEditingCase(false);
    setShowCreateFormInPanel(false);
  };

  /** Select a browse folder and clear case/create so project overview can show. */
  const handleSelectBrowseFolder = (path) => {
    setSelectedFolderPath(path || null);
    clearExplorerPanel();
  };

  /**
   * Toggle case edit mode. Optimistic: when switching to read-only, merge current draft
   * into caseDetail so the read-only view shows the latest content without waiting for API.
   */
  const handleToggleEditCase = (toEdit, draft) => {
    if (toEdit === false && draft != null && selectedCaseFilePathRef.current != null) {
      setCaseDetail((prev) => {
        if (!prev || prev.file_path !== selectedCaseFilePathRef.current) return prev;
        const tags = Array.isArray(draft.tags) ? draft.tags : (draft.tagsStr ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        return {
          ...prev,
          title: draft.title ?? prev.title,
          priority: draft.priority ?? prev.priority,
          status: draft.status ?? prev.status,
          requirement_ids:
            draft.requirement_ids !== undefined
              ? Array.isArray(draft.requirement_ids)
                ? draft.requirement_ids
                : []
              : prev.requirement_ids,
          assigned_to:
            draft.assigned_to !== undefined
              ? (draft.assigned_to || "").trim() || null
              : prev.assigned_to,
          automated:
            draft.automated !== undefined ? Boolean(draft.automated) : prev.automated,
          tags,
          body: draft.body ?? prev.body,
        };
      });
    }
    setIsEditingCase(!!toEdit);
  };

  /**
   * Switch workspace: reset project-specific state, reload data from SQLite,
   * then fire-and-forget a background Git sync.
   * Re-selecting the current workspace is a no-op: clearing `repositoryTree` without a change to
   * `activeRepoSlug` would skip the tree `useEffect` (deps unchanged), leaving an empty tree until refresh.
   */
  const handleSwitchRepo = (slug) => {
    if (slug === activeRepoSlug) return;

    setActiveRepoSlug(slug);
    writeLastActiveRepoSlug(slug);
    syncGitUserCache(slug).catch(() => {});
    setProjectFilter(null);
    setSelectedFolderPath(null);
    resetTree();
    dismissAppError();
    caseDetailAbortRef.current?.abort();
    caseDetailAbortRef.current = null;
    caseDetailFetchIdRef.current += 1;
    setSelectedCaseFilePath(null);
    setCaseDetail(null);
    setCaseDetailLoading(false);
    setIsEditingCase(false);
    setShowCreateFormInPanel(false);

    // Update workspace path immediately from the already-loaded repos list so Settings
    // does not keep showing the previous repo until getRepoStatus finishes.
    const nextPath = reposList.find((r) => r.slug === slug)?.repo_path;
    if (nextPath) {
      setRepoStatus((prev) => (prev ? { ...prev, repo_path: nextPath } : { repo_path: nextPath }));
    }

    // Clean stale URL params from previous workspace
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    window.history.replaceState({}, "", url);

    // Load from DB first (skipSync = no fetch/pull in repo-status) so test cases render immediately.
    // quickSyncRepo runs in background; WebSocket refresh will update after pull.
    loadData(slug, { skipSync: true });
    quickSyncRepo(slug).catch(() => {});
  };

  /**
   * Create a new project under .gitoza/test/cases/; refresh dashboard to show it.
   */
  const handleCreateProject = async (projectName) => {
    await createProject(projectName, activeRepoSlug);
    await refreshRepoStatus();
    setShowCreateProjectModal(false);
    setCreatingProject(false);
    await loadData(activeRepoSlug, { silent: true });
  };

  /**
   * Inline create project from tree: user types project name (folder name), we sanitize and create.
   */
  const handleCommitInlineProject = async (name) => {
    setCreatingProject(false);
    if (!name?.trim()) return;
    const sanitized = sanitizeNameForPath(name.trim());
    if (!sanitized) {
      showAppError("Project name cannot be empty after removing invalid characters.", {
        title: "Invalid project name",
      });
      return;
    }
    try {
      await handleCreateProject(sanitized);
    } catch (err) {
      showAppError(err?.message || "Failed to create project", { title: "Create project failed" });
    }
  };

  /**
   * Create a new YAML test case; optimistic patch of catalog + tree (no full reload).
   */
  const handleCreateTestCase = async (payload) => {
    suppressRefreshEvents();
    const res = await createTestCase(payload, activeRepoSlug);
    if (res?.file_path) {
      const newRow = {
        file_path: res.file_path,
        case_id: res.case_id,
        title: payload.title?.trim() || "new case",
        priority: payload.priority || "medium",
        status: payload.status || "active",
        tags: payload.tags ?? [],
        directory: payload.directory,
      };
      addCasesToCache([newRow]);
      setRepositoryTree((prev) =>
        patchRepositoryTreeForCaseAdditions(prev, [res.file_path]).tree,
      );
      patchCaseListWindowForFolder({ add: [newRow] });
    }
    await refreshRepoStatus();
    setShowCreateFormInPanel(false);
    setContextTargetFolder(null);
    return res;
  };

  /** CSV import: create up to 64 cases per HTTP request (no full tree refresh until import completes). */
  const handleImportTestCasesBatch = async (payloads) => {
    return createTestCasesBatch(payloads, activeRepoSlug);
  };

  /**
   * Create case from tree/list: backend mints a repo-unique case id.
   * `caseId` is ignored (kept for call-site compatibility); title defaults to "New Test Case".
   */
  const handleCommitInlineCase = async (parentDirPath, isProject, _caseId) => {
    if (!parentDirPath) return;
    const isProjectDir = isProject || isProjectDirectoryPath(parentDirPath);
    const directory = isProjectDir ? parentDirPath : parentDirPath.split("/").slice(0, -1).join("/");
    const target_folder = isProjectDir ? null : parentDirPath;
    const payload = {
      directory,
      target_folder: target_folder || undefined,
      case_id: "",
      title: "New Test Case",
      priority: "medium",
      tags: [],
      status: "active",
    };
    try {
      const res = await handleCreateTestCase(payload);
      if (res?.file_path) {
        setSelectedCaseFilePath(res.file_path);
        setCaseDetail(null);
        setShowCreateFormInPanel(false);
        getCaseDetail(res.file_path, activeRepoSlug)
          .then((detail) => {
            if (detail) setCaseDetail(detail);
          })
          .catch(() => {});
      }
    } catch (err) {
      const msg = err?.message || "Failed to create test case";
      throw new Error(msg);
    }
  };

  /**
   * Open create test case: use right panel inline form (explorer only).
   */
  const openCreateTestCaseForFolder = (folderPath) => {
    setContextTargetFolder(folderPath || null);
    setShowCreateFormInPanel(true);
    setSelectedCaseFilePath(null);
    setCaseDetail(null);
  };

  /**
   * Rename a folder inside a .gitoza.test/cases/ directory. Name is sanitized (spaces → _), same as run rename.
   * Optimistic: patch tree and case cache immediately; no full reload on success.
   */
  const handleRenameFolder = async (folderPath, newName) => {
    const sanitized = sanitizeNameForPath(newName);
    if (!sanitized) {
      showAppError("Folder name cannot be empty after removing invalid characters.", {
        title: "Invalid folder name",
      });
      return;
    }

    const oldPath = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const currentName = oldPath.includes("/")
      ? oldPath.slice(oldPath.lastIndexOf("/") + 1)
      : oldPath;
    if (currentName === sanitized) return;

    const newPath = computeRenamedFolderPath(oldPath, sanitized);
    const renamedNode = findFolderNode(repositoryTree, oldPath);
    const isProject = renamedNode?.is_project === true;

    const snapshot = {
      tree: repositoryTree,
      selectedFolderPath,
      projectFilter,
      contextTargetFolder,
      selectedCaseFilePath,
      caseDetail,
    };

    suppressRefreshEvents();

    const oldPathKey = collectPathKeyForFolderPath(repositoryTree, oldPath);
    const patchedTree = patchRepositoryTreeForFolderRename(
      repositoryTree,
      oldPath,
      newPath,
      sanitized,
    );
    const newPathKey = collectPathKeyForFolderPath(patchedTree, newPath);

    setRepositoryTree(patchedTree);
    renameCasesByPathPrefix(oldPath, newPath);
    if (isProject) {
      remapPinnedProjectInStorage(activeRepoSlug, oldPath, newPath);
    }

    const remapSelectionPath = (path) => remapPathUnderPrefix(path, oldPath, newPath);
    setSelectedFolderPath((prev) => remapSelectionPath(prev));
    setContextTargetFolder((prev) => remapSelectionPath(prev));
    setSelectedCaseFilePath((prev) => remapSelectionPath(prev));
    setCaseDetail((prev) => {
      if (!prev?.file_path) return prev;
      const nextFilePath = remapPathUnderPrefix(prev.file_path, oldPath, newPath);
      return nextFilePath === prev.file_path ? prev : { ...prev, file_path: nextFilePath };
    });

    const normalizedOldProj = oldPath.replace(/\/+$/, "");
    if (projectFilter && projectFilter.replace(/\/+$/, "") === normalizedOldProj && isProject) {
      setProjectFilter(newPath);
      const url = new URL(window.location.href);
      url.searchParams.set("project", newPath);
      window.history.replaceState({}, "", url);
    }

    if (oldPathKey && newPathKey && oldPathKey !== newPathKey) {
      setFolderRenameRemap({ oldPath, newPath, oldPathKey, newPathKey });
    }

    refreshRepoStatus();

    try {
      await renameFolder(folderPath, sanitized, activeRepoSlug);
    } catch (err) {
      setRepositoryTree(snapshot.tree);
      renameCasesByPathPrefix(newPath, oldPath);
      if (isProject) {
        remapPinnedProjectInStorage(activeRepoSlug, newPath, oldPath);
      }
      setSelectedFolderPath(snapshot.selectedFolderPath);
      setContextTargetFolder(snapshot.contextTargetFolder);
      setSelectedCaseFilePath(snapshot.selectedCaseFilePath);
      setCaseDetail(snapshot.caseDetail);
      setProjectFilter(snapshot.projectFilter);
      const url = new URL(window.location.href);
      if (snapshot.projectFilter) {
        url.searchParams.set("project", snapshot.projectFilter);
      } else {
        url.searchParams.delete("project");
      }
      window.history.replaceState({}, "", url);
      setFolderRenameRemap(null);
      if (isApiConflictError(err)) {
        throw new RenameNameConflictError(
          getRenameConflictDisplayName({ kind: "folder", newName: sanitized }),
        );
      }
      const msg = err?.message || "Failed to rename folder";
      showAppError(msg, { title: "Rename failed" });
      throw err;
    }
  };

  /**
   * Create a new test-suite sub-folder under .gitoza/test/cases/. Name is sanitized (spaces → _), same as run rename.
   */
  const handleCreateFolder = async (parentPath, folderName) => {
    const sanitized = sanitizeNameForPath(folderName);
    if (!sanitized) {
      showAppError("Folder name cannot be empty after removing invalid characters.", {
        title: "Invalid folder name",
      });
      return;
    }
    try {
      suppressRefreshEvents();
      const res = await createFolder(parentPath, sanitized, activeRepoSlug);
      if (res?.folder_path) {
        setRepositoryTree((prev) => {
          const { tree, changed } = patchRepositoryTreeForFolderCreate(
            prev,
            parentPath,
            res.folder_path,
          );
          return changed ? tree : prev;
        });
      }
      await refreshRepoStatus();
    } catch (err) {
      const msg = err?.message || "Failed to create folder";
      showAppError(msg, { title: "Create folder failed" });
    }
  };

  /** Move one or more case YAML files into another suite folder (same filename). */
  const handleMoveCasesToFolder = async (filePaths, targetFolderPath) => {
    if (!activeRepoSlug || !Array.isArray(filePaths) || filePaths.length === 0) return;

    const moves = buildCaseMoves(filePaths, targetFolderPath);
    if (moves.length === 0) return;

    const oldPaths = moves.map((m) => m.oldPath);
    const newPaths = moves.map((m) => m.newPath);

    const payloadRows =
      caseDetail?.file_path && oldPaths.includes(caseDetail.file_path) ? [caseDetail] : [];
    const sourceRows = buildCaseSnapshotRows(oldPaths, { rows: payloadRows });
    const movedRows = buildMovedCaseRows(moves, sourceRows);

    const snapshot = {
      selectedCaseFilePath,
      caseDetail,
      sourceRows,
    };

    suppressRefreshEvents();
    const applied = moveCasesInCache(moves);

    setRepositoryTree((prev) => {
      let next = patchRepositoryTreeForCaseRemovals(prev, oldPaths).tree;
      next = patchRepositoryTreeForCaseAdditions(next, newPaths).tree;
      return next;
    });
    patchCaseListWindowForFolder(
      {
        remove: oldPaths,
        ...(movedRows.length ? { add: movedRows } : {}),
      },
      targetFolderPath,
    );

    const selectedMove = moves.find((m) => m.oldPath === selectedCaseFilePathRef.current);
    if (selectedMove) {
      setSelectedCaseFilePath(selectedMove.newPath);
      setCaseDetail((prev) =>
        prev?.file_path === selectedMove.oldPath
          ? { ...prev, file_path: selectedMove.newPath }
          : prev,
      );
    }

    const reconcileInBackground = () => {
      invalidateCaseListWindow();
      loadData(activeRepoSlug, { silent: true })
        .then(() => refreshRepositoryTreeAfterDataChange())
        .catch(() => {});
    };

    const rollbackOptimistic = () => {
      removeCasesFromCache(applied.map((a) => a.newPath));
      const originalRows = snapshot.sourceRows;
      if (originalRows.length) addCasesToCache(originalRows);
      setRepositoryTree((prev) => {
        let next = patchRepositoryTreeForCaseRemovals(prev, newPaths).tree;
        next = patchRepositoryTreeForCaseAdditions(next, oldPaths).tree;
        return next;
      });
      patchCaseListWindow({ remove: newPaths });
      if (originalRows.length) {
        const rowsBySourceFolder = new Map();
        for (const row of originalRows) {
          const parent = parentFolderOfCasePath(row.file_path);
          if (!parent) continue;
          if (!rowsBySourceFolder.has(parent)) rowsBySourceFolder.set(parent, []);
          rowsBySourceFolder.get(parent).push(row);
        }
        for (const [folder, rows] of rowsBySourceFolder) {
          patchCaseListWindowForFolder({ add: rows }, folder);
        }
      }
      setSelectedCaseFilePath(snapshot.selectedCaseFilePath);
      setCaseDetail(snapshot.caseDetail);
    };

    const results = await Promise.allSettled(
      moves.map(({ oldPath }) => moveCase(oldPath, targetFolderPath, activeRepoSlug)),
    );

    const failures = results
      .map((r, i) => (r.status === "rejected" ? { reason: r.reason, move: moves[i] } : null))
      .filter(Boolean);

    if (failures.length === moves.length) {
      rollbackOptimistic();
      const raw = failures[0]?.reason?.message ?? failures[0]?.reason ?? "Failed to move case(s)";
      const msg = typeof raw === "string" ? raw : String(raw);
      showAppError(msg, { title: "Move failed" });
      throw failures[0]?.reason ?? new Error(msg);
    }

    if (failures.length > 0) {
      const msg = `Failed to move ${failures.length} of ${moves.length} test case${
        failures.length === 1 ? "" : "s"
      }.`;
      showAppError(msg, { title: "Move failed" });
      reconcileInBackground();
      throw new Error(msg);
    }

    await refreshRepoStatus();
    patchCaseListWindowForFolder(
      { add: movedRows },
      targetFolderPath,
    );
  };

  /**
   * When still viewing this case (pathMatches), sync full result into caseDetail so
   * persistedSnapshot and any form re-init stay correct; avoids repeated PUTs and priority jumping back.
   */
  const handleAutoSaveCase = async (payload) => {
    if (!payload?.file_path) return;
    const result = await updateCase(payload.file_path, payload, activeRepoSlug);
    if (result) {
      // Merge into the open panel only when it still shows this file (user may have navigated away).
      const pathMatches = selectedCaseFilePathRef.current === payload.file_path;
      if (pathMatches) {
        setCaseDetail((prev) =>
          prev && prev.file_path === payload.file_path ? { ...prev, ...result } : prev,
        );
      }
      const listPartial = {
        title: result.title,
        priority: result.priority,
        tags: result.tags ?? [],
        status: result.status,
        automated: Boolean(result.automated),
      };
      patchCaseInCache(payload.file_path, listPartial);
      patchCaseListWindow({
        update: [{ filePath: payload.file_path, partial: listPartial }],
      });
      if (Array.isArray(result.tags) && result.tags.length > 0) {
        setCaseFilters((prev) => mergeTagsIntoFilters(prev, result.tags));
      }
      if (result.params && typeof result.params === "object" && Object.keys(result.params).length > 0) {
        setCaseFilters((prev) => mergeParamsIntoFilters(prev, result.params));
      }
    }
    refreshRepoStatus();
  };

  const handlePostCaseComment = async (filePath, text) => {
    if (!filePath || !text?.trim()) return;
    const result = await postCaseComment(filePath, text, activeRepoSlug);
    if (result && selectedCaseFilePathRef.current === filePath) {
      setCaseDetail((prev) =>
        prev && prev.file_path === filePath ? { ...prev, comments: result.comments ?? [] } : prev,
      );
    }
    refreshRepoStatus();
  };

  const handleDeleteCaseComment = async (filePath, index) => {
    if (!filePath || index < 0) return;
    const result = await deleteCaseComment(filePath, index, activeRepoSlug);
    if (result && selectedCaseFilePathRef.current === filePath) {
      setCaseDetail((prev) =>
        prev && prev.file_path === filePath ? { ...prev, comments: result.comments ?? [] } : prev,
      );
    }
    refreshRepoStatus();
  };

  /**
   * Archive a test case (optimistic: remove from list + tree counts immediately).
   */
  const handleArchiveCase = async (rowOrBulk, reason = "") => {
    const bulkPaths = Array.isArray(rowOrBulk?.file_paths) ? rowOrBulk.file_paths.filter(Boolean) : null;
    const isBulk = Array.isArray(bulkPaths) && bulkPaths.length > 1;
    const filePath = isBulk ? null : (rowOrBulk?.file_path ?? null);
    const paths = isBulk ? bulkPaths : (filePath ? [filePath] : []);
    if (paths.length === 0) return;

    beginLocalWriteBatch();
    const snapshot = {
      tree: repositoryTree,
      rows: buildCaseSnapshotRows(paths, rowOrBulk),
      selection: {
        selectedCaseFilePath,
        caseDetail,
        selectedTestCase,
        selectedFolderPath,
      },
    };

    const { tree: optimisticTree } = patchRepositoryTreeForActiveCaseRemovals(repositoryTree, paths);
    removeCasesFromCache(paths);
    setRepositoryTree(optimisticTree);
    patchCaseListWindow({ remove: paths });
    if (selectedTestCase?.file_path && paths.includes(selectedTestCase.file_path)) setSelectedTestCase(null);
    if (selectedCaseFilePath && paths.includes(selectedCaseFilePath)) {
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }
    if (selectedFolderPath && !findFolderNode(optimisticTree, selectedFolderPath)) {
      setSelectedFolderPath(null);
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }

    const rollbackArchiveOptimistic = (failedPaths) => {
      const failedSet = new Set(failedPaths);
      const rowsToRestore = snapshot.rows.filter((r) => failedSet.has(r.file_path));
      if (rowsToRestore.length) {
        addCasesToCache(rowsToRestore);
        patchCaseListWindow({ add: rowsToRestore });
      }
      if (failedPaths.length === paths.length) {
        setRepositoryTree(snapshot.tree);
        setSelectedCaseFilePath(snapshot.selection.selectedCaseFilePath);
        setCaseDetail(snapshot.selection.caseDetail);
        setSelectedTestCase(snapshot.selection.selectedTestCase);
        setSelectedFolderPath(snapshot.selection.selectedFolderPath);
      } else if (failedPaths.length > 0) {
        setRepositoryTree((prev) =>
          patchRepositoryTreeForCaseAdditions(prev, failedPaths).tree,
        );
      }
    };

    try {
      let failed = [];
      if (isBulk) {
        const resp = await archiveCases(paths, reason ?? "", activeRepoSlug);
        failed = Array.isArray(resp?.failed_paths) ? resp.failed_paths : [];
      } else {
        await archiveCase(paths[0], reason ?? "", activeRepoSlug);
      }
      if (failed.length > 0) {
        rollbackArchiveOptimistic(failed);
        invalidateCaseListWindow();
        showAppError(
          `Failed to archive ${failed.length} test case${failed.length === 1 ? "" : "s"}.`,
          { title: "Archive failed" },
        );
      }
      if (failed.length < paths.length) {
        await refreshRepoStatus();
        await refreshDashboardAndBrowseTree();
        refreshArchiveTreeInBackground();
      }
    } catch (err) {
      rollbackArchiveOptimistic(paths);
      invalidateCaseListWindow();
      showAppError(err?.message || "Failed to archive test case(s)", { title: "Archive failed" });
      void loadData(activeRepoSlug, { silent: true })
        .then(() => refreshRepositoryTreeAfterDataChange())
        .catch(() => {});
    } finally {
      endLocalWriteBatch();
    }
  };

  /**
   * Archive all active test cases under a project or suite folder.
   */
  const handleArchiveFolder = async (node) => {
    if (!activeRepoSlug || !node?.directory_path || archivedViewOpen) return;
    const dir = node.directory_path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (isArchivedDirectoryPath(dir)) {
      showAppError("Cannot archive a folder that is already archived.", {
        title: "Archive not allowed",
      });
      return;
    }
    if ((node.case_count ?? 0) === 0) {
      showAppError("No active test cases to archive in this folder.", {
        title: "Archive not allowed",
      });
      return;
    }

    const isProject = node.is_project === true;
    const label = node.display_name ?? node.name ?? "this folder";
    const ok = await confirm({
      title: isProject ? "Archive project?" : "Archive test suite?",
      description: isProject
        ? `Archive all test cases in project "${label}"? Archived cases move to the Archived view.`
        : "Archive all test cases in this suite? Archived cases move to the Archived view.",
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    const casePrefix = `${dir}/`;

    beginLocalWriteBatch();
    const treeSnapshot = repositoryTree;

    setRepositoryTree((prev) => {
      const { tree, changed } = patchRepositoryTreeForFolderDelete(prev, dir);
      return changed ? tree : prev;
    });
    removeCasesByPathPrefix(casePrefix);
    if (selectedTestCase?.file_path?.startsWith(casePrefix)) setSelectedTestCase(null);
    if (
      selectedFolderPath === dir ||
      (selectedFolderPath && selectedFolderPath.startsWith(`${dir}/`))
    ) {
      setSelectedFolderPath(null);
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    } else if (selectedCaseFilePath?.startsWith(casePrefix)) {
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }

    try {
      const resp = await archiveFolder(dir, "", activeRepoSlug);
      const failed = Array.isArray(resp?.failed_paths) ? resp.failed_paths : [];
      if (failed.length > 0) {
        setRepositoryTree(treeSnapshot);
        invalidateCaseListWindow();
        showAppError(
          `Failed to archive ${failed.length} test case${failed.length === 1 ? "" : "s"}.`,
          { title: "Archive failed" },
        );
        void loadData(activeRepoSlug, { silent: true }).then(() =>
          refreshRepositoryTreeAfterDataChange(),
        );
        return;
      }
      await refreshRepoStatus();
      await refreshDashboardAndBrowseTree();
      refreshArchiveTreeInBackground();
    } catch (err) {
      setRepositoryTree(treeSnapshot);
      invalidateCaseListWindow();
      showAppError(err?.message || "Failed to archive folder", { title: "Archive failed" });
      void loadData(activeRepoSlug, { silent: true }).then(() =>
        refreshRepositoryTreeAfterDataChange(),
      );
    } finally {
      endLocalWriteBatch();
    }
  };

  /**
   * Restore all archived test cases under a project or suite folder back to active status.
   */
  const handleRestoreFolder = async (node) => {
    if (!activeRepoSlug || !node?.directory_path || !archivedViewOpen) return;
    const dir = node.directory_path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!isArchivedDirectoryPath(dir)) {
      showAppError("Only archived folders can be restored.", {
        title: "Restore not allowed",
      });
      return;
    }
    if ((node.case_count ?? 0) === 0) {
      showAppError("No archived test cases to restore in this folder.", {
        title: "Restore not allowed",
      });
      return;
    }

    const isProject = node.is_project === true;
    const label = node.display_name ?? node.name ?? "this folder";
    const ok = await confirm({
      title: isProject ? "Restore project?" : "Restore test suite?",
      description: isProject
        ? `Restore all test cases in project "${label}" back to the main tree?`
        : "Restore all test cases in this suite back to the main tree?",
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    const casePrefix = `${dir}/`;

    beginLocalWriteBatch();
    const treeSnapshot = repositoryTree;

    setRepositoryTree((prev) => {
      const { tree, changed } = patchRepositoryTreeForFolderDelete(prev, dir);
      return changed ? tree : prev;
    });
    removeCasesByPathPrefix(casePrefix);
    if (selectedTestCase?.file_path?.startsWith(casePrefix)) setSelectedTestCase(null);
    if (
      selectedFolderPath === dir ||
      (selectedFolderPath && selectedFolderPath.startsWith(`${dir}/`))
    ) {
      setSelectedFolderPath(null);
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    } else if (selectedCaseFilePath?.startsWith(casePrefix)) {
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }

    try {
      const resp = await restoreFolder(dir, activeRepoSlug);
      const failed = Array.isArray(resp?.failed_paths) ? resp.failed_paths : [];
      if (failed.length > 0) {
        setRepositoryTree(treeSnapshot);
        invalidateCaseListWindow();
        showAppError(
          `Failed to restore ${failed.length} test case${failed.length === 1 ? "" : "s"}.`,
          { title: "Restore failed" },
        );
        void loadData(activeRepoSlug, { silent: true }).then(() =>
          refreshRepositoryTreeAfterDataChange(),
        );
        return;
      }
      await refreshRepoStatus();
      await refreshDashboardAndBrowseTree();
      refreshArchiveTreeInBackground();
    } catch (err) {
      setRepositoryTree(treeSnapshot);
      invalidateCaseListWindow();
      showAppError(err?.message || "Failed to restore folder", { title: "Restore failed" });
      void loadData(activeRepoSlug, { silent: true }).then(() =>
        refreshRepositoryTreeAfterDataChange(),
      );
    } finally {
      endLocalWriteBatch();
    }
  };

  /**
   * Restore an archived test case back to active status and its original location.
   */
  const handleRestoreCase = async (rowOrBulk) => {
    if (!activeRepoSlug) return;
    const bulkPaths = Array.isArray(rowOrBulk?.file_paths) ? rowOrBulk.file_paths.filter(Boolean) : null;
    const isBulk = Array.isArray(bulkPaths) && bulkPaths.length > 1;
    const filePath = isBulk ? null : (rowOrBulk?.file_path ?? null);
    const paths = isBulk ? bulkPaths : (filePath ? [filePath] : []);
    if (paths.length === 0) return;

    beginLocalWriteBatch();
    const snapshot = {
      tree: repositoryTree,
      rows: buildCaseSnapshotRows(paths, rowOrBulk),
      selectedFolderPath,
    };

    const { tree: optimisticTree } = patchRepositoryTreeForArchiveCaseRemovals(
      repositoryTree,
      paths,
    );
    removeCasesFromCache(paths);
    setRepositoryTree(optimisticTree);
    patchCaseListWindow({ remove: paths });
    if (
      selectedFolderPath &&
      !findFolderNode(optimisticTree, selectedFolderPath)
    ) {
      setSelectedFolderPath(null);
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    } else if (selectedCaseFilePath && paths.includes(selectedCaseFilePath)) {
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }

    const rollbackRestoreOptimistic = (failedPaths) => {
      const failedSet = new Set(failedPaths);
      const rowsToRestore = snapshot.rows.filter((r) => failedSet.has(r.file_path));
      if (rowsToRestore.length) {
        addCasesToCache(rowsToRestore);
        patchCaseListWindow({ add: rowsToRestore });
      }
      if (failedPaths.length === paths.length) {
        setRepositoryTree(snapshot.tree);
        setSelectedFolderPath(snapshot.selectedFolderPath);
      } else if (failedPaths.length > 0) {
        setRepositoryTree((prev) =>
          patchRepositoryTreeForCaseAdditions(prev, failedPaths).tree,
        );
      }
    };

    try {
      let failed = [];
      if (isBulk) {
        const resp = await restoreCases(paths, activeRepoSlug);
        failed = Array.isArray(resp?.failed_paths) ? resp.failed_paths : [];
      } else {
        await restoreCase(paths[0], activeRepoSlug);
      }
      if (failed.length > 0) {
        rollbackRestoreOptimistic(failed);
        invalidateCaseListWindow();
        showAppError(
          `Failed to restore ${failed.length} test case${failed.length === 1 ? "" : "s"}.`,
          { title: "Restore failed" },
        );
      }
      if (failed.length < paths.length) {
        await refreshRepoStatus();
        await refreshDashboardAndBrowseTree();
        refreshArchiveTreeInBackground();
      }
    } catch (err) {
      rollbackRestoreOptimistic(paths);
      invalidateCaseListWindow();
      showAppError(err?.message || "Failed to restore test case", { title: "Restore failed" });
    } finally {
      endLocalWriteBatch();
    }
  };

  /**
   * Permanently delete a test case YAML file.
   */
  const handleDeleteCase = async (rowOrBulk) => {
    if (!activeRepoSlug) return;
    const bulkPaths = Array.isArray(rowOrBulk?.file_paths) ? rowOrBulk.file_paths.filter(Boolean) : null;
    const isBulk = Array.isArray(bulkPaths) && bulkPaths.length > 1;
    const filePath = isBulk ? null : (rowOrBulk?.file_path ?? null);
    const paths = isBulk ? bulkPaths : (filePath ? [filePath] : []);
    if (paths.length === 0) return;
    if (paths.some((fp) => !isArchivedCasePath(fp))) {
      showAppError("Only archived test cases can be deleted permanently. Archive active cases first.", {
        title: "Delete not allowed",
      });
      return;
    }

    const ok = await confirm({
      title: isBulk ? `Delete ${paths.length} test cases?` : "Delete test case?",
      description: isBulk
        ? `Delete ${paths.length} test cases permanently? This cannot be undone.`
        : "Delete this test case permanently? This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    suppressRefreshEvents();
    const snapshot = {
      tree: repositoryTree,
      rows: buildCaseSnapshotRows(paths, rowOrBulk),
    };

    const { tree: optimisticTree } = patchRepositoryTreeForArchiveCaseRemovals(repositoryTree, paths);
    removeCasesFromCache(paths);
    setRepositoryTree(optimisticTree);
    patchCaseListWindow({ remove: paths });
    if (selectedTestCase?.file_path && paths.includes(selectedTestCase.file_path)) setSelectedTestCase(null);
    if (selectedCaseFilePath && paths.includes(selectedCaseFilePath)) {
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }
    if (selectedFolderPath && !findFolderNode(optimisticTree, selectedFolderPath)) {
      setSelectedFolderPath(null);
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }

    const rollbackDeleteOptimistic = (failedPaths) => {
      const failedSet = new Set(failedPaths);
      const rowsToRestore = snapshot.rows.filter((r) => failedSet.has(r.file_path));
      if (rowsToRestore.length) {
        addCasesToCache(rowsToRestore);
        patchCaseListWindow({ add: rowsToRestore });
      }
      if (failedPaths.length === paths.length) {
        setRepositoryTree(snapshot.tree);
      } else if (failedPaths.length > 0) {
        setRepositoryTree((prev) =>
          patchRepositoryTreeForCaseAdditions(prev, failedPaths).tree,
        );
      }
    };

    try {
      const failed = [];
      for (const fp of paths) {
        try {
          await deleteCase(fp, activeRepoSlug);
        } catch {
          failed.push(fp);
        }
      }

      if (failed.length > 0) {
        rollbackDeleteOptimistic(failed);
        invalidateCaseListWindow();
        showAppError(
          `Failed to delete ${failed.length} test case${failed.length === 1 ? "" : "s"}.`,
          { title: "Delete failed" },
        );
      }
      if (failed.length < paths.length) {
        await refreshRepoStatus();
        refreshArchiveTreeInBackground();
      }
    } catch (err) {
      rollbackDeleteOptimistic(paths);
      invalidateCaseListWindow();
      showAppError(err?.message || "Failed to delete test case", { title: "Delete failed" });
    }
  };

  /**
   * Delete a test-suite folder after confirmation.
   */
  const handleDeleteFolder = async (folderPath) => {
    if (!isArchivedSuiteDirectoryPath(folderPath)) {
      showAppError("Only archived test suites can be deleted permanently.", {
        title: "Delete not allowed",
      });
      return;
    }
    const ok = await confirm({
      title: "Delete test suite?",
      description: "Delete this test suite and all test cases inside it? This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;

    const normPath = folderPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const casePrefix = `${normPath}/`;

    suppressRefreshEvents();
    const treeSnapshot = repositoryTree;

    setRepositoryTree((prev) => {
      const { tree, changed } = patchRepositoryTreeForFolderDelete(prev, normPath);
      return changed ? tree : prev;
    });
    removeCasesByPathPrefix(casePrefix);
    if (
      selectedFolderPath === normPath ||
      (selectedFolderPath && selectedFolderPath.startsWith(`${normPath}/`))
    ) {
      setSelectedFolderPath(null);
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
    }
    invalidateCaseListWindow();

    try {
      await deleteFolder(normPath, activeRepoSlug);
      await refreshRepoStatus();
      refreshArchiveTreeInBackground();
      void loadData(activeRepoSlug, { silent: true });
    } catch (err) {
      setRepositoryTree(treeSnapshot);
      refreshArchiveTreeInBackground();
      showAppError(err?.message || "Failed to delete suite", { title: "Delete failed" });
    }
  };

  /**
   * Delete an entire top-level test project directory (all suites and cases).
   */
  const handleDeleteProject = async (node) => {
    if (!activeRepoSlug || !node?.directory_path) return;
    const dir = node.directory_path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!isArchivedProjectDirectoryPath(dir)) {
      showAppError("Only archived projects can be deleted permanently.", {
        title: "Delete not allowed",
      });
      return;
    }
    const label = node.display_name ?? node.name ?? "this project";
    const ok = await confirm({
      title: "Delete project?",
      description: `Delete the entire project "${label}" and all suites and test cases inside it? This cannot be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      variant: "danger",
    });
    if (!ok) return;
    const prefix = `${dir}/`;
    try {
      await deleteProject(dir, activeRepoSlug);
      await refreshRepoStatus();
      removeCasesByPathPrefix(prefix);
      if (selectedTestCase?.file_path?.startsWith(prefix)) setSelectedTestCase(null);
      if (selectedCaseFilePath?.startsWith(prefix)) {
        setSelectedCaseFilePath(null);
        setCaseDetail(null);
        setIsEditingCase(false);
      }
      if (selectedFolderPath === dir || (selectedFolderPath && selectedFolderPath.startsWith(prefix))) {
        setSelectedFolderPath(null);
      }
      if (contextTargetFolder === dir || (contextTargetFolder && contextTargetFolder.startsWith(prefix))) {
        setContextTargetFolder(null);
      }
      const normalizedProj = dir.replace(/\/+$/, "");
      if (projectFilter && projectFilter.replace(/\/+$/, "") === normalizedProj) {
        setProjectFilter(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("project");
        window.history.replaceState({}, "", url);
      }
      if (archivedViewOpen) {
        removeCasesByPathPrefix(prefix);
      }
      const summary = await loadData(activeRepoSlug, { silent: true });
      await refreshRepositoryTreeAfterDataChange(summary);
      invalidateCaseListWindow();
    } catch (err) {
      showAppError(err?.message || "Failed to delete project", { title: "Delete failed" });
    }
  };

  /**
   * Force a full re-scan of cases, tickets, releases, and wiki, then refresh the index.
   */
  const runFullReindex = async () => {
    if (!activeRepoSlug) return;
    setConfirmError(null);
    setIndexChooserError(null);
    setIndexOperation("full");
    setIsIndexing(true);
    try {
      await flushAllAutoSavesBeforeIndex();
      await forceReindex(activeRepoSlug);
      await reindexTickets(activeRepoSlug);
      await reindexReleases(activeRepoSlug);
      await reindexWiki(activeRepoSlug);
      // Clear before postIndexRefresh so in-flight release fetches from earlier
      // refresh events cannot repopulate with pre-reindex rows.
      resetAllReleasesCaches();
      await postIndexRefresh();
      setRefreshWorkspaceOpen(false);
      setIndexToastOpen(true);
    } catch (err) {
      const msg = err?.message ?? "Failed to reindex workspace";
      const out = Array.isArray(msg) ? msg.join(", ") : msg;
      setConfirmError(out);
      setIndexChooserError(out);
    } finally {
      setIsIndexing(false);
      setIndexOperation(null);
    }
  };


  // ---- AGB gate ----
  if (!agbChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-app text-muted">
        <p>Checking terms of service...</p>
      </div>
    );
  }

  // ---- Loading gate (only during initial boot) ----
  if (!connectionChecked) {
    return (
      <>
        <div className="flex h-screen items-center justify-center bg-app text-muted">
          <p>Checking repository connection...</p>
        </div>
        {shouldShowAgbOverlay ? (
          <TermsOfServiceOverlay
            versionLabel={agbDisplayVersion}
            onDecline={handleDeclineAgb}
            onAgree={handleAgreeAgb}
            declineDisabled={agbSubmitting}
            agreeDisabled={agbSubmitting || agbDisplayVersion == null}
            error={agbError}
          />
        ) : null}
      </>
    );
  }

  if (bootApiError) {
    return (
      <>
        <BackendBootError message={bootApiError} onRetry={handleBootRetry} />
        {shouldShowAgbOverlay ? (
          <TermsOfServiceOverlay
            versionLabel={agbDisplayVersion}
            onDecline={handleDeclineAgb}
            onAgree={handleAgreeAgb}
            declineDisabled={agbSubmitting}
            agreeDisabled={agbSubmitting || agbDisplayVersion == null}
            error={agbError}
          />
        ) : null}
      </>
    );
  }

  // ---- First-run wizard ----
  if (showConnectWizard) {
    return (
      <>
        <ConnectRepository
          onConnected={async (newSlug) => {
            setShowConnectWizard(false);
            const d = await getRepos();
            setReposList(d.repos || []);
            const slug = newSlug || resolveInitialRepoSlug(d);
            if (!slug) return;
            handleSwitchRepo(slug);
          }}
        />
        {shouldShowAgbOverlay ? (
          <TermsOfServiceOverlay
            versionLabel={agbDisplayVersion}
            onDecline={handleDeclineAgb}
            onAgree={handleAgreeAgb}
            declineDisabled={agbSubmitting}
            agreeDisabled={agbSubmitting || agbDisplayVersion == null}
            error={agbError}
          />
        ) : null}
      </>
    );
  }

  const handleAddRepoSuccess = async (newSlug) => {
    setShowAddRepoModal(false);
    const d = await getRepos();
    setReposList(d.repos || []);
    const slug = newSlug || resolveInitialRepoSlug(d);
    if (!slug) return;
    handleSwitchRepo(slug);
    setActiveView("explorer");
  };

  const handleAfterDeleteRepo = async (deletedSlug) => {
    const d = await getRepos();
    const nextRepos = Array.isArray(d.repos) ? d.repos : [];

    setReposList(nextRepos);

    // If the active workspace was deleted, reset workspace-scoped UI.
    // When it was the last workspace, jump back to the SSH/connection wizard immediately
    // (so we don't stay on an empty Explorer UI).
    if (activeRepoSlug === deletedSlug) {
      const hasAny = nextRepos.length > 0;
      const nextSlug = hasAny
        ? d.repos?.length
          ? d.repos[0].slug === deletedSlug
            ? d.repos[1]?.slug
            : d.repos[0].slug
          : null
        : null;

      setProjectFilter(null);
      setSelectedFolderPath(null);
      resetTree();
      setSelectedCaseFilePath(null);
      setCaseDetail(null);
      setIsEditingCase(false);
      setShowCreateFormInPanel(false);
      setArchivedViewOpen(false);
      setCaseFilters({});
      setRunCaseFilters({});
      setDashboardSummary(null);
      setRepoStatus(null);
      dismissAppError();

      if (!hasAny || !nextSlug) {
        setActiveRepoSlug(null);
        writeLastActiveRepoSlug(null);
        setShowConnectWizard(true);
        return;
      }

      setActiveRepoSlug(nextSlug);
      await loadData(nextSlug);
    }

    if (readLastActiveRepoSlug() === deletedSlug) {
      writeLastActiveRepoSlug(
        nextRepos.length === 0 ? null : resolveInitialRepoSlug(d),
      );
    }
  };

  const workspaceFooter = (
    <WorkspaceSwitcher
      reposList={reposList}
      activeRepoSlug={activeRepoSlug}
      onSwitchRepo={(slug) => {
        if (navigationLocked) return;
        handleSwitchRepo(slug);
      }}
      onAddWorkspace={() => {
        if (navigationLocked) return;
        setShowAddRepoModal(true);
      }}
      onAfterDeleteRepo={handleAfterDeleteRepo}
    />
  );

  const sidebarSyncAndStatus = (
    <WorkflowStatusAndSync
      workflowState={workflowState}
      workspaceKind={workspaceKind}
      onSync={handleSyncClick}
      syncLoading={confirmLoading || captureLoading || resolveLoading || syncProgressOpen}
      syncError={confirmError}
      onIndexExternal={activeRepoSlug ? () => {
        if (isIndexing) return;
        setIndexChooserError(null);
        setRefreshWorkspaceOpen(true);
      } : null}
      isIndexing={isIndexing}
    />
  );

  // ---- Main layout ----
  return (
    <>
      <AppErrorModal
        open={appError.open}
        title={appError.title}
        message={appError.message}
        onDismiss={dismissAppError}
      />
      <HelpModal
        open={helpModalOpen}
        onClose={() => setHelpModalOpen(false)}
        onOpenError={(message, opts) => showAppError(message, opts)}
      />
      <RefreshWorkspaceModal
        open={refreshWorkspaceOpen}
        onClose={() => {
          if (isIndexing) return;
          setRefreshWorkspaceOpen(false);
        }}
        loading={isIndexing}
        loadingTitle={
          indexOperation === "full"
            ? LONG_OPERATION_TITLE_FULL_REINDEX
            : LONG_OPERATION_TITLE_INCREMENTAL_REFRESH
        }
        error={indexChooserError}
        onIncremental={runIncrementalRefresh}
        onFullReindex={runFullReindex}
        />
      <IndexSuccessToast
        open={indexToastOpen}
        onClose={() => setIndexToastOpen(false)}
      />
      <UpdateNotificationToast
        open={Boolean(updateNotice)}
        version={updateNotice?.version}
        body={updateNotice?.body}
        update={updateNotice?.update}
        onClose={() => setUpdateNotice(null)}
        onDontShowAgain={() => {
          dismissUpdateNotice(updateNotice?.version);
          setUpdateNotice(null);
        }}
      />
      <div className="flex h-full min-h-0 max-h-full flex-col overflow-hidden bg-app text-ink">
        {isMacTauri() && <FramelessWindowChrome />}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <Sidebar
        reviewEnabled={reviewEnabled}
        modules={projectModules}
        updateBanner={null}
        onOpenHelp={() => setHelpModalOpen(true)}
        onOpenSettings={() => {
          if (navigationLocked) return;
          setActiveView("settings");
        }}
        settingsActive={activeView === "settings"}
        navigationLocked={navigationLocked}
        activeView={
          activeView === "addCasesToRun"
            ? "testrun"
            : activeView === "exportCases"
              ? "explorer"
              : activeView === "confirmChanges" || activeView === "resolveConflicts"
                ? confirmChangesReturnView
                : activeView
        }
        onChangeView={(view) => {
          if (navigationLocked) return;
          if (activeView === "confirmChanges" && view !== "confirmChanges") {
            clearPendingChanges(activeRepoSlug, { unstage: true }).catch(() => {});
          }
          if (activeView === "addCasesToRun" && view !== "addCasesToRun") {
            setAddCasesToRunRunId(null);
            setAddCasesToRunRunName(null);
            setAddCasesSearchChips([]);
          }
          setActiveView(view);
          if (view !== "explorer") setSelectedTestCase(null);
        }}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {isPlaygroundWorkspace && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            <span>
              You are in the local playground. Connect a remote repository to sync with your team.
            </span>
            <button
              type="button"
              onClick={() => {
                if (navigationLocked) return;
                setShowAddRepoModal(true);
              }}
              className="shrink-0 rounded border border-sky-300 bg-white px-3 py-1 text-xs font-medium text-sky-800 transition hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-900 dark:text-sky-100 dark:hover:bg-sky-800"
            >
              Connect repository
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <PersistentView active={activeView === "explorer"}>
            <TestRepository
                key={activeRepoSlug ?? ""}
                tree={displayedRepositoryTree}
                projectsReady={projectsReady}
                treeStructureLoadingPrefixes={treeStructureLoadingPrefixes}
                filteredRows={filteredRows}
                filterOptions={effectiveCaseFilters}
                archivedViewOpen={archivedViewOpen}
                onOpenArchivedView={() => {
                  setSelectedFolderPath(null);
                  setSelectedCaseFilePath(null);
                  setCaseDetail(null);
                  setIsEditingCase(false);
                  setArchivedViewOpen(true);
                }}
                onCloseArchivedView={() => {
                  setSelectedFolderPath(null);
                  setSelectedCaseFilePath(null);
                  setCaseDetail(null);
                  setIsEditingCase(false);
                  setArchivedViewOpen(false);
                }}
                dashboardSummary={dashboardSummary}
                selectedCaseFilePath={selectedCaseFilePath}
                selectedFolderPath={selectedFolderPath}
                onSelectBrowseFolder={handleSelectBrowseFolder}
                caseDetail={caseDetail}
                caseDetailLoading={caseDetailLoading}
                isEditingCase={isEditingCase}
                onSelectCase={handleSelectCaseFromTree}
                onMoveCasesToFolder={handleMoveCasesToFolder}
                onClearSelection={clearExplorerPanel}
                onToggleEdit={handleToggleEditCase}
                onSaveCase={handleAutoSaveCase}
                onPostCaseComment={handlePostCaseComment}
                onDeleteCaseComment={handleDeleteCaseComment}
                onArchiveCase={handleArchiveCase}
                onArchiveFolder={handleArchiveFolder}
                onRestoreFolder={handleRestoreFolder}
                onRestoreCase={handleRestoreCase}
                onDeleteCase={handleDeleteCase}
                showCreateFormInPanel={showCreateFormInPanel}
                onStartCreate={() => {
                  setContextTargetFolder(selectedFolderPath || null);
                  setShowCreateFormInPanel(true);
                  setSelectedCaseFilePath(null);
                  setCaseDetail(null);
                }}
                onCancelCreate={() => {
                  setShowCreateFormInPanel(false);
                  setContextTargetFolder(null);
                }}
                onCreateCase={handleCreateTestCase}
                onImportBatch={handleImportTestCasesBatch}
                onCommitInlineCase={handleCommitInlineCase}
                effectiveProjectDir={effectiveProjectDir}
                contextTargetFolder={contextTargetFolder}
                onContextCreateTestCase={openCreateTestCaseForFolder}
                onRenameFolder={handleRenameFolder}
                onCreateFolder={handleCreateFolder}
                onDeleteFolder={handleDeleteFolder}
                onDeleteProject={handleDeleteProject}
                folderRenameRemap={folderRenameRemap}
                onFolderRenameRemapConsumed={handleFolderRenameRemapConsumed}
                editorLocked={activeView === "confirmChanges"}
                onOpenCreateProject={() => {
                  setCreatingProject(true);
                }}
                creatingProject={creatingProject}
                onCommitInlineProject={handleCommitInlineProject}
                sidebarFooter={workspaceFooter}
                sidebarTitleRight={sidebarSyncAndStatus}
                activeRepoSlug={activeRepoSlug}
                onSearchCases={setRepositorySearchChips}
                activeSearchChips={repositorySearchChips}
                onImportComplete={async () => {
                  await loadData(activeRepoSlug, { silent: true });
                  setProjectFilter(null);
                  const url = new URL(window.location.href);
                  if (url.searchParams.has("project")) {
                    url.searchParams.delete("project");
                    window.history.replaceState({}, "", url);
                  }
                  invalidateAllSubtrees();
                  await refreshRepositoryTreeAfterDataChange();
                  invalidateCaseListWindow();
                }}
                csvImportDirectory={csvImportDirectory}
                onCsvImportSelectProject={(projectPath) => setCsvImportProjectDir(projectPath || null)}
                onCsvImportClosed={() => setCsvImportProjectDir(null)}
                onOpenExportCases={() => setActiveView("exportCases")}
                caseFilesDirty={repoStatus?.case_files_dirty ?? false}
                reviewEnabled={reviewEnabled}
                storageSyncConfigured={storageSyncConfigured}
                onOpenStorageSyncSettings={openStorageSyncSettings}
                gitProfileVersion={gitProfileVersion}
                allUsernames={workspaceUsernames}
                onFolderExpand={handleFolderExpand}
                loadingPrefixes={loadingPrefixes}
                loadedPrefixes={loadedPrefixes}
                priorityFilter={priorityFilter}
                onRegisterCaseListWindow={registerCaseListWindow}
                onNavigateToTicket={(row) => {
                  if (!row?.file_path) return;
                  setPendingOpenTicket(row);
                  setActiveView("tickets");
                }}
                onNavigateToWiki={(row) => {
                  if (!row?.file_path) return;
                  setPendingOpenWiki(row);
                  setActiveView("wiki");
                }}
              />
          </PersistentView>

          <PersistentView
            active={activeView === "tickets"}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <TicketsPage
              key={activeRepoSlug ?? ""}
              activeRepoSlug={activeRepoSlug}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={sidebarSyncAndStatus}
              onAfterRepoWrite={refreshRepoStatus}
              storageSyncConfigured={storageSyncConfigured}
              onOpenStorageSyncSettings={openStorageSyncSettings}
              gitProfileVersion={gitProfileVersion}
              pendingOpenTicket={pendingOpenTicket}
              onPendingOpenTicketConsumed={() => setPendingOpenTicket(null)}
              onNavigateToCase={(row) => {
                if (!row?.file_path) return;
                setPendingOpenCase(row);
                setActiveView("explorer");
              }}
              onNavigateToRun={(row) => {
                const runId = (row?.run_id || "").trim();
                if (!runId) return;
                setInitialRunId(runId);
                setActiveView("testrun");
              }}
              onNavigateToRelease={(releaseId) => {
                const id = (releaseId || "").trim();
                if (!id) return;
                setPendingOpenRelease({ release_id: id });
                setActiveView("releases");
              }}
              onNavigateToWiki={(row) => {
                if (!row?.file_path) return;
                setPendingOpenWiki(row);
                setActiveView("wiki");
              }}
            />
          </PersistentView>

          <PersistentView
            active={activeView === "releases"}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <ReleasesPage
              key={activeRepoSlug ?? ""}
              activeRepoSlug={activeRepoSlug}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={sidebarSyncAndStatus}
              onAfterRepoWrite={refreshRepoStatus}
              storageSyncConfigured={storageSyncConfigured}
              onOpenStorageSyncSettings={openStorageSyncSettings}
              gitProfileVersion={gitProfileVersion}
              pendingOpenRelease={pendingOpenRelease}
              onPendingOpenReleaseConsumed={() => setPendingOpenRelease(null)}
              onNavigateToRelease={(releaseId) => {
                const id = (releaseId || "").trim();
                if (!id) return;
                setPendingOpenRelease({ release_id: id });
                setActiveView("releases");
              }}
              onNavigateToRun={(row) => {
                const runId = (row?.run_id || "").trim();
                if (!runId) return;
                setInitialRunId(runId);
                setActiveView("testrun");
              }}
              onNavigateToWiki={(row) => {
                if (!row?.file_path) return;
                setPendingOpenWiki(row);
                setActiveView("wiki");
              }}
            />
          </PersistentView>

          <PersistentView
            active={activeView === "wiki"}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <WikiPage
              key={activeRepoSlug ?? ""}
              activeRepoSlug={activeRepoSlug}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={sidebarSyncAndStatus}
              onAfterRepoWrite={refreshRepoStatus}
              storageSyncConfigured={storageSyncConfigured}
              onOpenStorageSyncSettings={openStorageSyncSettings}
              pendingOpenWiki={pendingOpenWiki}
              onPendingOpenWikiConsumed={() => setPendingOpenWiki(null)}
              onNavigateToTicket={(row) => {
                if (!row?.file_path) return;
                setPendingOpenTicket(row);
                setActiveView("tickets");
              }}
            />
          </PersistentView>

          <PersistentView
            active={activeView === "testrun"}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <TestRun
              key={activeRepoSlug ?? ""}
              activeRepoSlug={activeRepoSlug}
              filterOptions={effectiveCaseFilters}
              runFilterOptions={effectiveRunCaseFilters}
              runs={runs}
              runsLoading={runsLoading}
              runsIncludeArchived={runsIncludeArchived}
              onRunsIncludeArchivedChange={setRunsIncludeArchived}
              onReloadRuns={() => setRunsRefreshTrigger((t) => t + 1)}
              onAfterRepoWrite={refreshRepoStatus}
              caseFilesDirty={repoStatus?.case_files_dirty ?? false}
              runFilesDirty={
                (repoStatus?.run_files_dirty ?? false) ||
                (repoStatus?.run_yaml_pending ?? false)
              }
              initialRunId={initialRunId}
              onClearInitialRunId={() => setInitialRunId(null)}
                      onOpenAddCasesToRun={(runId, runName) => {
                setSelectedFolderPath(null);
                setAddCasesToRunRunId(runId);
                setAddCasesToRunRunName(runName ?? null);
                setActiveView("addCasesToRun");
              }}
              optimisticRunCasesAdded={optimisticRunCasesAdded}
              onClearOptimisticRunCasesAdded={() => setOptimisticRunCasesAdded(null)}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={sidebarSyncAndStatus}
              onOpenExportRuns={() => setActiveView("exportRuns")}
              reviewEnabled={reviewEnabled}
              gitProfileVersion={gitProfileVersion}
              allUsernames={workspaceUsernames}
              onNavigateToTicket={(row) => {
                if (!row?.file_path) return;
                setPendingOpenTicket(row);
                setActiveView("tickets");
              }}
              onNavigateToRelease={(releaseId) => {
                const id = (releaseId || "").trim();
                if (!id) return;
                setPendingOpenRelease({ release_id: id });
                setActiveView("releases");
              }}
              onNavigateToWiki={(row) => {
                if (!row?.file_path) return;
                setPendingOpenWiki(row);
                setActiveView("wiki");
              }}
            />
          </PersistentView>

          <PersistentView
            active={activeView === "automation"}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            <Automation
              key={activeRepoSlug ?? ""}
              activeRepoSlug={activeRepoSlug}
              storageSyncConfigured={storageSyncConfigured}
              projectSyncConfig={projectSyncConfig}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={sidebarSyncAndStatus}
            />
          </PersistentView>

          {!loading && activeView === "exportCases" ? (
            <PersistentView active={activeView === "exportCases"} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ExportCasesPage
                tree={repositoryTree}
                filteredRows={filteredRows}
                filterOptions={effectiveCaseFilters}
                getCaseDetail={getCaseDetail}
                activeRepoSlug={activeRepoSlug}
                onSearchCases={setRepositorySearchChips}
                activeSearchChips={repositorySearchChips}
                onExport={async (cases, format) => {
                  if (format === "pdf") await exportCasesAsPdf(cases, "test-cases-export.pdf", activeRepoSlug);
                  else await exportCasesAsCsv(cases);
                  setActiveView("explorer");
                }}
                onCancel={() => setActiveView("explorer")}
                sidebarFooter={workspaceFooter}
                sidebarTitleRight={sidebarSyncAndStatus}
                reviewEnabled={reviewEnabled}
                onFolderExpand={handleFolderExpand}
                loadingPrefixes={loadingPrefixes}
                loadedPrefixes={loadedPrefixes}
                projectsReady={projectsReady}
                treeStructureLoadingPrefixes={treeStructureLoadingPrefixes}
                loadCasesForPrefix={loadCasesForPrefix}
                loadAllProjectPrefixes={loadAllProjectPrefixes}
              />
            </PersistentView>
          ) : null}

          {!loading && activeView === "exportRuns" ? (
            <PersistentView active={activeView === "exportRuns"} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ExportRunsPage
                runs={runs}
                getRun={getRun}
                getRunCaseContent={getRunCaseContent}
                activeRepoSlug={activeRepoSlug}
                onExport={async (runExports, format) => {
                  if (format === "pdf") await exportRunsAsPdf(runExports, "test-runs-export.pdf", activeRepoSlug);
                  else await exportRunsAsCsv(runExports);
                  setActiveView("testrun");
                }}
                onCancel={() => setActiveView("testrun")}
                sidebarFooter={workspaceFooter}
                sidebarTitleRight={sidebarSyncAndStatus}
              />
            </PersistentView>
          ) : null}

          {!loading && addCasesToRunRunId ? (
            <PersistentView active={activeView === "addCasesToRun"} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <AddCasesToRunPage
                runId={addCasesToRunRunId}
                runName={addCasesToRunRunName}
                tree={repositoryTree}
                filteredRows={addCasesPickerRows}
                filterOptions={addCasesFilterOptions}
                dashboardSummary={dashboardSummary}
                getRun={getRun}
                getCaseDetail={getCaseDetail}
                activeRepoSlug={activeRepoSlug}
                onSearchCases={setAddCasesSearchChips}
                activeSearchChips={addCasesSearchChips}
                          reviewEnabled={reviewEnabled}
                onDone={async (cases) => {
                  if (!cases?.length || !activeRepoSlug) return;
                  const runId = addCasesToRunRunId;
                  const payloadCases = cases.map((c) => ({ file_path: c.file_path }));

                  await addRunCases(runId, { cases: payloadCases }, activeRepoSlug);

                  setRuns((prev) =>
                    prev.map((r) =>
                      r.run_id === runId
                        ? {
                            ...r,
                            total_cases: (r.total_cases ?? 0) + cases.length,
                          }
                        : r,
                    ),
                  );
                  setRunsRefreshTrigger((t) => t + 1);
                  refreshRepoStatus();
                  setOptimisticRunCasesAdded({ runId, cases });
                  setAddCasesToRunRunId(null);
                  setAddCasesToRunRunName(null);
                  setAddCasesSearchChips([]);
                  setActiveView("testrun");
                }}
                onCancel={() => {
                  setAddCasesToRunRunId(null);
                  setAddCasesToRunRunName(null);
                  setAddCasesSearchChips([]);
                  setActiveView("testrun");
                }}
                sidebarFooter={workspaceFooter}
                sidebarTitleRight={sidebarSyncAndStatus}
                onFolderExpand={handleFolderExpand}
                loadingPrefixes={loadingPrefixes}
                loadedPrefixes={loadedPrefixes}
                projectsReady={projectsReady}
                treeStructureLoadingPrefixes={treeStructureLoadingPrefixes}
                loadCasesForPrefix={loadCasesForPrefix}
                loadAllProjectPrefixes={loadAllProjectPrefixes}
              />
            </PersistentView>
          ) : null}

          <PersistentView active={activeView === "confirmChanges"} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ConfirmChangesView
              repoSlug={activeRepoSlug}
              repositoryTree={repositoryTree}
              captureSnapshot={confirmCaptureSnapshot}
              captureEpoch={confirmCaptureEpoch}
              onConfirm={handleProcessConfirmView}
              onCancel={handleCancelConfirmView}
              onAllDiscarded={handleAllDiscardedConfirmView}
              onDiscardSnapshot={setConfirmCaptureSnapshot}
              onDiscardBusyChange={setDiscardLoading}
              onDiscardError={(msg) => setConfirmError(msg)}
              onEmptyChange={setConfirmChangesEmpty}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCancelConfirmView}
                    className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleProcessConfirmView}
                    disabled={confirmChangesEmpty}
                    className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:disabled:opacity-40"
                  >
                    Process
                  </button>
                </div>
              }
            />
          </PersistentView>

          <PersistentView active={activeView === "resolveConflicts"} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ResolveConflictsView
              repoSlug={activeRepoSlug}
              conflictFileContents={conflictFileContents ?? EMPTY_CONFLICT_FILE_CONTENTS}
              message={conflictResolverMessage}
              loading={resolveLoading}
              error={resolveError}
              onResolve={handleResolveRebase}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={
                <button
                  type="button"
                  onClick={handleAbortRebase}
                  disabled={resolveLoading}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
              }
            />
          </PersistentView>

          <PersistentView active={activeView === "review"}>
            <Review
              key={activeRepoSlug ?? ""}
              activeRepoSlug={activeRepoSlug}
              filterOptions={effectiveCaseFilters}
              runFilterOptions={effectiveRunCaseFilters}
              workspaceDisplayName={activeRepoDisplayName}
              onAfterApprove={refreshRepoStatus}
              sidebarFooter={workspaceFooter}
              sidebarTitleRight={sidebarSyncAndStatus}
              repositoryTree={repositoryTree}
                      gitProfileVersion={gitProfileVersion}
              allUsernames={workspaceUsernames}
              onNavigateToTicket={(row) => {
                if (!row?.file_path) return;
                setPendingOpenTicket(row);
                setActiveView("tickets");
              }}
              onNavigateToWiki={(row) => {
                if (!row?.file_path) return;
                setPendingOpenWiki(row);
                setActiveView("wiki");
              }}
            />
          </PersistentView>

          {!loading && activeView === "settings" ? (
            <SettingsPage
              theme={theme}
              onThemeChange={setTheme}
              repoPath={activeRepoMeta?.repo_path ?? repoStatus?.repo_path ?? null}
              repoSlug={activeRepoSlug}
              initialSection={settingsInitialSection}
              enableReviewSystem={reviewEnabled}
              modules={projectModules}
              onFeatureFlagsChange={handleFeatureFlagsChange}
              projectSyncConfig={projectSyncConfig}
              onProjectSyncConfigSave={handleProjectSyncConfigSave}
              onProjectSyncConfigUpdated={setProjectSyncConfig}
                      sidebarFooter={workspaceFooter}
              sidebarTitleRight={sidebarSyncAndStatus}
              storageSyncSectionFocusKey={storageSyncSectionFocusKey}
              onProfileSaved={() => setGitProfileVersion((v) => v + 1)}
            />
          ) : null}
        </div>
      </main>
        </div>

      {activeView !== "explorer" && (
        <TestCaseDetailModal
          testCase={selectedTestCase}
          reviewEnabled={reviewEnabled}
          onClose={() => setSelectedTestCase(null)}
        />
      )}

      <SyncProgressOverlay
        open={syncProgressOpen}
        phase={
          syncProgressPhase === "success"
            ? "success"
            : syncProgressPhase === "error"
              ? "error"
              : "running"
        }
        stepLabels={syncStepLabels}
        stepStatuses={syncStepStatuses}
        errorMessage={syncProgressError ?? ""}
        onDismissError={handleDismissSyncError}
      />

      <PushFailedModal
        open={showPushFailedModal}
        onConfirm={async () => {
          if (activeRepoSlug) await getPushFailedStatus(activeRepoSlug);
          setShowPushFailedModal(false);
          setPushFailedReason("network");
        }}
        reason={pushFailedReason}
      />

      <CloseUnsyncedModal
        open={showCloseUnsyncedModal}
        pushFailed={Boolean(repoStatus?.push_failed_due_to_remote)}
        onStay={handleCloseUnsyncedStay}
        onGoToConfirm={handleCloseUnsyncedGoToConfirm}
        onCloseAnyway={handleCloseUnsyncedAnyway}
      />

      {showAddRepoModal && (
        <AddRepoWizard
          variant="modal"
          onSuccess={handleAddRepoSuccess}
          onClose={() => setShowAddRepoModal(false)}
        />
      )}

        {showCreateProjectModal && (
          <CreateProjectModal
            onSubmit={handleCreateProject}
            onClose={() => setShowCreateProjectModal(false)}
          />
        )}
      </div>
      {shouldShowAgbOverlay ? (
        <TermsOfServiceOverlay
          versionLabel={agbDisplayVersion}
          onDecline={handleDeclineAgb}
          onAgree={handleAgreeAgb}
          declineDisabled={agbSubmitting}
          agreeDisabled={agbSubmitting || agbDisplayVersion == null}
          error={agbError}
        />
      ) : null}
    </>
  );
}

export default App;
