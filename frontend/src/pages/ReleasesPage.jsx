import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Rocket } from "lucide-react";
import TestRepositoryThreeColumnLayout from "../components/TestRepositoryThreeColumnLayout";
import SidebarSection from "../components/SidebarSection";
import TreeToolbar from "../components/TreeToolbar";
import { useRefetchWhenActive } from "../components/PersistentView";
import DetailPanelEmpty from "../components/DetailPanelEmpty";
import DetailPanelLoading from "../components/DetailPanelLoading";
import ReleaseSummaryPanel from "../components/ReleaseSummaryPanel";
import TicketEditorPanel from "../components/TicketEditorPanel";
import TicketProjectOverviewPanel from "../components/TicketProjectOverviewPanel";
import ReleaseNavigatorTree from "../components/ReleaseNavigatorTree";
import TreeQuerySearchBar from "../components/TreeQuerySearchBar";
import SearchToggleButton from "../components/SearchToggleButton";
import ReleaseTicketStatusPills from "../components/ReleaseTicketStatusPills";
import { ticketSearchKeys } from "../constants/searchKeys";
import { useReleaseBrowseState } from "../hooks/useReleaseBrowseState";
import { useLazyReleaseTickets } from "../hooks/useLazyReleaseTickets";
import { usePinnedReleases } from "../hooks/usePinnedReleases";
import { withParamSearchKeys } from "../utils/querySearch";
import {
  buildReleaseTree,
  parseReleaseTreePath,
  releaseTreePathForProject,
  releaseTreePathForRelease,
  normalizeReleaseId,
  releaseCacheAction,
} from "../utils/releaseTree";
import { parseReleaseId } from "../constants/releasePaths";
import { chipsToTicketQueryParams } from "../utils/ticketQuery";
import { ticketProjectDisplayName } from "../utils/sanitize";
import {
  applyOrToggleStatusChip,
  getActiveStatusFromChips,
  RELEASE_STATUS_QUICK_FILTERS,
} from "../utils/ticketStatusQuickFilter";
import {
  DEFAULT_RELEASE_LIFECYCLE_STATUS,
  RELEASE_LIFECYCLE_QUICK_FILTERS,
  shouldClearLifecycleFilterForRelease,
} from "../utils/releaseLifecycleQuickFilter";
import {
  createRelease,
  createTicket,
  deleteTicketComment,
  getReleaseDetail,
  getReleases,
  getTicketDetail,
  getTicketFilters,
  getTickets,
  getWorkspaceUsernames,
  listTicketProjects,
  postTicketComment,
  updateTicket,
} from "../services/api";
import { subscribeRefresh } from "../services/wsRefresh";
import { mergeListPreserveOrder } from "../utils/mergeListPreserveOrder";
import { registerReleasesCacheReset } from "../utils/releasesCacheRegistry";
import { flushAllAutoSavesBeforeSync } from "../utils/autoSaveFlushRegistry";

/** Ticket filters for in-release search (release already scoped by open focus). */
const RELEASE_TICKET_SEARCH_KEYS = ticketSearchKeys().filter((k) => k.key !== "release");

/**
 * Releases browser: project → release → ticket tree | detail panel.
 */
