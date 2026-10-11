import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, FilePlus2, FolderOpen, ListTodo, RotateCcw, Trash2 } from "lucide-react";
import CaseTree from "../components/CaseTree";
import ConfirmChangesTwoColumnLayout from "../components/ConfirmChangesTwoColumnLayout";
import HiddenViewBanner from "../components/HiddenViewBanner";
import { useRefetchWhenActive } from "../components/PersistentView";
import SearchToggleButton from "../components/SearchToggleButton";
import SidebarSection from "../components/SidebarSection";
import TicketEditorPanel from "../components/TicketEditorPanel";
import TicketProjectOverviewPanel from "../components/TicketProjectOverviewPanel";
import TitleBarAddButton from "../components/TitleBarAddButton";
import Tooltip from "../components/Tooltip";
import TreeQuerySearchBar from "../components/TreeQuerySearchBar";
import TreeToolbar from "../components/TreeToolbar";
import ReleaseTicketStatusPills from "../components/ReleaseTicketStatusPills";
import { ticketSearchKeys } from "../constants/searchKeys";
import { TICKET_RELEASE_NONE } from "../constants/ticketRelease";
import { TOOLBAR_BTN_BASE, TOOLBAR_BTN_SELECTED } from "../constants/toolbarStyles";
import {
  projectFocusForTicketOpen,
  ticketProjectFromPath,
} from "../constants/ticketPaths";
import { usePinnedProjects } from "../hooks/usePinnedProjects";
import {
  createTicket,
  createTicketProject,
  deleteTicketComment,
  deleteTicketProject,
  getTicketDetail,
  getTicketFilters,
  getTickets,
  getWorkspaceUsernames,
  listTicketProjects,
  postTicketComment,
  setTicketProjectArchived,
  updateTicket,
} from "../services/api";
import { subscribeRefresh } from "../services/wsRefresh";
import { flexFillScroll } from "../utils/layoutClasses";
import { mergeListPreserveOrder } from "../utils/mergeListPreserveOrder";
import { ticketProjectDisplayName } from "../utils/sanitize";
import { sanitizeNameForPath } from "../utils/sanitize";
import { chipsToTicketQueryParams, fetchTicketWindow } from "../utils/ticketQuery";
import { withParamSearchKeys } from "../utils/querySearch";
import {
  applyOrToggleBacklogChip,
  applyOrToggleStatusChip,
  getActiveBacklogFromChips,
  getActiveStatusFromChips,
  TICKET_PROJECT_STATUS_QUICK_FILTERS,
} from "../utils/ticketStatusQuickFilter";
import { TreeAreaHoverProvider } from "../contexts/TreeAreaHoverContext";
import { TreeScrollContainer } from "../contexts/TreeScrollContext";
import { flushAllAutoSavesBeforeSync } from "../utils/autoSaveFlushRegistry";
import { shouldApplyRefreshedDetail } from "../utils/refreshedDetail";

const PAGE_SIZE = 5000;

/** Map ticket list rows to the shape CaseTree / buildCaseTree expect. */
function ticketsAsCaseRows(tickets) {
  return (tickets || []).map((t) => ({
    file_path: t.file_path,
    case_id: t.ticket_id,
    title: t.title || t.ticket_id || "Untitled",
    status: t.status || null,
    priority: t.priority || null,
    tags: t.tags || [],
    type: t.type || t.ticket_type || "task",
    ticket_type: t.type || t.ticket_type || "task",
  }));
}

/**
 * Tickets — two columns (project tree with tickets nested | detail).
 */
function TicketsPage({
  activeRepoSlug = null,
  sidebarFooter = null,
  sidebarTitleRight = null,
  onAfterRepoWrite = null,
  storageSyncConfigured = false,
  onOpenStorageSyncSettings,
  gitProfileVersion = 0,
  pendingOpenTicket = null,
  onPendingOpenTicketConsumed = null,
  onNavigateToCase = null,
  onNavigateToRun = null,
  onNavigateToRelease = null,
  onNavigateToWiki = null,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchChips, setSearchChips] = useState([]);
  const [archivedViewOpen, setArchivedViewOpen] = useState(false);
  const [projectTree, setProjectTree] = useState([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState(null);
  const [openedProjectPath, setOpenedProjectPath] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** Bumped only after a successful detail GET so TicketEditorPanel re-hydrates. */
  const [ticketDetailLoadGeneration, setTicketDetailLoadGeneration] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  /** One-shot: file path of a just-created ticket whose title should be focused/selected. */
  const [autoFocusTitlePath, setAutoFocusTitlePath] = useState(null);
  const [filterOptions, setFilterOptions] = useState({});
  const [allUsernames, setAllUsernames] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const selectedPathRef = useRef(null);
  const openedProjectPathRef = useRef(null);
  /** Deep-link / cross-project open: keep this path through stale list reloads. */
  const retainSelectionPathRef = useRef(null);
  const ticketsRef = useRef([]);
  const ticketDetailFetchIdRef = useRef(0);
  const isEditingRef = useRef(false);
  selectedPathRef.current = selectedPath;
  openedProjectPathRef.current = openedProjectPath;
  ticketsRef.current = tickets;
  isEditingRef.current = isEditing;
  const { pinnedProjectPaths, isPinned, togglePin } = usePinnedProjects(activeRepoSlug, projectTree, {
    namespace: "tickets",
  });

  const selectedProject = useMemo(
    () => (selectedFolderPath ? ticketProjectFromPath(selectedFolderPath) : null),
    [selectedFolderPath],
  );

  const selectedProjectDisplayName = useMemo(() => {
    if (!selectedProject) return null;
    const node = projectTree.find((n) => ticketProjectFromPath(n.directory_path) === selectedProject);
    return node?.display_name || ticketProjectDisplayName(selectedProject);
  }, [projectTree, selectedProject]);

  const openedProjectName = useMemo(
    () => (openedProjectPath ? ticketProjectFromPath(openedProjectPath) : null),
    [openedProjectPath],
  );

  const [statusCounts, setStatusCounts] = useState({});
  const [statusCountsLoading, setStatusCountsLoading] = useState(false);
  const statusCountsGenRef = useRef(0);

  const activeStatusFilter = useMemo(
    () => getActiveStatusFromChips(searchChips),
    [searchChips],
  );

  const backlogFilterActive = useMemo(
    () => getActiveBacklogFromChips(searchChips),
    [searchChips],
  );

  const visibleProjectTree = useMemo(() => {
    if (!openedProjectPath) return projectTree;
    return projectTree.filter((n) => n.directory_path === openedProjectPath);
  }, [projectTree, openedProjectPath]);

  const queryParams = useMemo(() => {
    const base = chipsToTicketQueryParams(searchChips);
    if (openedProjectName) {
      return { ...base, project: openedProjectName };
    }
    return base;
  }, [searchChips, openedProjectName]);

  const ticketRows = useMemo(() => ticketsAsCaseRows(tickets), [tickets]);

  const reloadProjects = useCallback(async () => {
    if (!activeRepoSlug) {
      setProjectTree([]);
      return;
    }
    try {
      const nodes = await listTicketProjects(activeRepoSlug, {
        archivedOnly: archivedViewOpen,
      });
      setProjectTree(Array.isArray(nodes) ? nodes : []);
    } catch {
      setProjectTree([]);
    }
  }, [activeRepoSlug, archivedViewOpen]);

  /**
   * @param {{ resort?: boolean }} [opts] - When resort is false, keep current list order
   *   (merge field updates; prepend newcomers). Default true for navigate-back / filter changes.
   */
  const reloadTickets = useCallback(async ({ resort = true } = {}) => {
    if (!activeRepoSlug || archivedViewOpen) {
      setTickets([]);
      ticketsRef.current = [];
      return [];
    }
    try {
      const { items } = await fetchTicketWindow(activeRepoSlug, queryParams, {
        limit: PAGE_SIZE,
        offset: 0,
      });
      const list = Array.isArray(items) ? items : [];
      const next = resort
        ? list
        : mergeListPreserveOrder(ticketsRef.current, list, (t) => t.file_path);
      setTickets(next);
      ticketsRef.current = next;
      return next;
    } catch {
      setTickets([]);
      ticketsRef.current = [];
      return [];
    }
  }, [activeRepoSlug, queryParams, archivedViewOpen]);

  const refreshStatusCounts = useCallback(async () => {
    if (!activeRepoSlug || !openedProjectName) {
      setStatusCounts({});
      setStatusCountsLoading(false);
      return;
    }
    const gen = ++statusCountsGenRef.current;
    setStatusCountsLoading(true);
    try {
      const statusEntries = await Promise.all(
        TICKET_PROJECT_STATUS_QUICK_FILTERS.map(async ({ value }) => {
          const res = await getTickets(activeRepoSlug, {
            project: openedProjectName,
            status: value,
            limit: 1,
            offset: 0,
          });
          const total = typeof res?.total === "number" ? res.total : 0;
          return [value, total];
        }),
      );
      const backlogRes = await getTickets(activeRepoSlug, {
        project: openedProjectName,
        release: TICKET_RELEASE_NONE,
        limit: 1,
        offset: 0,
      });
      const backlogTotal =
        typeof backlogRes?.total === "number" ? backlogRes.total : 0;
      if (gen !== statusCountsGenRef.current) return;
      setStatusCounts({
        ...Object.fromEntries(statusEntries),
        backlog: backlogTotal,
      });
    } catch {
      if (gen !== statusCountsGenRef.current) return;
      setStatusCounts({});
    } finally {
      if (gen === statusCountsGenRef.current) setStatusCountsLoading(false);
    }
  }, [activeRepoSlug, openedProjectName]);

  const refreshStatusCountsRef = useRef(refreshStatusCounts);
  refreshStatusCountsRef.current = refreshStatusCounts;

  useEffect(() => {
    void refreshStatusCounts();
  }, [refreshStatusCounts]);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchChips([]);
  }, []);

  const handleSearch = useCallback((chips) => {
    setSearchChips(chips || []);
  }, []);

  const handleSearchClick = useCallback(() => {
    if (searchOpen) {
      handleCloseSearch();
      return;
    }
    setSearchOpen(true);
  }, [searchOpen, handleCloseSearch]);

  const handleStatusQuickFilter = useCallback(
    (statusOrNull) => {
      if (!openedProjectName) return;
      const next =
        statusOrNull == null
          ? searchChips.filter((c) => c?.key !== "status")
          : applyOrToggleStatusChip(searchChips, statusOrNull);
      if (next.length === 0) {
        handleCloseSearch();
        return;
      }
      setSearchChips(next);
      setSearchOpen(true);
    },
    [openedProjectName, searchChips, handleCloseSearch],
  );

  const handleBacklogQuickFilter = useCallback(() => {
    if (!openedProjectName) return;
    const next = applyOrToggleBacklogChip(searchChips);
    if (next.length === 0) {
      handleCloseSearch();
      return;
    }
    setSearchChips(next);
    setSearchOpen(true);
  }, [openedProjectName, searchChips, handleCloseSearch]);

  const clearTicketSelection = useCallback(() => {
    retainSelectionPathRef.current = null;
    setSelectedPath(null);
    setTicketDetail(null);
    setIsEditing(false);
    setAutoFocusTitlePath(null);
  }, []);

  const handleSelectFolder = useCallback(
    (folderPath) => {
      if (!folderPath) return;
      setSelectedFolderPath(folderPath);
      clearTicketSelection();
    },
    [clearTicketSelection],
  );

  const handleOpenProject = useCallback(
    (folderPath) => {
      if (!folderPath || archivedViewOpen) return;
      setOpenedProjectPath(folderPath);
      setSelectedFolderPath(folderPath);
      clearTicketSelection();
      const project = ticketProjectFromPath(folderPath);
      if (project) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(project);
          return next;
        });
      }
    },
    [clearTicketSelection, archivedViewOpen],
  );

  const handleCloseOpenedProject = useCallback(() => {
    const project = openedProjectPath ? ticketProjectFromPath(openedProjectPath) : null;
    setOpenedProjectPath(null);
    // Collapse on Back — user is leaving focus to switch projects.
    if (project) {
      setExpanded((prev) => {
        if (!prev.has(project)) return prev;
        const next = new Set(prev);
        next.delete(project);
        return next;
      });
    }
  }, [openedProjectPath]);

  /**
   * Refresh tree + list. If the open file is gone, clear selection. In read mode,
   * silently refetch detail (no loading flash). While editing, keep the in-memory draft.
   */
  const reloadFromBackend = useCallback(
    async ({ resort = false } = {}) => {
      const [, items] = await Promise.all([reloadProjects(), reloadTickets({ resort })]);
      if (!activeRepoSlug) {
        setFilterOptions({});
        clearTicketSelection();
        return;
      }
      try {
        const opts = await getTicketFilters(activeRepoSlug);
        setFilterOptions(opts || {});
      } catch {
        setFilterOptions({});
      }
      void refreshStatusCountsRef.current();
      const path = selectedPathRef.current;
      if (!path) return;
      const stillThere = (items || []).some((t) => t.file_path === path);
      if (!stillThere) {
        // Cross-project deep link: selected ticket is outside the open-focused project
        // filter — switch focus so the next query includes it instead of clearing.
        const switchTo = projectFocusForTicketOpen(path, openedProjectPathRef.current);
        if (switchTo) {
          setOpenedProjectPath(switchTo);
          setSearchOpen(false);
          setSearchChips([]);
          const project = ticketProjectFromPath(switchTo);
          if (project) {
            setExpanded((prev) => {
              const next = new Set(prev);
              next.add(project);
              return next;
            });
          }
          return;
        }
        // Focus already matches the ticket's project, but this reload used a stale
        // (previous project) list — e.g. view-active fetch that raced the deep-link.
        if (retainSelectionPathRef.current === path) {
          return;
        }
      } else if (retainSelectionPathRef.current === path) {
        retainSelectionPathRef.current = null;
      }
      const action = shouldApplyRefreshedDetail({
        stillThere,
        isEditing: isEditingRef.current,
      });
      if (action === "clear") {
        clearTicketSelection();
        return;
      }
      if (action !== "apply") return;
      try {
        const fresh = await getTicketDetail(path, activeRepoSlug);
        if (selectedPathRef.current !== path || isEditingRef.current) return;
        setTicketDetail(fresh);
        setTicketDetailLoadGeneration((g) => g + 1);
      } catch {
        if (selectedPathRef.current === path) clearTicketSelection();
      }
    },
    [activeRepoSlug, reloadProjects, reloadTickets, clearTicketSelection],
  );

  const reloadFromBackendRef = useRef(reloadFromBackend);
  reloadFromBackendRef.current = reloadFromBackend;

  /** Stable: only re-run when the Tickets view becomes active (not on queryParams churn). */
  const onViewActive = useCallback(() => {
    void reloadFromBackendRef.current({ resort: false });
  }, []);

  useRefetchWhenActive(onViewActive);

  useEffect(() => {
    return subscribeRefresh(() => {
      void reloadFromBackendRef.current({ resort: false });
    });
  }, []);

  /** Resort when project focus or search chips change (new query window). */
  useEffect(() => {
    if (!activeRepoSlug) return;
    void reloadTickets({ resort: true });
  }, [activeRepoSlug, queryParams, reloadTickets]);

  useEffect(() => {
    setSelectedPath(null);
    setTicketDetail(null);
    setIsEditing(false);
    setAutoFocusTitlePath(null);
    setSelectedFolderPath(null);
    setOpenedProjectPath(null);
    setCreatingProject(false);
    setArchivedViewOpen(false);
    setExpanded(new Set());
  }, [activeRepoSlug]);

  // Drop stale open-focus if the project disappeared after a reload.
  useEffect(() => {
    if (!openedProjectPath || projectTree.length === 0) return;
    if (!projectTree.some((n) => n.directory_path === openedProjectPath)) {
      setOpenedProjectPath(null);
    }
  }, [openedProjectPath, projectTree]);

  useEffect(() => {
    if (!archivedViewOpen) return;
    setOpenedProjectPath(null);
    setCreatingProject(false);
    clearTicketSelection();
  }, [archivedViewOpen, clearTicketSelection]);

  useEffect(() => {
    if (!activeRepoSlug) {
      setAllUsernames([]);
      return;
    }
    getWorkspaceUsernames(activeRepoSlug)
      .then((res) => setAllUsernames(Array.isArray(res?.usernames) ? res.usernames : []))
      .catch(() => setAllUsernames([]));
  }, [activeRepoSlug]);

  const loadDetail = useCallback(
    async (filePath) => {
      if (!filePath || !activeRepoSlug) {
        ticketDetailFetchIdRef.current += 1;
        setTicketDetail(null);
        setDetailLoading(false);
        return;
      }
      const fetchId = ++ticketDetailFetchIdRef.current;
      setDetailLoading(true);
      try {
        const d = await getTicketDetail(filePath, activeRepoSlug);
        if (ticketDetailFetchIdRef.current !== fetchId) return;
        if (selectedPathRef.current !== filePath) return;
        setTicketDetail(d);
        setTicketDetailLoadGeneration((g) => g + 1);
      } catch {
        if (ticketDetailFetchIdRef.current !== fetchId) return;
        if (selectedPathRef.current !== filePath) return;
        setTicketDetail(null);
      } finally {
        if (ticketDetailFetchIdRef.current === fetchId) {
          setDetailLoading(false);
        }
      }
    },
    [activeRepoSlug],
  );

  /**
   * Edit mode is preserved when switching tickets (same as test cases / IDE tabs);
   * use Eye, clear selection, create, or archive toggle to exit edit.
   * Flush pending autosave before changing selection so PUT cannot race GET on return.
   */
  const handleSelectTicket = useCallback(
    async (row) => {
      const filePath = row?.file_path;
      if (!filePath) return;
      if (
        retainSelectionPathRef.current &&
        retainSelectionPathRef.current !== filePath
      ) {
        retainSelectionPathRef.current = null;
      }
      await flushAllAutoSavesBeforeSync();
      // A newer deep-link may have won while we flushed.
      if (
        retainSelectionPathRef.current &&
        retainSelectionPathRef.current !== filePath
      ) {
        return;
      }
      setSelectedPath(filePath);
      const projectPath = filePath.includes("/")
        ? filePath.slice(0, filePath.lastIndexOf("/"))
        : null;
      if (projectPath) setSelectedFolderPath(projectPath);
      await loadDetail(filePath);
    },
    [loadDetail],
  );

  /**
   * Open a ticket from parent/children/wikilink/requirement deep-link.
   * If another project is open-focused, switch focus so the list query includes this ticket.
   */
  const handleOpenTicket = useCallback(
    (row) => {
      if (!row?.file_path) return;
      // Pin selection through concurrent view-active reloads (stale project filter).
      retainSelectionPathRef.current = row.file_path;
      setSelectedPath(row.file_path);
      const projectPath = row.file_path.includes("/")
        ? row.file_path.slice(0, row.file_path.lastIndexOf("/"))
        : null;
      if (projectPath) setSelectedFolderPath(projectPath);

      const switchTo = projectFocusForTicketOpen(row.file_path, openedProjectPathRef.current);
      if (switchTo) {
        setOpenedProjectPath(switchTo);
        setSearchOpen(false);
        setSearchChips([]);
      }
      const project = ticketProjectFromPath(row.file_path);
      if (project) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(project);
          return next;
        });
      }
      // Load detail immediately; handleSelectTicket still flushes prior autosaves.
      void loadDetail(row.file_path);
      void handleSelectTicket(row);
    },
    [handleSelectTicket, loadDetail],
  );

  // Deep-link from case requirement (or other views): open ticket then clear pending.
  useEffect(() => {
    if (!pendingOpenTicket?.file_path) return;
    handleOpenTicket(pendingOpenTicket);
    onPendingOpenTicketConsumed?.();
  }, [pendingOpenTicket, handleOpenTicket, onPendingOpenTicketConsumed]);

  /**
   * Toggle ticket edit mode. Optimistic: when switching to read-only, merge current draft
   * into ticketDetail so the view shows the latest content without waiting for API.
   */
  const handleToggleEditTicket = (toEdit, draft) => {
    if (toEdit === false && draft != null && selectedPath != null) {
      setTicketDetail((prev) => {
        if (!prev || prev.file_path !== selectedPath) return prev;
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
          params:
            draft.params !== undefined && draft.params != null
              ? draft.params
              : prev.params,
        };
      });
    }
    setIsEditing(!!toEdit);
  };

  /**
   * Instant create: write YAML with auto id, then open detail in edit mode.
   */
  const openCreateForProjectPath = useCallback(
    async (folderPath) => {
      if (!folderPath || !activeRepoSlug || archivedViewOpen) return;
      const project = ticketProjectFromPath(folderPath);
      if (!project) return;
      setSelectedFolderPath(folderPath);
      if (searchOpen) handleCloseSearch();
      try {
        const res = await createTicket(
          {
            project,
            title: "New ticket",
            type: "task",
            status: "open",
            priority: "medium",
          },
          activeRepoSlug,
        );
        await reloadProjects();
        const { items } = await fetchTicketWindow(activeRepoSlug, queryParams, {
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (res?.file_path) {
          const created = items.find((t) => t.file_path === res.file_path);
          const rest = items.filter((t) => t.file_path !== res.file_path);
          const next = created ? [created, ...rest] : items;
          setTickets(next);
          ticketsRef.current = next;
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(project);
            return next;
          });
          setSelectedPath(res.file_path);
          await loadDetail(res.file_path);
          setAutoFocusTitlePath(res.file_path);
          setIsEditing(true);
        } else {
          setTickets(items);
          ticketsRef.current = items;
        }
        onAfterRepoWrite?.();
        void refreshStatusCountsRef.current();
      } catch (err) {
        window.alert(err?.message || "Failed to create ticket");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      searchOpen,
      handleCloseSearch,
      reloadProjects,
      queryParams,
      loadDetail,
      onAfterRepoWrite,
    ],
  );

  const handleStartCreate = useCallback(() => {
    if (!selectedFolderPath) return;
    openCreateForProjectPath(selectedFolderPath);
  }, [selectedFolderPath, openCreateForProjectPath]);

  const handleArchiveProject = useCallback(
    async (node) => {
      const project = node?.name || ticketProjectFromPath(node?.directory_path);
      if (!activeRepoSlug || !project || archivedViewOpen) return;
      try {
        await setTicketProjectArchived(project, true, activeRepoSlug);
        if (openedProjectPathRef.current === node?.directory_path) {
          setOpenedProjectPath(null);
        }
        if (selectedFolderPath === node?.directory_path) {
          setSelectedFolderPath(null);
        }
        clearTicketSelection();
        await reloadProjects();
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to archive project");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      selectedFolderPath,
      clearTicketSelection,
      reloadProjects,
      onAfterRepoWrite,
    ],
  );

  const handleRestoreProject = useCallback(
    async (node) => {
      const project = node?.name || ticketProjectFromPath(node?.directory_path);
      if (!activeRepoSlug || !project || !archivedViewOpen) return;
      try {
        await setTicketProjectArchived(project, false, activeRepoSlug);
        if (selectedFolderPath === node?.directory_path) {
          setSelectedFolderPath(null);
        }
        await reloadProjects();
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to restore project");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      selectedFolderPath,
      reloadProjects,
      onAfterRepoWrite,
    ],
  );

  const handleDeleteArchivedProject = useCallback(
    async (node) => {
      const project = node?.name || ticketProjectFromPath(node?.directory_path);
      if (!activeRepoSlug || !project || !archivedViewOpen) return;
      const ok = window.confirm(
        `Permanently delete project "${project}" and all of its tickets and releases? This cannot be undone.`,
      );
      if (!ok) return;
      try {
        await deleteTicketProject(project, activeRepoSlug);
        if (selectedFolderPath === node?.directory_path) {
          setSelectedFolderPath(null);
        }
        clearTicketSelection();
        await reloadProjects();
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to delete project");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      selectedFolderPath,
      clearTicketSelection,
      reloadProjects,
      onAfterRepoWrite,
    ],
  );

  const handleOpenArchivedView = useCallback(() => {
    if (searchOpen) handleCloseSearch();
    setOpenedProjectPath(null);
    setCreatingProject(false);
    clearTicketSelection();
    setIsEditing(false);
    setArchivedViewOpen(true);
  }, [searchOpen, handleCloseSearch, clearTicketSelection]);

  const handleCloseArchivedView = useCallback(() => {
    setArchivedViewOpen(false);
    setSelectedFolderPath(null);
    clearTicketSelection();
  }, [clearTicketSelection]);

  useEffect(() => {
    void reloadProjects();
    void reloadTickets({ resort: true });
  }, [archivedViewOpen, reloadProjects, reloadTickets]);

  const handleArchivedClick = () => {
    if (archivedViewOpen) {
      handleCloseArchivedView();
    } else {
      handleOpenArchivedView();
    }
  };

  const getFolderContextMenuItems = useCallback(
    (node, close) => {
      if (!node?.is_project || !node?.directory_path) return [];
      if (archivedViewOpen) {
        return [
          {
            icon: RotateCcw,
            label: "Restore",
            onClick: () => {
              close();
              void handleRestoreProject(node);
            },
          },
          {
            icon: Trash2,
            label: "Delete permanently…",
            variant: "danger",
            onClick: () => {
              close();
              void handleDeleteArchivedProject(node);
            },
          },
        ];
      }
      const items = [];
      if (openedProjectPath !== node.directory_path) {
        items.push({
          icon: FolderOpen,
          label: "Open Project",
          hint: "Double-click",
          onClick: () => {
            close();
            handleOpenProject(node.directory_path);
          },
        });
      }
      items.push({
        icon: FilePlus2,
        label: "New ticket",
        onClick: () => {
          close();
          openCreateForProjectPath(node.directory_path);
        },
      });
      items.push({
        icon: Archive,
        label: "Archive project",
        onClick: () => {
          close();
          void handleArchiveProject(node);
        },
      });
      return items;
    },
    [
      archivedViewOpen,
      openedProjectPath,
      handleOpenProject,
      openCreateForProjectPath,
      handleArchiveProject,
      handleRestoreProject,
      handleDeleteArchivedProject,
    ],
  );

  const handleCommitInlineProject = async (name) => {
    setCreatingProject(false);
    if (!name?.trim() || !activeRepoSlug) return;
    const sanitized = sanitizeNameForPath(name.trim());
    if (!sanitized) return;
    try {
      const res = await createTicketProject(sanitized, activeRepoSlug);
      await reloadProjects();
      if (res?.project_path) {
        setSelectedFolderPath(res.project_path);
      }
      onAfterRepoWrite?.();
    } catch (err) {
      window.alert(err?.message || "Failed to create project");
    }
  };

  const handleTitleFocused = useCallback(() => {
    setAutoFocusTitlePath(null);
  }, []);

  const handleAutoSaveTicket = async (payload) => {
    const pathAtSave = payload?.file_path || selectedPathRef.current;
    if (!pathAtSave || !activeRepoSlug) return;
    const updated = await updateTicket(pathAtSave, payload, activeRepoSlug);
    // Merge into the open panel only when it still shows this file (user may have navigated away).
    // Do not bump ticketDetailLoadGeneration — that would wipe the live draft mid-edit.
    if (selectedPathRef.current === pathAtSave && updated?.file_path) {
      setTicketDetail(updated);
    }
    setTickets((prev) => {
      const next = prev.map((t) => {
        if (t.file_path !== pathAtSave) return t;
        return {
          ...t,
          title: payload.title ?? t.title,
          type: payload.type ?? t.type,
          status: payload.status ?? t.status,
          priority: payload.priority ?? t.priority,
          tags: payload.tags ?? t.tags,
          assigned_to: payload.assigned_to ?? t.assigned_to,
          sprint: payload.sprint ?? t.sprint,
          release: payload.release ?? t.release,
          parent: payload.parent ?? t.parent,
          ...(updated?.updated_at != null ? { updated_at: updated.updated_at } : {}),
        };
      });
      ticketsRef.current = next;
      return next;
    });
    onAfterRepoWrite?.();
    void refreshStatusCountsRef.current();
  };

  const handlePostComment = async (filePath, text) => {
    if (!activeRepoSlug) return;
    const updated = await postTicketComment(filePath, text, activeRepoSlug);
    if (selectedPath === filePath) setTicketDetail(updated);
    onAfterRepoWrite?.();
  };

  const handleDeleteComment = async (filePath, index) => {
    if (!activeRepoSlug) return;
    const updated = await deleteTicketComment(filePath, index, activeRepoSlug);
    if (selectedPath === filePath) setTicketDetail(updated);
    onAfterRepoWrite?.();
  };

  const canCreateTicket = Boolean(selectedProject) && !searchOpen && !archivedViewOpen;

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
    () => withParamSearchKeys(ticketSearchKeys(), ticketFilterOptions),
    [ticketFilterOptions],
  );

  const searchButton = (
    <SearchToggleButton
      isOpen={searchOpen}
      hasActiveChips={!!searchChips.length}
      onClick={handleSearchClick}
      ariaLabelWhenClosed="Filter tickets"
    />
  );

  const statusQuickFilters =
    openedProjectPath != null && !archivedViewOpen ? (
      <div className="flex max-w-full min-w-0 items-center gap-1">
        <ReleaseTicketStatusPills
          filters={TICKET_PROJECT_STATUS_QUICK_FILTERS}
          counts={statusCounts}
          activeStatus={activeStatusFilter}
          onSelect={handleStatusQuickFilter}
          loading={statusCountsLoading}
        />
        <span
          className="mx-0.5 h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-600"
          aria-hidden
        />
        {(() => {
          const raw = statusCounts.backlog;
          const countLabel =
            statusCountsLoading && (raw === undefined || raw === null)
              ? "—"
              : typeof raw === "number"
                ? String(raw)
                : "—";
          const isZero = typeof raw === "number" && raw === 0;
          return (
            <Tooltip label={`Backlog · no release · ${countLabel}`} placement="bottom">
              <button
                type="button"
                aria-pressed={backlogFilterActive}
                aria-label={`Backlog: ${countLabel} tickets without a release`}
                onClick={handleBacklogQuickFilter}
                className={[
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-ui border px-1.5 text-xs font-medium leading-none transition",
                  backlogFilterActive
                    ? "border-slate-300 bg-slate-200 dark:border-slate-500 dark:bg-slate-600"
                    : "border-transparent hover:bg-list-hover dark:hover:bg-slate-700",
                ].join(" ")}
              >
                <ListTodo
                  className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300"
                  aria-hidden
                  strokeWidth={2}
                />
                <span
                  className={[
                    "min-w-[0.75rem] text-center tabular-nums",
                    isZero
                      ? "text-slate-400 dark:text-slate-500"
                      : "text-slate-700 dark:text-slate-200",
                  ].join(" ")}
                >
                  {countLabel}
                </span>
              </button>
            </Tooltip>
          );
        })()}
      </div>
    ) : null;

  const toolbarSearchNode = archivedViewOpen ? null : openedProjectPath != null ? (
      <div className="flex min-w-0 max-w-full items-center gap-1">
        {statusQuickFilters}
        {searchButton}
      </div>
    ) : (
      searchButton
    );

  const archivedButton = (
    <Tooltip
      label={archivedViewOpen ? "Back to tree" : "Archived projects"}
      placement="bottom"
    >
      <button
        type="button"
        onClick={handleArchivedClick}
        className={`${TOOLBAR_BTN_BASE} ${archivedViewOpen ? TOOLBAR_BTN_SELECTED : ""}`}
        aria-label={archivedViewOpen ? "Back to tree" : "Archived projects"}
      >
        {archivedViewOpen ? (
          <ArrowLeft className="h-4 w-4" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
      </button>
    </Tooltip>
  );

  const ticketsToolbar = (
    <TreeToolbar
      addButton={
        openedProjectPath || archivedViewOpen
          ? null
          : (
            <TitleBarAddButton
              tooltip="Create project"
              onClick={() => {
                if (searchOpen) handleCloseSearch();
                setCreatingProject(true);
              }}
              ariaLabel="Create project"
            />
          )
      }
      sortButton={null}
      searchNode={toolbarSearchNode}
      extraActions={openedProjectPath ? null : archivedButton}
      onBeforeAction={searchOpen ? handleCloseSearch : undefined}
    />
  );

  const treeBody = (
    <TreeAreaHoverProvider>
      <TreeScrollContainer className={`${flexFillScroll} min-h-0 flex-1 pl-0 pr-1 pt-0 pb-2`}>
        <CaseTree
          tree={visibleProjectTree}
          rows={archivedViewOpen ? [] : ticketRows}
          selectedCaseFilePath={archivedViewOpen ? null : selectedPath}
          onSelectCase={archivedViewOpen ? undefined : handleSelectTicket}
          selectedFolderPath={selectedFolderPath}
          onSelectFolder={handleSelectFolder}
          onOpenProject={archivedViewOpen ? undefined : handleOpenProject}
          openedProjectPath={archivedViewOpen ? null : openedProjectPath}
          onCloseOpenedProject={handleCloseOpenedProject}
          creatingProject={creatingProject && !openedProjectPath && !archivedViewOpen}
          onCommitInlineProject={archivedViewOpen ? undefined : handleCommitInlineProject}
          getFolderContextMenuItems={getFolderContextMenuItems}
          emptyMessage={
            archivedViewOpen
              ? activeRepoSlug
                ? "No archived projects."
                : "Connect a repository"
              : activeRepoSlug
                ? "No projects yet. Use + to create one."
                : "Connect a repository"
          }
          expanded={expanded}
          onExpandedChange={setExpanded}
          forceExpandAll={searchOpen && !archivedViewOpen}
          hideEmptyNodes={searchOpen && !archivedViewOpen}
          pinningEnabled={!searchOpen && !openedProjectPath && !archivedViewOpen}
          pinnedProjectPaths={
            searchOpen || openedProjectPath || archivedViewOpen ? null : pinnedProjectPaths
          }
          isPinnedProject={
            searchOpen || openedProjectPath || archivedViewOpen ? null : isPinned
          }
          onTogglePinProject={
            searchOpen || openedProjectPath || archivedViewOpen ? null : togglePin
          }
          archivedView={archivedViewOpen}
        />
      </TreeScrollContainer>
    </TreeAreaHoverProvider>
  );

  const listColumn = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <SidebarSection
          title="Tickets"
          titleRight={sidebarTitleRight}
          toolbar={ticketsToolbar}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {archivedViewOpen ? (
          <HiddenViewBanner
            label="Archived projects"
            tooltip="Only archived ticket projects are shown. Click the toolbar button to go back to the main tree."
          />
        ) : null}
        {searchOpen && !archivedViewOpen ? (
          <TreeQuerySearchBar
            searchKeys={effectiveTicketSearchKeys}
            filterOptions={ticketFilterOptions}
            chips={searchChips}
            onChipsChange={handleSearch}
            placeholder="priority: high · status: open · free text"
          />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">{treeBody}</div>
        </div>
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
    <ConfirmChangesTwoColumnLayout
      storageKeys={{ sidebarWidth: "tickets.col.sidebarWidth" }}
      sidebarColumn={listColumn}
      detailColumn={
        selectedPath || !(selectedFolderPath && selectedProject && !archivedViewOpen) ? (
          <TicketEditorPanel
            ticketDetail={ticketDetail}
            selectedTicketFilePath={selectedPath}
            ticketDetailLoading={detailLoading}
            ticketDetailLoadGeneration={ticketDetailLoadGeneration}
            isEditing={isEditing}
            autoFocusTitlePath={autoFocusTitlePath}
            onTitleFocused={handleTitleFocused}
            onToggleEdit={handleToggleEditTicket}
            onSave={handleAutoSaveTicket}
            onPostComment={handlePostComment}
            onDeleteComment={handleDeleteComment}
            onStartCreate={canCreateTicket ? handleStartCreate : undefined}
            allTags={filterOptions?.tags}
            paramKeys={filterOptions?.param_keys}
            paramValuesByKey={filterOptions?.param_values_by_key}
            allUsernames={allUsernames}
            repoSlug={activeRepoSlug}
            gitProfileVersion={gitProfileVersion}
            onOpenTicket={handleOpenTicket}
            onNavigateToCase={onNavigateToCase}
            onNavigateToRun={onNavigateToRun}
            onNavigateToRelease={onNavigateToRelease}
            onOpenWikiPage={onNavigateToWiki}
            storageSyncConfigured={storageSyncConfigured}
            onOpenStorageSyncSettings={onOpenStorageSyncSettings}
          />
        ) : (
          <TicketProjectOverviewPanel
            projectName={selectedProject}
            displayName={selectedProjectDisplayName}
            activeRepoSlug={activeRepoSlug}
          />
        )
      }
    />
  );
}

export default TicketsPage;