function ReleasesPage({
  activeRepoSlug = null,
  sidebarFooter = null,
  sidebarTitleRight = null,
  onAfterRepoWrite = null,
  storageSyncConfigured = false,
  onOpenStorageSyncSettings,
  gitProfileVersion = 0,
  pendingOpenRelease = null,
  onPendingOpenReleaseConsumed = null,
  onNavigateToRelease = null,
  onNavigateToRun = null,
  onNavigateToWiki = null,
}) {
  const [releases, setReleases] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchChips, setSearchChips] = useState([]);
  /** Root/project release lifecycle filter (open | shipped | cancelled | null = all). */
  const [lifecycleStatus, setLifecycleStatus] = useState(DEFAULT_RELEASE_LIFECYCLE_STATUS);
  const [ticketProjects, setTicketProjects] = useState([]);
  const [openedProjectName, setOpenedProjectName] = useState(null);
  /** Synthetic directory_path for Finder-style open-release focus (second layer). */
  const [openedReleasePath, setOpenedReleasePath] = useState(null);

  const [selectedReleasePath, setSelectedReleasePath] = useState(null);
  const [releaseDetail, setReleaseDetail] = useState(null);
  const [releaseLoading, setReleaseLoading] = useState(false);

  const [selectedTicketPath, setSelectedTicketPath] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [ticketLoading, setTicketLoading] = useState(false);
  /** Bumped only after a successful detail GET so TicketEditorPanel re-hydrates. */
  const [ticketDetailLoadGeneration, setTicketDetailLoadGeneration] = useState(0);
  const [isEditingTicket, setIsEditingTicket] = useState(false);
  const [isEditingRelease, setIsEditingRelease] = useState(false);
  /** When set, TicketEditorPanel focuses the title once after create. */
  const [autoFocusTitlePath, setAutoFocusTitlePath] = useState(null);
  const [filterOptions, setFilterOptions] = useState({});
  const [allUsernames, setAllUsernames] = useState([]);
  const selectedTicketPathRef = useRef(null);
  selectedTicketPathRef.current = selectedTicketPath;
  const ticketDetailFetchIdRef = useRef(0);
  const openedReleasePathRef = useRef(null);
  openedReleasePathRef.current = openedReleasePath;
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchOpen;
  const searchChipsRef = useRef([]);
  searchChipsRef.current = searchChips;
  const lifecycleStatusRef = useRef(lifecycleStatus);
  lifecycleStatusRef.current = lifecycleStatus;

  const [creatingReleaseInProject, setCreatingReleaseInProject] = useState(null);
  const [createError, setCreateError] = useState("");
  const releaseLoadGenRef = useRef(0);
  const selectedReleasePathRef = useRef(null);
  const releaseDetailRef = useRef(null);
  const releasesLenRef = useRef(0);
  selectedReleasePathRef.current = selectedReleasePath;
  releaseDetailRef.current = releaseDetail;
  releasesLenRef.current = releases.length;

  const { pinnedPathSet, isPinned, togglePin } = usePinnedReleases(
    activeRepoSlug,
    releases,
    ticketProjects,
  );

  const {
    releasesByProject,
    ensureProjectReleases,
    reloadProjectReleases,
    invalidateAllProjectReleases,
    ensureReleaseTickets,
    reloadReleaseTickets,
    clearReleaseTickets,
    getReleaseTickets,
    invalidateRelease,
    invalidateProject,
    patchTicketInCache,
    patchReleaseInCache,
    refreshCachesPreserveOrder,
    resetAll: resetTicketCache,
    isReleaseLoading,
    isProjectLoading,
  } = useLazyReleaseTickets(activeRepoSlug);

  const loadProjectReleases = useCallback(
    (projectName, { force = false } = {}) => {
      if (!projectName) return;
      const status = lifecycleStatusRef.current;
      const options = status ? { status } : {};
      if (force) {
        void reloadProjectReleases(projectName, options);
      } else {
        void ensureProjectReleases(projectName, options);
      }
    },
    [ensureProjectReleases, reloadProjectReleases],
  );

  const visibleProjects = useMemo(() => {
    if (!openedProjectName) return ticketProjects;
    return ticketProjects.filter((p) => p.name === openedProjectName);
  }, [ticketProjects, openedProjectName]);

  const navigatorTree = useMemo(
    () => buildReleaseTree(visibleProjects, releasesByProject),
    [visibleProjects, releasesByProject],
  );

  const {
    selectedPath,
    expanded,
    setExpanded,
    handleSelectPath: browseSelectPath,
    handleToggleExpand,
    resetBrowseState,
  } = useReleaseBrowseState({
    tree: navigatorTree,
    selectedTicketPath,
    searchOpen,
    enabled: !listLoading,
  });

  const selectedProjectName = useMemo(() => {
    const parsed = parseReleaseTreePath(selectedPath);
    return parsed?.isProjectRoot ? parsed.projectName : null;
  }, [selectedPath]);

  const releaseById = useMemo(() => {
    const map = new Map();
    for (const r of releases) {
      if (r.release_id) map.set(r.release_id, r);
    }
    for (const list of Object.values(releasesByProject)) {
      for (const r of list ?? []) {
        if (r.release_id) map.set(r.release_id, r);
      }
    }
    return map;
  }, [releases, releasesByProject]);

  const openedReleaseId = useMemo(
    () => (openedReleasePath ? parseReleaseTreePath(openedReleasePath)?.releaseId ?? null : null),
    [openedReleasePath],
  );

  const [statusCounts, setStatusCounts] = useState({});
  const [statusCountsLoading, setStatusCountsLoading] = useState(false);
  const statusCountsGenRef = useRef(0);

  const activeTicketStatusFilter = useMemo(
    () => getActiveStatusFromChips(searchChips),
    [searchChips],
  );

  const refreshStatusCounts = useCallback(async () => {
    if (!activeRepoSlug) {
      setStatusCounts({});
      setStatusCountsLoading(false);
      return;
    }

    // Inside a release: ticket workflow counts.
    if (openedReleaseId) {
      const projectName =
        openedProjectName || parseReleaseId(openedReleaseId)?.project || null;
      const gen = ++statusCountsGenRef.current;
      setStatusCountsLoading(true);
      try {
        const entries = await Promise.all(
          RELEASE_STATUS_QUICK_FILTERS.map(async ({ value }) => {
            const res = await getTickets(activeRepoSlug, {
              release: openedReleaseId,
              project: projectName || undefined,
              status: value,
              limit: 1,
              offset: 0,
            });
            const total = typeof res?.total === "number" ? res.total : 0;
            return [value, total];
          }),
        );
        if (gen !== statusCountsGenRef.current) return;
        setStatusCounts(Object.fromEntries(entries));
      } catch {
        if (gen !== statusCountsGenRef.current) return;
        setStatusCounts({});
      } finally {
        if (gen === statusCountsGenRef.current) setStatusCountsLoading(false);
      }
      return;
    }

    // Root / project: release lifecycle counts.
    const gen = ++statusCountsGenRef.current;
    setStatusCountsLoading(true);
    try {
      const entries = await Promise.all(
        RELEASE_LIFECYCLE_QUICK_FILTERS.map(async ({ value }) => {
          const params = { status: value, limit: 1, offset: 0 };
          if (openedProjectName) params.project = openedProjectName;
          const res = await getReleases(activeRepoSlug, params);
          const total = typeof res?.total === "number" ? res.total : 0;
          return [value, total];
        }),
      );
      if (gen !== statusCountsGenRef.current) return;
      setStatusCounts(Object.fromEntries(entries));
    } catch {
      if (gen !== statusCountsGenRef.current) return;
      setStatusCounts({});
    } finally {
      if (gen === statusCountsGenRef.current) setStatusCountsLoading(false);
    }
  }, [activeRepoSlug, openedReleaseId, openedProjectName]);

  useEffect(() => {
    void refreshStatusCounts();
  }, [refreshStatusCounts]);

  /** When lifecycle filter changes at root/project, reload visible project release lists. */
  useEffect(() => {
    if (!activeRepoSlug || openedReleasePath) return;
    invalidateAllProjectReleases();
    if (openedProjectName) {
      loadProjectReleases(openedProjectName, { force: true });
      return;
    }
    for (const pathKey of expanded) {
      const parsed = parseReleaseTreePath(pathKey);
      if (parsed?.isProjectRoot) {
        loadProjectReleases(parsed.projectName, { force: true });
      }
    }
    // Intentionally omit expanded/loadProjectReleases identity churn; run on filter/focus changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when lifecycle filter or focus changes
  }, [activeRepoSlug, lifecycleStatus, openedProjectName, openedReleasePath]);

  const releasesRef = useRef([]);
  releasesRef.current = releases;

  const reloadReleases = useCallback(async ({ resort = true } = {}) => {
    if (!activeRepoSlug) {
      setReleases([]);
      releasesRef.current = [];
      return;
    }
    const isInitial = releasesLenRef.current === 0;
    if (isInitial) setListLoading(true);
    try {
      const res = await getReleases(activeRepoSlug, {
        limit: 200,
        offset: 0,
      });
      const list = Array.isArray(res?.items) ? res.items : [];
      const next = resort
        ? list
        : mergeListPreserveOrder(releasesRef.current, list, (r) => r.file_path || r.release_id);
      setReleases(next);
      releasesRef.current = next;
    } catch {
      setReleases([]);
      releasesRef.current = [];
    } finally {
      if (isInitial) setListLoading(false);
    }
  }, [activeRepoSlug]);

  const reloadFilters = useCallback(async () => {
    if (!activeRepoSlug) return;
    try {
      const tp = await listTicketProjects(activeRepoSlug);
      setTicketProjects(Array.isArray(tp) ? tp : []);
    } catch {
      setTicketProjects([]);
    }
  }, [activeRepoSlug]);

  const clearTicketSelection = useCallback(() => {
    ticketDetailFetchIdRef.current += 1;
    setSelectedTicketPath(null);
    setTicketDetail(null);
    setIsEditingTicket(false);
    setAutoFocusTitlePath(null);
    setTicketLoading(false);
  }, []);

  useEffect(() => {
    setIsEditingRelease(false);
  }, [selectedReleasePath]);

  /**
   * Refresh releases tree data. While editing a ticket, keep the open detail draft
   * unless the file is gone, then exit edit and clear selection.
   * @param {{ resort?: boolean }} [opts] - full reset+sort only when explicitly requested
   *   (e.g. project switch); navigate-back and in-menu WS refresh preserve order.
   */
  const reloadFromBackend = useCallback(
    async ({ resort = false } = {}) => {
      const ticketPath = selectedTicketPathRef.current;
      if (resort) {
        resetTicketCache();
        await Promise.all([reloadReleases({ resort: true }), reloadFilters()]);
      } else {
        await Promise.all([
          reloadReleases({ resort: false }),
          reloadFilters(),
          refreshCachesPreserveOrder(),
        ]);
        const releasePath = openedReleasePathRef.current;
        const chips = searchChipsRef.current;
        if (searchOpenRef.current && chips.length > 0 && releasePath) {
          const parsed = parseReleaseTreePath(releasePath);
          if (parsed?.releaseId) {
            await reloadReleaseTickets(
              parsed.releaseId,
              parsed.projectName,
              chipsToTicketQueryParams(chips),
            );
          }
        }
      }
      void refreshStatusCounts();
      if (!ticketPath || !activeRepoSlug) return;
      try {
        await getTicketDetail(ticketPath, activeRepoSlug);
        // Still exists — do not overwrite detail while editing (preserve draft).
      } catch {
        clearTicketSelection();
      }
    },
    [
      activeRepoSlug,
      reloadReleases,
      reloadFilters,
      resetTicketCache,
      refreshCachesPreserveOrder,
      reloadReleaseTickets,
      clearTicketSelection,
      refreshStatusCounts,
    ],
  );

  const reloadFromBackendRef = useRef(reloadFromBackend);
  reloadFromBackendRef.current = reloadFromBackend;

  /** Stable: only re-run when the Releases view becomes active (not on search churn). */
  const onViewActive = useCallback(() => {
    void reloadFromBackendRef.current({ resort: false });
  }, []);

  useRefetchWhenActive(onViewActive);

  useEffect(() => {
    return registerReleasesCacheReset(resetTicketCache);
  }, [resetTicketCache]);

  useEffect(() => {
    return subscribeRefresh(() => {
      void reloadFromBackendRef.current({ resort: false });
    });
  }, []);

  useEffect(() => {
    if (!activeRepoSlug) {
      setFilterOptions({});
      setAllUsernames([]);
      return;
    }
    getTicketFilters(activeRepoSlug)
      .then((opts) => setFilterOptions(opts || {}))
      .catch(() => setFilterOptions({}));
    getWorkspaceUsernames(activeRepoSlug)
      .then((res) => setAllUsernames(Array.isArray(res?.usernames) ? res.usernames : []))
      .catch(() => setAllUsernames([]));
  }, [activeRepoSlug]);

  /** Apply ticket filters while a release is open and search is active (or chips remain). */
  useEffect(() => {
    if (!activeRepoSlug || !openedReleaseId) return;
    if (!searchOpen && searchChips.length === 0) return;
    const projectName =
      openedProjectName || parseReleaseId(openedReleaseId)?.project || null;
    void reloadReleaseTickets(
      openedReleaseId,
      projectName,
      chipsToTicketQueryParams(searchChips),
    );
  }, [
    activeRepoSlug,
    openedReleaseId,
    openedProjectName,
    searchOpen,
    searchChips,
    reloadReleaseTickets,
  ]);

  useEffect(() => {
    releaseLoadGenRef.current += 1;
    setSelectedReleasePath(null);
    setSelectedTicketPath(null);
    setReleaseDetail(null);
    setTicketDetail(null);
    setIsEditingTicket(false);
    setIsEditingRelease(false);
    setAutoFocusTitlePath(null);
    setCreatingReleaseInProject(null);
    setCreateError("");
    setReleaseLoading(false);
    setOpenedProjectName(null);
    setOpenedReleasePath(null);
    setSearchOpen(false);
    setSearchChips([]);
    setLifecycleStatus(DEFAULT_RELEASE_LIFECYCLE_STATUS);
    resetBrowseState();
    resetTicketCache();
  }, [activeRepoSlug, resetBrowseState, resetTicketCache]);

  // Drop stale open-focus if the project disappeared after a reload.
  useEffect(() => {
    if (!openedProjectName || ticketProjects.length === 0) return;
    if (!ticketProjects.some((p) => p.name === openedProjectName)) {
      const releaseId = openedReleasePath
        ? parseReleaseTreePath(openedReleasePath)?.releaseId
        : null;
      if (releaseId) clearReleaseTickets(releaseId);
      setSearchOpen(false);
      setSearchChips([]);
      setOpenedProjectName(null);
      setOpenedReleasePath(null);
    }
  }, [openedProjectName, ticketProjects, openedReleasePath, clearReleaseTickets]);

  // Drop stale open-release if it disappeared after a project releases reload.
  // Use the unfiltered catalog (releaseById) so lifecycle filters do not eject an open release.
  useEffect(() => {
    if (!openedReleasePath || !openedProjectName) return;
    if (!Object.prototype.hasOwnProperty.call(releasesByProject, openedProjectName)) return;
    const releaseId = parseReleaseTreePath(openedReleasePath)?.releaseId;
    if (!releaseId) return;
    if (releaseById.has(releaseId)) return;
    if (releasesLenRef.current === 0) return;
    clearReleaseTickets(releaseId);
    setSearchOpen(false);
    setSearchChips([]);
    setOpenedReleasePath(null);
  }, [
    openedReleasePath,
    openedProjectName,
    releasesByProject,
    releaseById,
    clearReleaseTickets,
  ]);

  // After cache clear, reload data for still-expanded nodes.
  useEffect(() => {
    if (!activeRepoSlug || expanded.size === 0) return;
    for (const pathKey of expanded) {
      const parsed = parseReleaseTreePath(pathKey);
      if (!parsed) continue;
      if (parsed.isProjectRoot) {
        if (!Object.prototype.hasOwnProperty.call(releasesByProject, parsed.projectName)) {
          loadProjectReleases(parsed.projectName);
        }
      } else if (parsed.isRelease && parsed.releaseId) {
        if (getReleaseTickets(parsed.releaseId) == null) {
          void ensureReleaseTickets(parsed.releaseId, parsed.projectName);
        }
      }
    }
  }, [
    activeRepoSlug,
    expanded,
    releasesByProject,
    loadProjectReleases,
    ensureReleaseTickets,
    getReleaseTickets,
  ]);

  const loadReleaseDetail = useCallback(
    async (filePath) => {
      if (!filePath || !activeRepoSlug) {
        setReleaseDetail(null);
        return;
      }
      if (
        releaseDetailRef.current?.file_path === filePath &&
        selectedReleasePathRef.current === filePath
      ) {
        return;
      }
      const gen = ++releaseLoadGenRef.current;
      if (!releaseDetailRef.current) {
        setReleaseLoading(true);
      }
      try {
        const d = await getReleaseDetail(filePath, activeRepoSlug);
        if (gen !== releaseLoadGenRef.current) return;
        setReleaseDetail(d);
      } catch {
        if (gen !== releaseLoadGenRef.current) return;
        setReleaseDetail(null);
      } finally {
        if (gen === releaseLoadGenRef.current) {
          setReleaseLoading(false);
        }
      }
    },
    [activeRepoSlug],
  );

  const ensureReleaseContext = useCallback(
    (releaseId) => {
      const row = releaseById.get(releaseId);
      if (!row?.file_path) return;
      if (
        row.file_path === selectedReleasePathRef.current &&
        releaseDetailRef.current?.file_path === row.file_path
      ) {
        return;
      }
      setSelectedReleasePath(row.file_path);
      void loadReleaseDetail(row.file_path);
    },
    [releaseById, loadReleaseDetail],
  );

  const selectReleaseById = useCallback(
    (releaseId) => {
      setSelectedTicketPath(null);
      setTicketDetail(null);
      setIsEditingTicket(false);
      ensureReleaseContext(releaseId);
    },
    [ensureReleaseContext],
  );

  const handleSelectPath = useCallback(
    (path) => {
      if (!path) return;
      browseSelectPath(path);
      const parsed = parseReleaseTreePath(path);
      if (!parsed) return;
      if (parsed.isProjectRoot) {
        setSelectedTicketPath(null);
        setTicketDetail(null);
        setIsEditingTicket(false);
        setSelectedReleasePath(null);
        setReleaseDetail(null);
        loadProjectReleases(parsed.projectName);
        return;
      }
      if (parsed.isRelease && parsed.releaseId) {
        selectReleaseById(parsed.releaseId);
        void ensureReleaseTickets(parsed.releaseId, parsed.projectName);
      }
    },
    [browseSelectPath, selectReleaseById, loadProjectReleases, ensureReleaseTickets],
  );

  const handleSelectTicket = useCallback(
    async (ticket) => {
      const filePath = ticket?.file_path;
      if (!filePath || !activeRepoSlug) return;
      await flushAllAutoSavesBeforeSync();
      setIsEditingRelease(false);
      setSelectedTicketPath(filePath);
      const fetchId = ++ticketDetailFetchIdRef.current;
      setTicketLoading(true);
      try {
        const d = await getTicketDetail(filePath, activeRepoSlug);
        if (ticketDetailFetchIdRef.current !== fetchId) return;
        if (selectedTicketPathRef.current !== filePath) return;
        setTicketDetail(d);
        setTicketDetailLoadGeneration((g) => g + 1);
        if (d?.release) {
          ensureReleaseContext(d.release);
          const releasePath = releaseTreePathForRelease(d.release);
          if (releasePath) browseSelectPath(releasePath);
        }
      } catch {
        if (ticketDetailFetchIdRef.current !== fetchId) return;
        if (selectedTicketPathRef.current !== filePath) return;
        setTicketDetail(null);
      } finally {
        if (ticketDetailFetchIdRef.current === fetchId) {
          setTicketLoading(false);
        }
      }
    },
    [activeRepoSlug, ensureReleaseContext, browseSelectPath],
  );

  const handleToggleExpandWithLoad = useCallback(
    (pathKey, options) => {
      const willExpand = options?.expandOnly || !expanded.has(pathKey);
      if (!willExpand) {
        handleToggleExpand(pathKey, options);
        return;
      }
      handleToggleExpand(pathKey, { expandOnly: true });
      const parsed = parseReleaseTreePath(pathKey);
      if (parsed?.isProjectRoot) {
        loadProjectReleases(parsed.projectName);
      } else if (parsed?.isRelease && parsed.releaseId) {
        void ensureReleaseTickets(parsed.releaseId, parsed.projectName);
      }
    },
    [expanded, loadProjectReleases, ensureReleaseTickets, handleToggleExpand],
  );

  const handleCancelCreateRelease = useCallback(() => {
    setCreatingReleaseInProject(null);
    setCreateError("");
  }, []);

  const handleOpenProject = useCallback(
    (projectName) => {
      if (!projectName) return;
      const prevReleaseId = openedReleasePath
        ? parseReleaseTreePath(openedReleasePath)?.releaseId
        : null;
      if (prevReleaseId) clearReleaseTickets(prevReleaseId);
      setSearchOpen(false);
      setSearchChips([]);
      setOpenedProjectName(projectName);
      setOpenedReleasePath(null);
      clearTicketSelection();
      setSelectedReleasePath(null);
      setReleaseDetail(null);
      setCreatingReleaseInProject(null);
      setCreateError("");
      const projectPath = releaseTreePathForProject(projectName);
      if (projectPath) {
        handleToggleExpandWithLoad(projectPath, { expandOnly: true });
        browseSelectPath(projectPath);
      }
      // Fresh API order when switching into a project (navigate-back keeps order).
      invalidateProject(projectName);
      loadProjectReleases(projectName, { force: true });
    },
    [
      openedReleasePath,
      clearReleaseTickets,
      clearTicketSelection,
      handleToggleExpandWithLoad,
      browseSelectPath,
      invalidateProject,
      loadProjectReleases,
    ],
  );

  const handleCloseOpenedProject = useCallback(() => {
    const projectName = openedProjectName;
    const releasePath = openedReleasePath;
    const releaseId = releasePath ? parseReleaseTreePath(releasePath)?.releaseId : null;
    if (releaseId) clearReleaseTickets(releaseId);
    setSearchOpen(false);
    setSearchChips([]);
    setOpenedProjectName(null);
    setOpenedReleasePath(null);
    // Collapse on Back — user is leaving focus to switch projects.
    const projectPath = projectName ? releaseTreePathForProject(projectName) : null;
    if (projectPath || releasePath) {
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        if (releasePath && next.has(releasePath)) {
          next.delete(releasePath);
          changed = true;
        }
        if (projectPath && next.has(projectPath)) {
          next.delete(projectPath);
          changed = true;
        }
        return changed ? next : prev;
      });
    }
  }, [openedProjectName, openedReleasePath, clearReleaseTickets, setExpanded]);

  const handleOpenRelease = useCallback(
    async (releaseNodeOrPath) => {
      const releasePath =
        typeof releaseNodeOrPath === "string"
          ? releaseNodeOrPath
          : releaseNodeOrPath?.directory_path;
      if (!releasePath) return;

      const releaseId =
        typeof releaseNodeOrPath === "string"
          ? parseReleaseTreePath(releasePath)?.releaseId
          : releaseNodeOrPath?.release_id;
      const projectName =
        (typeof releaseNodeOrPath === "object" &&
          (releaseNodeOrPath?.project_name || releaseNodeOrPath?.project)) ||
        parseReleaseTreePath(releasePath)?.projectName ||
        (releaseId ? parseReleaseId(releaseId)?.project : null);
      if (!projectName) return;

      if (
        shouldClearLifecycleFilterForRelease({
          releaseId,
          projectName,
          lifecycleStatus: lifecycleStatusRef.current,
          releasesByProject,
          releaseRow: releaseById.get(releaseId),
        })
      ) {
        setLifecycleStatus(null);
        lifecycleStatusRef.current = null;
        await reloadProjectReleases(projectName, {});
      }

      const prevReleaseId = openedReleasePath
        ? parseReleaseTreePath(openedReleasePath)?.releaseId
        : null;
      if (prevReleaseId && prevReleaseId !== releaseId) {
        clearReleaseTickets(prevReleaseId);
      }
      setSearchOpen(false);
      setSearchChips([]);
      setOpenedProjectName(projectName);
      setOpenedReleasePath(releasePath);
      clearTicketSelection();
      setCreatingReleaseInProject(null);
      setCreateError("");

      const projectPath = releaseTreePathForProject(projectName);
      if (projectPath) {
        void handleToggleExpandWithLoad(projectPath, { expandOnly: true });
      }
      void handleToggleExpandWithLoad(releasePath, { expandOnly: true });
      handleSelectPath(releasePath);
    },
    [
      openedReleasePath,
      releasesByProject,
      releaseById,
      reloadProjectReleases,
      clearReleaseTickets,
      clearTicketSelection,
      handleToggleExpandWithLoad,
      handleSelectPath,
    ],
  );

  const handleCloseOpenedRelease = useCallback(() => {
    const releasePath = openedReleasePath;
    const releaseId = releasePath ? parseReleaseTreePath(releasePath)?.releaseId : null;
    if (releaseId) clearReleaseTickets(releaseId);
    setSearchOpen(false);
    setSearchChips([]);
    setOpenedReleasePath(null);
    setLifecycleStatus(DEFAULT_RELEASE_LIFECYCLE_STATUS);
    // Collapse the focused release; stay in project-open.
    if (releasePath) {
      setExpanded((prev) => {
        if (!prev.has(releasePath)) return prev;
        const next = new Set(prev);
        next.delete(releasePath);
        return next;
      });
    }
  }, [openedReleasePath, clearReleaseTickets, setExpanded]);

  /**
   * Instant create under a release (context menu): same defaults as Tickets page,
   * with release pre-filled; then open detail in edit mode with title focused.
   */
  const handleCreateTicketUnderRelease = useCallback(
    async (releaseNode) => {
      if (!activeRepoSlug || !releaseNode) return;
      const releaseId = (releaseNode.release_id || "").trim();
      const project =
        releaseNode.project_name ||
        releaseNode.project ||
        parseReleaseId(releaseId)?.project ||
        null;
      if (!releaseId || !project) return;

      const releasePath =
        releaseNode.directory_path || releaseTreePathForRelease(releaseId);
      if (releasePath && openedReleasePath !== releasePath) {
        handleOpenRelease(releaseNode);
      } else if (releasePath) {
        void handleToggleExpandWithLoad(releasePath, { expandOnly: true });
      }

      if (searchOpenRef.current) {
        setSearchOpen(false);
        setSearchChips([]);
      }

      try {
        const res = await createTicket(
          {
            project,
            release: releaseId,
            title: "New ticket",
            type: "task",
            status: "open",
            priority: "medium",
          },
          activeRepoSlug,
        );

        await reloadReleaseTickets(releaseId, project, {});

        if (res?.file_path) {
          await handleSelectTicket({ file_path: res.file_path, release: releaseId });
          setAutoFocusTitlePath(res.file_path);
          setIsEditingTicket(true);
        }
        void refreshStatusCounts();
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to create ticket");
      }
    },
    [
      activeRepoSlug,
      openedReleasePath,
      handleOpenRelease,
      handleToggleExpandWithLoad,
      reloadReleaseTickets,
      handleSelectTicket,
      refreshStatusCounts,
      onAfterRepoWrite,
    ],
  );

  const handleTitleFocused = useCallback(() => {
    setAutoFocusTitlePath(null);
  }, []);

  // Deep-link from ticket Release field: open release focus then clear pending.
  useEffect(() => {
    const releaseId = (pendingOpenRelease?.release_id || "").trim();
    if (!releaseId) return;
    const path = releaseTreePathForRelease(releaseId);
    if (path) {
      handleOpenRelease(path);
    }
    onPendingOpenReleaseConsumed?.();
  }, [pendingOpenRelease, handleOpenRelease, onPendingOpenReleaseConsumed]);

  const handleStartCreateRelease = useCallback(
    (projectName) => {
      if (!projectName) return;
      setCreateError("");
      const projectPath = releaseTreePathForProject(projectName);
      if (projectPath) {
        handleToggleExpandWithLoad(projectPath, { expandOnly: true });
        browseSelectPath(projectPath);
      }
      setCreatingReleaseInProject(projectName);
    },
    [handleToggleExpandWithLoad, browseSelectPath],
  );

  const handleCommitCreateRelease = useCallback(
    async (projectName, rawName) => {
      if (!activeRepoSlug || !projectName) {
        setCreateError("Select a project before creating a release.");
        return;
      }
      const name = (rawName || "").trim();
      if (!name) {
        handleCancelCreateRelease();
        return;
      }

      setCreateError("");
      try {
        const res = await createRelease(
          {
            name,
            project: projectName,
            status: "open",
            body: "",
          },
          activeRepoSlug,
        );

        if (res?.file_path && res?.release_id) {
          setCreatingReleaseInProject(null);
          setCreateError("");
          setSelectedTicketPath(null);
          setTicketDetail(null);
          setIsEditingTicket(false);

          invalidateProject(projectName);
          await reloadProjectReleases(projectName, {
            status: lifecycleStatusRef.current || undefined,
          });

          setSelectedReleasePath(res.file_path);
          const path = releaseTreePathForRelease(res.release_id);
          if (path) {
            handleToggleExpand(releaseTreePathForProject(projectName), { expandOnly: true });
            browseSelectPath(path);
          }
          await loadReleaseDetail(res.file_path);
        }

        await reloadReleases();
        await reloadFilters();
        void refreshStatusCounts();
        onAfterRepoWrite?.();
      } catch (e) {
        setCreateError(e?.message || "Failed to create release");
      }
    },
    [
      activeRepoSlug,
      handleCancelCreateRelease,
      invalidateProject,
      reloadProjectReleases,
      handleToggleExpand,
      browseSelectPath,
      loadReleaseDetail,
      reloadReleases,
      reloadFilters,
      refreshStatusCounts,
      onAfterRepoWrite,
    ],
  );

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchChips([]);
    if (openedReleaseId) {
      const projectName =
        openedProjectName || parseReleaseId(openedReleaseId)?.project || null;
      void reloadReleaseTickets(openedReleaseId, projectName, {});
    }
  }, [openedReleaseId, openedProjectName, reloadReleaseTickets]);

  const handleSearch = useCallback((chips) => {
    setSearchChips(chips || []);
  }, []);

  const handleStatusQuickFilter = useCallback(
    (statusOrNull) => {
      if (!openedReleaseId) return;
      const next =
        statusOrNull == null
          ? searchChips.filter((c) => c?.key !== "status")
          : applyOrToggleStatusChip(searchChips, statusOrNull);
      // Empty chips → same as Back: close search and reload unfiltered.
      if (next.length === 0) {
        handleCloseSearch();
        return;
      }
      setSearchChips(next);
      setSearchOpen(true);
    },
    [openedReleaseId, searchChips, handleCloseSearch],
  );

  const handleLifecycleStatusFilter = useCallback((statusOrNull) => {
    setLifecycleStatus(statusOrNull);
  }, []);

  const handleSearchClick = useCallback(() => {
    if (searchOpen) {
      handleCloseSearch();
      return;
    }
    setSearchOpen(true);
  }, [searchOpen, handleCloseSearch]);

  const handleAutoSaveTicket = useCallback(
    async (draft) => {
      const pathAtSave = draft?.file_path || selectedTicketPathRef.current;
      if (!pathAtSave || !activeRepoSlug) return;
      const oldReleaseId = normalizeReleaseId(
        selectedTicketPathRef.current === pathAtSave ? ticketDetail?.release : null,
      );
      const updated = await updateTicket(pathAtSave, draft, activeRepoSlug);
      // Merge into the open panel only when it still shows this file.
      // Do not bump ticketDetailLoadGeneration — that would wipe the live draft mid-edit.
      if (selectedTicketPathRef.current === pathAtSave && updated?.file_path) {
        setTicketDetail(updated);
      }

      const newReleaseId =
        draft.release !== undefined
          ? normalizeReleaseId(draft.release)
          : normalizeReleaseId(updated?.release ?? oldReleaseId);

      const cacheAction = releaseCacheAction(oldReleaseId, newReleaseId);
      for (const id of cacheAction.invalidate) {
        invalidateRelease(id);
      }
      for (const id of cacheAction.ensure) {
        const parsed = parseReleaseId(id);
        if (parsed) {
          invalidateProject(parsed.project);
          await reloadProjectReleases(parsed.project, {
            status: lifecycleStatusRef.current || undefined,
          });
          await ensureReleaseTickets(id, parsed.project);
        }
      }
      if (cacheAction.patch && oldReleaseId) {
        patchTicketInCache(oldReleaseId, pathAtSave, {
          title: draft.title ?? ticketDetail?.title,
          type: draft.type ?? ticketDetail?.type,
          status: draft.status ?? ticketDetail?.status,
          priority: draft.priority ?? ticketDetail?.priority,
          tags: draft.tags ?? ticketDetail?.tags,
          assigned_to: draft.assigned_to ?? ticketDetail?.assigned_to,
          sprint: draft.sprint ?? ticketDetail?.sprint,
          release: newReleaseId,
          parent: draft.parent ?? ticketDetail?.parent,
        });
      }
      if (cacheAction.invalidate.length > 0) {
        await reloadReleases();
      }

      void refreshStatusCounts();
      onAfterRepoWrite?.();
    },
    [
      activeRepoSlug,
      ticketDetail,
      releaseDetail?.release_id,
      invalidateRelease,
      invalidateProject,
      patchTicketInCache,
      reloadProjectReleases,
      ensureReleaseTickets,
      reloadReleases,
      refreshStatusCounts,
      onAfterRepoWrite,
    ],
  );

  const handleToggleEditTicket = useCallback((toEdit, draft) => {
    if (toEdit === false && draft != null && selectedTicketPath != null) {
      setTicketDetail((prev) => {
        if (!prev || prev.file_path !== selectedTicketPath) return prev;
        const tags = Array.isArray(draft.tags)
          ? draft.tags
          : (draft.tagsStr ?? "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
        return {
          ...prev,
          title: draft.title ?? prev.title,
          type: draft.type ?? prev.type,
          status: draft.status ?? prev.status,
          priority: draft.priority ?? prev.priority,
          tags,
          assigned_to:
            draft.assigned_to !== undefined
              ? (draft.assigned_to || "").trim() || null
              : prev.assigned_to,
          sprint:
            draft.sprint !== undefined ? (draft.sprint || "").trim() || null : prev.sprint,
          release:
            draft.release !== undefined ? (draft.release || "").trim() || null : prev.release,
          parent:
            draft.parent !== undefined ? (draft.parent || "").trim() || null : prev.parent,
          body: draft.body ?? prev.body,
        };
      });
    }
    setIsEditingTicket(!!toEdit);
  }, [selectedTicketPath]);

  const handleToggleEditRelease = useCallback((toEdit, draft) => {
    if (toEdit === false && draft != null && selectedReleasePath != null) {
      setReleaseDetail((prev) => {
        if (!prev || prev.file_path !== selectedReleasePath) return prev;
        return {
          ...prev,
          name: draft.name ?? prev.name,
          status: draft.status ?? prev.status,
          body: draft.body ?? prev.body,
        };
      });
    }
    setIsEditingRelease(!!toEdit);
  }, [selectedReleasePath]);

  const handlePostComment = useCallback(
    async (filePath, text) => {
      if (!activeRepoSlug) return;
      const updated = await postTicketComment(filePath, text, activeRepoSlug);
      if (selectedTicketPath === filePath) setTicketDetail(updated);
      onAfterRepoWrite?.();
    },
    [activeRepoSlug, selectedTicketPath, onAfterRepoWrite],
  );

  const handleDeleteComment = useCallback(
    async (filePath, index) => {
      if (!activeRepoSlug) return;
      const updated = await deleteTicketComment(filePath, index, activeRepoSlug);
      if (selectedTicketPath === filePath) setTicketDetail(updated);
      onAfterRepoWrite?.();
    },
    [activeRepoSlug, selectedTicketPath, onAfterRepoWrite],
  );

  const handleOpenTicket = useCallback(
    async (row) => {
      if (!row?.file_path) return;
      const releaseId = row.release ?? row.release_id ?? ticketDetail?.release;
      if (releaseId) {
        const parsed = parseReleaseId(releaseId);
        if (parsed) {
          const projectPath = releaseTreePathForProject(parsed.project);
          const releasePath = releaseTreePathForRelease(releaseId);
          await handleToggleExpandWithLoad(projectPath, { expandOnly: true });
          if (releasePath) {
            await handleToggleExpandWithLoad(releasePath, { expandOnly: true });
            browseSelectPath(releasePath);
          }
        }
      }
      await handleSelectTicket(row);
    },
    [ticketDetail?.release, handleToggleExpandWithLoad, browseSelectPath, handleSelectTicket],
  );

  const ticketFilterOptions = useMemo(() => {
    const assignees = filterOptions?.assigned_to?.length
      ? filterOptions.assigned_to
      : allUsernames;
    return {
      ...filterOptions,
      assigned_to: assignees || [],
    };
  }, [filterOptions, allUsernames]);

  const effectiveTicketSearchKeys = useMemo(
    () => withParamSearchKeys(RELEASE_TICKET_SEARCH_KEYS, ticketFilterOptions),
    [ticketFilterOptions],
  );

  const ticketSearchButton = openedReleasePath ? (
    <SearchToggleButton
      isOpen={searchOpen}
      hasActiveChips={searchChips.length > 0}
      onClick={handleSearchClick}
      ariaLabelWhenClosed="Filter tickets"
    />
  ) : null;

  const statusQuickFilters =
    openedReleasePath != null ? (
      <ReleaseTicketStatusPills
        counts={statusCounts}
        activeStatus={activeTicketStatusFilter}
        onSelect={handleStatusQuickFilter}
        loading={statusCountsLoading}
        entityLabel="tickets"
      />
    ) : (
      <ReleaseTicketStatusPills
        filters={RELEASE_LIFECYCLE_QUICK_FILTERS}
        counts={statusCounts}
        activeStatus={lifecycleStatus}
        onSelect={handleLifecycleStatusFilter}
        loading={statusCountsLoading}
        entityLabel="releases"
      />
    );

  const toolbarSearchNode = (
    <div className="flex min-w-0 max-w-full items-center gap-1">
      {statusQuickFilters}
      {ticketSearchButton}
    </div>
  );

  let detailColumn;
  if (selectedTicketPath) {
    if (ticketLoading && !ticketDetail) {
      detailColumn = <DetailPanelLoading />;
    } else if (!ticketDetail) {
      detailColumn = <DetailPanelEmpty />;
    } else {
      detailColumn = (
        <TicketEditorPanel
          ticketDetail={ticketDetail}
          selectedTicketFilePath={selectedTicketPath}
          ticketDetailLoading={ticketLoading}
          ticketDetailLoadGeneration={ticketDetailLoadGeneration}
          isEditing={isEditingTicket}
          autoFocusTitlePath={autoFocusTitlePath}
          onTitleFocused={handleTitleFocused}
          onToggleEdit={handleToggleEditTicket}
          onSave={handleAutoSaveTicket}
          onPostComment={handlePostComment}
          onDeleteComment={handleDeleteComment}
          allTags={filterOptions?.tags}
          paramKeys={filterOptions?.param_keys}
          paramValuesByKey={filterOptions?.param_values_by_key}
          allUsernames={allUsernames}
          repoSlug={activeRepoSlug}
          gitProfileVersion={gitProfileVersion}
          onOpenTicket={handleOpenTicket}
          onNavigateToRelease={onNavigateToRelease}
          onOpenWikiPage={onNavigateToWiki}
          storageSyncConfigured={storageSyncConfigured}
          onOpenStorageSyncSettings={onOpenStorageSyncSettings}
        />
      );
    }
  } else if (selectedReleasePath) {
    detailColumn = (
      <ReleaseSummaryPanel
        releaseDetail={releaseDetail}
        loading={releaseLoading}
        repoSlug={activeRepoSlug}
        isEditing={isEditingRelease}
        onToggleEdit={handleToggleEditRelease}
        onNavigateToRun={onNavigateToRun}
        onAfterRepoWrite={onAfterRepoWrite}
        onSaved={(updated) => {
          setReleaseDetail(updated);
          if (updated?.file_path || updated?.release_id) {
            const patch = {
              name: updated.name,
              status: updated.status,
              updated_at: updated.updated_at,
              updated_by: updated.updated_by,
              ticket_count: updated.ticket_count,
            };
            setReleases((prev) => {
              const next = prev.map((r) =>
                r.file_path === updated.file_path || r.release_id === updated.release_id
                  ? { ...r, ...patch }
                  : r,
              );
              releasesRef.current = next;
              return next;
            });
            if (updated.project) {
              const filterStatus = lifecycleStatusRef.current;
              const nextStatus = String(updated.status || "")
                .trim()
                .toLowerCase();
              if (
                !openedReleasePath &&
                filterStatus &&
                nextStatus &&
                nextStatus !== filterStatus
              ) {
                loadProjectReleases(updated.project, { force: true });
              } else {
                patchReleaseInCache(
                  updated.project,
                  updated.file_path || updated.release_id,
                  patch,
                );
              }
            }
          }
          void refreshStatusCounts();
          onAfterRepoWrite?.();
        }}
      />
    );
  } else if (selectedProjectName) {
    detailColumn = (
      <TicketProjectOverviewPanel
        projectName={selectedProjectName}
        displayName={ticketProjectDisplayName(selectedProjectName)}
        activeRepoSlug={activeRepoSlug}
      />
    );
  } else {
    detailColumn = <DetailPanelEmpty iconComponent={Rocket} title="Select a project or release" />;
  }

  const treeBody = listLoading && ticketProjects.length === 0 ? (
    <p className="p-3 text-xs text-slate-500">Loading…</p>
  ) : (
    <ReleaseNavigatorTree
      projects={visibleProjects}
      releasesByProject={releasesByProject}
      getReleaseTickets={getReleaseTickets}
      selectedPath={selectedPath}
      selectedTicketPath={selectedTicketPath}
      selectedTicketReleaseId={ticketDetail?.release ?? null}
      expanded={expanded}
      onToggleExpand={handleToggleExpandWithLoad}
      onSelectPath={handleSelectPath}
      onSelectTicket={handleSelectTicket}
      isReleaseLoading={isReleaseLoading}
      isProjectLoading={isProjectLoading}
      emptyMessage="No ticket projects yet."
      pinningEnabled={!searchOpen}
      pinnedPathSet={searchOpen ? null : pinnedPathSet}
      isPinnedRelease={searchOpen ? null : isPinned}
      onTogglePinRelease={searchOpen ? null : togglePin}
      creatingReleaseInProject={creatingReleaseInProject}
      createError={createError}
      onStartCreateRelease={handleStartCreateRelease}
      onCommitCreateRelease={handleCommitCreateRelease}
      onCancelCreateRelease={handleCancelCreateRelease}
      openedProjectName={openedProjectName}
      onOpenProject={handleOpenProject}
      onCloseOpenedProject={handleCloseOpenedProject}
      openedReleasePath={openedReleasePath}
      onOpenRelease={handleOpenRelease}
      onCloseOpenedRelease={handleCloseOpenedRelease}
      onCreateTicketUnderRelease={handleCreateTicketUnderRelease}
    />
  );

  const treeColumn = (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <SidebarSection
          title="Releases"
          titleRight={sidebarTitleRight}
          toolbar={
            <TreeToolbar
              addButton={null}
              sortButton={null}
              searchNode={toolbarSearchNode}
              onBeforeAction={searchOpen ? handleCloseSearch : undefined}
            />
          }
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {searchOpen && openedReleasePath ? (
          <TreeQuerySearchBar
            searchKeys={effectiveTicketSearchKeys}
            filterOptions={ticketFilterOptions}
            chips={searchChips}
            onChipsChange={handleSearch}
            placeholder="priority: high · status: open · free text"
          />
        ) : null}
        {treeBody}
      </div>
      {sidebarFooter != null ? (
        <div
          data-sidebar-footer
          className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700"
        >
          {sidebarFooter}
        </div>
      ) : null}
    </div>
  );

  return (
    <TestRepositoryThreeColumnLayout
      storageKeys={{
        treeWidth: "releases.col.treeWidth",
        listWidth: "releases.col.listWidth",
      }}
      treeColumn={treeColumn}
      caseListColumn={null}
      caseListVisible={false}
      detailColumn={detailColumn}
    />
  );
}

export default ReleasesPage;
