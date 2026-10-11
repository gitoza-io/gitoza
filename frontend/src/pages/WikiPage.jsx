import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, FilePlus2, FolderOpen, FolderPlus, RotateCcw, Trash2 } from "lucide-react";
import CaseTree from "../components/CaseTree";
import ConfirmChangesTwoColumnLayout from "../components/ConfirmChangesTwoColumnLayout";
import { useConfirm } from "../components/ConfirmProvider";
import HiddenViewBanner from "../components/HiddenViewBanner";
import { useRefetchWhenActive } from "../components/PersistentView";
import SearchPanel from "../components/SearchPanel";
import SearchToggleButton from "../components/SearchToggleButton";
import SidebarSection from "../components/SidebarSection";
import TitleBarAddButton from "../components/TitleBarAddButton";
import Tooltip from "../components/Tooltip";
import TreeToolbar from "../components/TreeToolbar";
import { WikiPageIcon } from "../components/TestEntityIcons";
import WikiEditorPanel from "../components/WikiEditorPanel";
import { wikiSearchKeys } from "../constants/searchKeys";
import { TOOLBAR_BTN_BASE, TOOLBAR_BTN_SELECTED } from "../constants/toolbarStyles";
import {
  WIKI_ARCHIVE_ROOT,
  WIKI_ROOT,
  findWikiFolderNode,
  isArchivedWikiFolderPath,
  isArchivedWikiPath,
  wikiCreateTargetFolder,
  wikiExpandKeysFromFilePath,
  wikiFolderFocusLabel,
  wikiFolderFromPath,
  wikiParentFolder,
} from "../constants/wikiPaths";
import { useSearchPrefs } from "../hooks/useSearchPrefs";
import {
  archiveWikiFolder,
  archiveWikiPage,
  archiveWikiPages,
  createWikiFolder,
  createWikiPage,
  deleteActiveWikiFolder,
  deleteWikiFolder,
  deleteWikiPage,
  getWikiPageDetail,
  getWikiTree,
  moveWikiPages,
  restoreWikiFolder,
  restoreWikiPage,
  restoreWikiPages,
  updateWikiPage,
} from "../services/api";
import { subscribeRefresh } from "../services/wsRefresh";
import { flexFillScroll } from "../utils/layoutClasses";
import { mergeListPreserveOrder } from "../utils/mergeListPreserveOrder";
import { sanitizeNameForPath } from "../utils/sanitize";
import { computeCaseMovePath } from "../utils/caseCatalogMove";
import { chipsToWikiQueryParams, fetchWikiWindow } from "../utils/wikiQuery";
import { TreeAreaHoverProvider } from "../contexts/TreeAreaHoverContext";
import { TreeScrollContainer } from "../contexts/TreeScrollContext";
import { flushAllAutoSavesBeforeSync } from "../utils/autoSaveFlushRegistry";
import { shouldApplyRefreshedDetail } from "../utils/refreshedDetail";

const PAGE_SIZE = 5000;

function wikiPagesAsCaseRows(pages) {
  return (pages || []).map((p) => ({
    file_path: p.file_path,
    case_id: p.page_id,
    title: p.title || p.page_id || "Untitled",
  }));
}

/**
 * Wiki — two columns (nested folder tree with pages | detail).
 */
function WikiPage({
  activeRepoSlug = null,
  sidebarFooter = null,
  sidebarTitleRight = null,
  onAfterRepoWrite = null,
  storageSyncConfigured = false,
  onOpenStorageSyncSettings,
  onNavigateToTicket = null,
  pendingOpenWiki = null,
  onPendingOpenWikiConsumed = null,
}) {
  const confirm = useConfirm();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchChips, setSearchChips] = useState([]);
  const [archivedViewOpen, setArchivedViewOpen] = useState(false);
  const [folderTree, setFolderTree] = useState([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingFolderInPath, setCreatingFolderInPath] = useState(null);
  const [creatingPageInFolder, setCreatingPageInFolder] = useState(null);
  const [createError, setCreateError] = useState("");
  const [pages, setPages] = useState([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState(null);
  const [openedFolderPath, setOpenedFolderPath] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [selectedWikiPaths, setSelectedWikiPaths] = useState(() => new Set());
  const [pageDetail, setPageDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pageDetailLoadGeneration, setPageDetailLoadGeneration] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const selectedPathRef = useRef(null);
  const pagesRef = useRef([]);
  const pageDetailFetchIdRef = useRef(0);
  const isEditingRef = useRef(false);
  selectedPathRef.current = selectedPath;
  pagesRef.current = pages;
  isEditingRef.current = isEditing;
  const { history, favorites, toggleFavorite, isFavorite, pushHistory } = useSearchPrefs("wiki");

  const queryParams = useMemo(() => {
    const base = chipsToWikiQueryParams(searchChips);
    if (openedFolderPath && openedFolderPath !== WIKI_ROOT) {
      return { ...base, folder: openedFolderPath };
    }
    return base;
  }, [searchChips, openedFolderPath]);

  const pageRows = useMemo(() => wikiPagesAsCaseRows(pages), [pages]);
  const allWikiTags = useMemo(() => {
    const raw = [];
    for (const p of pages || []) {
      if (Array.isArray(p.tags) && p.tags.length > 0) raw.push(...p.tags);
    }
    return Array.from(
      new Set(raw.map((t) => String(t).trim()).filter(Boolean)),
    );
  }, [pages]);
  const orderedWikiPaths = useMemo(
    () => pageRows.map((r) => r.file_path).filter(Boolean),
    [pageRows],
  );
  const canCreatePage = Boolean(activeRepoSlug) && !searchOpen && !archivedViewOpen;

  const visibleFolderTree = useMemo(() => {
    if (!openedFolderPath) return folderTree;
    const node = findWikiFolderNode(folderTree, openedFolderPath);
    if (!node) return folderTree;
    return [
      {
        ...node,
        display_name: wikiFolderFocusLabel(openedFolderPath),
      },
    ];
  }, [folderTree, openedFolderPath]);

  const reloadTree = useCallback(async () => {
    if (!activeRepoSlug) {
      setFolderTree([]);
      return;
    }
    try {
      const nodes = await getWikiTree(activeRepoSlug, { archiveMode: archivedViewOpen });
      setFolderTree(Array.isArray(nodes) ? nodes : []);
    } catch {
      setFolderTree([]);
    }
  }, [activeRepoSlug, archivedViewOpen]);

  const reloadPages = useCallback(
    async ({ resort = true } = {}) => {
      if (!activeRepoSlug) {
        setPages([]);
        pagesRef.current = [];
        return [];
      }
      try {
        const { items } = await fetchWikiWindow(activeRepoSlug, queryParams, {
          limit: PAGE_SIZE,
          offset: 0,
          archiveMode: archivedViewOpen,
        });
        const list = Array.isArray(items) ? items : [];
        const next = resort
          ? list
          : mergeListPreserveOrder(pagesRef.current, list, (p) => p.file_path);
        setPages(next);
        pagesRef.current = next;
        return next;
      } catch {
        setPages([]);
        pagesRef.current = [];
        return [];
      }
    },
    [activeRepoSlug, queryParams, archivedViewOpen],
  );

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchChips([]);
  }, []);

  const handleSearch = useCallback(
    (chips) => {
      const next = chips || [];
      setSearchChips(next);
      pushHistory(next);
    },
    [pushHistory],
  );

  const handleSearchClick = useCallback(() => {
    if (searchOpen) {
      handleCloseSearch();
      return;
    }
    if (archivedViewOpen) {
      setOpenedFolderPath(null);
      setSelectedFolderPath(null);
      setArchivedViewOpen(false);
    }
    setSearchOpen(true);
  }, [searchOpen, handleCloseSearch, archivedViewOpen]);

  const clearPageSelection = useCallback(() => {
    setSelectedPath(null);
    setPageDetail(null);
    setIsEditing(false);
    setSelectedWikiPaths(new Set());
  }, []);

  const handleSelectFolder = useCallback(
    (folderPath) => {
      if (!folderPath) return;
      setSelectedFolderPath(folderPath);
      clearPageSelection();
    },
    [clearPageSelection],
  );

  const handleOpenFolder = useCallback(
    (folderPath) => {
      if (!folderPath || folderPath === WIKI_ROOT || folderPath === WIKI_ARCHIVE_ROOT) return;
      setOpenedFolderPath(folderPath);
      setSelectedFolderPath(folderPath);
      clearPageSelection();
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const key of wikiExpandKeysFromFilePath(`${folderPath}/x.yaml`)) next.add(key);
        return next;
      });
    },
    [clearPageSelection],
  );

  const handleCloseOpenedFolder = useCallback(() => {
    const leaving = openedFolderPath;
    const parent = leaving ? wikiParentFolder(leaving) : null;
    const nextOpened =
      !parent || parent === WIKI_ROOT || parent === WIKI_ARCHIVE_ROOT ? null : parent;
    setOpenedFolderPath(nextOpened);
    if (nextOpened) {
      setSelectedFolderPath(nextOpened);
    }
    if (leaving) {
      setExpanded((prev) => {
        const keys = wikiExpandKeysFromFilePath(`${leaving}/x.yaml`);
        const leaf = keys[keys.length - 1];
        if (!leaf || !prev.has(leaf)) return prev;
        const next = new Set(prev);
        next.delete(leaf);
        return next;
      });
    }
  }, [openedFolderPath]);

  const reloadFromBackend = useCallback(
    async ({ resort = false } = {}) => {
      const [, items] = await Promise.all([reloadTree(), reloadPages({ resort })]);
      if (!activeRepoSlug) {
        clearPageSelection();
        return;
      }
      const path = selectedPathRef.current;
      if (!path) return;
      const stillThere = (items || []).some((p) => p.file_path === path);
      const action = shouldApplyRefreshedDetail({
        stillThere,
        isEditing: isEditingRef.current,
      });
      if (action === "clear") {
        clearPageSelection();
        return;
      }
      if (action !== "apply") return;
      try {
        const fresh = await getWikiPageDetail(path, activeRepoSlug);
        if (selectedPathRef.current !== path || isEditingRef.current) return;
        setPageDetail(fresh);
        setPageDetailLoadGeneration((g) => g + 1);
      } catch {
        if (selectedPathRef.current === path) clearPageSelection();
      }
    },
    [activeRepoSlug, reloadTree, reloadPages, clearPageSelection],
  );

  const reloadFromBackendRef = useRef(reloadFromBackend);
  reloadFromBackendRef.current = reloadFromBackend;

  const onViewActive = useCallback(() => {
    void reloadFromBackendRef.current({ resort: false });
  }, []);

  useRefetchWhenActive(onViewActive);

  useEffect(() => {
    return subscribeRefresh(() => {
      void reloadFromBackendRef.current({ resort: false });
    });
  }, []);

  useEffect(() => {
    if (!activeRepoSlug) return;
    void reloadPages({ resort: true });
  }, [activeRepoSlug, queryParams, reloadPages]);

  useEffect(() => {
    void reloadTree();
  }, [reloadTree]);

  useEffect(() => {
    setSelectedPath(null);
    setPageDetail(null);
    setIsEditing(false);
    setSelectedFolderPath(null);
    setOpenedFolderPath(null);
    setCreatingFolder(false);
    setCreatingFolderInPath(null);
    setCreatingPageInFolder(null);
    setCreateError("");
    setExpanded(new Set());
    setArchivedViewOpen(false);
    setSelectedWikiPaths(new Set());
  }, [activeRepoSlug]);

  useEffect(() => {
    if (!openedFolderPath || folderTree.length === 0) return;
    if (!findWikiFolderNode(folderTree, openedFolderPath)) {
      setOpenedFolderPath(null);
    }
  }, [openedFolderPath, folderTree]);

  const loadDetail = useCallback(
    async (filePath) => {
      if (!filePath || !activeRepoSlug) {
        pageDetailFetchIdRef.current += 1;
        setPageDetail(null);
        setDetailLoading(false);
        return;
      }
      const fetchId = ++pageDetailFetchIdRef.current;
      setDetailLoading(true);
      try {
        const d = await getWikiPageDetail(filePath, activeRepoSlug);
        if (pageDetailFetchIdRef.current !== fetchId) return;
        if (selectedPathRef.current !== filePath) return;
        setPageDetail(d);
        setPageDetailLoadGeneration((g) => g + 1);
      } catch {
        if (pageDetailFetchIdRef.current !== fetchId) return;
        if (selectedPathRef.current !== filePath) return;
        setPageDetail(null);
      } finally {
        if (pageDetailFetchIdRef.current === fetchId) {
          setDetailLoading(false);
        }
      }
    },
    [activeRepoSlug],
  );

  const handleSelectPage = useCallback(
    async (row) => {
      const filePath = row?.file_path;
      if (!filePath) return;
      await flushAllAutoSavesBeforeSync();
      setSelectedPath(filePath);
      const folderPath = wikiFolderFromPath(filePath);
      if (folderPath) setSelectedFolderPath(folderPath);
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const key of wikiExpandKeysFromFilePath(filePath)) next.add(key);
        return next;
      });
      await loadDetail(filePath);
    },
    [loadDetail],
  );

  // Deep-link from ticket body [[wiki:…]] (or other views): open page then clear pending.
  useEffect(() => {
    if (!pendingOpenWiki?.file_path) return;
    handleSelectPage(pendingOpenWiki);
    onPendingOpenWikiConsumed?.();
  }, [pendingOpenWiki, handleSelectPage, onPendingOpenWikiConsumed]);

  const handleToggleEdit = (toEdit, draft) => {
    if (archivedViewOpen && toEdit) return;
    if (toEdit === false && draft != null && selectedPath != null) {
      setPageDetail((prev) => {
        if (!prev || prev.file_path !== selectedPath) return prev;
        return {
          ...prev,
          title: draft.title ?? prev.title,
          body: draft.body ?? prev.body,
          tags: Array.isArray(draft.tags) ? draft.tags : prev.tags,
          status: draft.status ?? prev.status,
        };
      });
    }
    setIsEditing(!!toEdit);
  };

  const startInlineCreate = useCallback(
    (folderPath) => {
      if (!activeRepoSlug || archivedViewOpen) return;
      const folder = wikiCreateTargetFolder(folderPath);
      if (searchOpen) handleCloseSearch();
      setSelectedFolderPath(folder);
      setCreateError("");
      setCreatingPageInFolder(folder);
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const key of wikiExpandKeysFromFilePath(`${folder}/x.yaml`)) next.add(key);
        return next;
      });
    },
    [activeRepoSlug, searchOpen, handleCloseSearch, archivedViewOpen],
  );

  const handleCancelCreatePage = useCallback(() => {
    setCreatingPageInFolder(null);
    setCreateError("");
  }, []);

  const handleCommitCreatePage = useCallback(
    async (folderPath, _isProject, rawName) => {
      if (!activeRepoSlug) {
        handleCancelCreatePage();
        return;
      }
      if (rawName == null) {
        handleCancelCreatePage();
        return;
      }
      const title = String(rawName).trim();
      if (!title) {
        handleCancelCreatePage();
        return;
      }
      const folder = wikiCreateTargetFolder(folderPath);
      setCreateError("");
      try {
        const res = await createWikiPage({ folder, title }, activeRepoSlug);
        await reloadTree();
        const { items } = await fetchWikiWindow(activeRepoSlug, queryParams, {
          limit: PAGE_SIZE,
          offset: 0,
        });
        if (res?.file_path) {
          setCreatingPageInFolder(null);
          setCreateError("");
          const created = items.find((p) => p.file_path === res.file_path);
          const rest = items.filter((p) => p.file_path !== res.file_path);
          const next = created ? [created, ...rest] : items;
          setPages(next);
          pagesRef.current = next;
          setExpanded((prev) => {
            const nextKeys = new Set(prev);
            for (const key of wikiExpandKeysFromFilePath(res.file_path)) nextKeys.add(key);
            return nextKeys;
          });
          setSelectedPath(res.file_path);
          const createdFolder = wikiFolderFromPath(res.file_path);
          if (createdFolder) setSelectedFolderPath(createdFolder);
          await loadDetail(res.file_path);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const el = document.querySelector(
                `[data-case-file-path="${CSS.escape(res.file_path)}"]`,
              );
              el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            });
          });
        } else {
          setPages(items);
          pagesRef.current = items;
          handleCancelCreatePage();
        }
        onAfterRepoWrite?.();
      } catch (err) {
        setCreateError(err?.message || "Failed to create wiki page");
      }
    },
    [
      activeRepoSlug,
      handleCancelCreatePage,
      reloadTree,
      queryParams,
      loadDetail,
      onAfterRepoWrite,
    ],
  );

  const handleStartCreate = useCallback(() => {
    startInlineCreate(selectedFolderPath || openedFolderPath);
  }, [selectedFolderPath, openedFolderPath, startInlineCreate]);

  const handleCreateFolder = useCallback(
    async (parentPath, folderName) => {
      if (archivedViewOpen) return;
      if (!parentPath || !activeRepoSlug) return;
      if (isArchivedWikiFolderPath(parentPath)) return;
      // If no name supplied, trigger the inline input instead of creating immediately.
      if (!folderName?.trim()) {
        // null means cancel from inline input — just clear state.
        if (folderName === null) {
          setCreatingFolderInPath(null);
          return;
        }
        if (searchOpen) handleCloseSearch();
        setCreatingFolderInPath(parentPath);
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const key of wikiExpandKeysFromFilePath(`${parentPath}/x.yaml`)) next.add(key);
          return next;
        });
        return;
      }
      const sanitized = sanitizeNameForPath(folderName.trim());
      if (!sanitized) return;
      try {
        const res = await createWikiFolder(parentPath, sanitized, activeRepoSlug);
        setCreatingFolderInPath(null);
        await reloadTree();
        if (res?.folder_path) {
          setSelectedFolderPath(res.folder_path);
          setExpanded((prev) => {
            const next = new Set(prev);
            for (const key of wikiExpandKeysFromFilePath(`${res.folder_path}/x.yaml`)) {
              next.add(key);
            }
            return next;
          });
        }
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to create folder");
      }
    },
    [activeRepoSlug, archivedViewOpen, searchOpen, handleCloseSearch, reloadTree, onAfterRepoWrite],
  );

  const wikiActionPaths = useCallback((rowOrBulk) => {
    const bulk = Array.isArray(rowOrBulk?.file_paths)
      ? rowOrBulk.file_paths.filter(Boolean)
      : null;
    if (Array.isArray(bulk) && bulk.length > 0) return bulk;
    const one = rowOrBulk?.file_path;
    return one ? [one] : [];
  }, []);

  const removePagesFromLocalState = useCallback(
    (paths) => {
      const pathSet = new Set(paths);
      setPages((prev) => {
        const next = prev.filter((p) => !pathSet.has(p.file_path));
        pagesRef.current = next;
        return next;
      });
      if (selectedPathRef.current && pathSet.has(selectedPathRef.current)) {
        clearPageSelection();
      }
      setSelectedWikiPaths((prev) => {
        const next = new Set([...prev].filter((p) => !pathSet.has(p)));
        return next;
      });
    },
    [clearPageSelection],
  );

  const handleArchivePage = useCallback(
    async (rowOrBulk, reason = "") => {
      if (!activeRepoSlug || archivedViewOpen) return;
      const paths = wikiActionPaths(rowOrBulk);
      if (paths.length === 0) return;
      try {
        if (paths.length === 1) {
          await archiveWikiPage(paths[0], reason, activeRepoSlug);
        } else {
          await archiveWikiPages(paths, reason, activeRepoSlug);
        }
        removePagesFromLocalState(paths);
        await reloadTree();
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to archive wiki page");
        await reloadFromBackend({ resort: true });
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      wikiActionPaths,
      removePagesFromLocalState,
      reloadTree,
      reloadFromBackend,
      onAfterRepoWrite,
    ],
  );

  const handleRestorePage = useCallback(
    async (rowOrBulk) => {
      if (!activeRepoSlug || !archivedViewOpen) return;
      const paths = wikiActionPaths(rowOrBulk);
      if (paths.length === 0) return;
      try {
        if (paths.length === 1) {
          await restoreWikiPage(paths[0], activeRepoSlug);
        } else {
          await restoreWikiPages(paths, activeRepoSlug);
        }
        removePagesFromLocalState(paths);
        await reloadTree();
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to restore wiki page");
        await reloadFromBackend({ resort: true });
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      wikiActionPaths,
      removePagesFromLocalState,
      reloadTree,
      reloadFromBackend,
      onAfterRepoWrite,
    ],
  );

  const handleDeletePage = useCallback(
    async (rowOrBulk) => {
      if (!activeRepoSlug || !archivedViewOpen) return;
      const paths = wikiActionPaths(rowOrBulk);
      if (paths.length === 0) return;
      if (paths.some((fp) => !isArchivedWikiPath(fp))) {
        window.alert("Only archived wiki pages can be deleted permanently.");
        return;
      }
      const ok = await confirm({
        title: paths.length > 1 ? `Delete ${paths.length} wiki pages?` : "Delete wiki page?",
        description:
          paths.length > 1
            ? `Delete ${paths.length} wiki pages permanently? This cannot be undone.`
            : "Delete this wiki page permanently? This cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        variant: "danger",
      });
      if (!ok) return;
      try {
        for (const fp of paths) {
          await deleteWikiPage(fp, activeRepoSlug);
        }
        removePagesFromLocalState(paths);
        await reloadTree();
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to delete wiki page");
        await reloadFromBackend({ resort: true });
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      wikiActionPaths,
      confirm,
      removePagesFromLocalState,
      reloadTree,
      reloadFromBackend,
      onAfterRepoWrite,
    ],
  );

  const handleArchiveFolder = useCallback(
    async (directoryPath) => {
      if (!activeRepoSlug || archivedViewOpen || !directoryPath) return;
      if (directoryPath === WIKI_ROOT) return;
      try {
        await archiveWikiFolder(directoryPath, "", activeRepoSlug);
        if (openedFolderPath === directoryPath) setOpenedFolderPath(null);
        if (selectedFolderPath === directoryPath) setSelectedFolderPath(null);
        await reloadFromBackend({ resort: true });
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to archive folder");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      openedFolderPath,
      selectedFolderPath,
      reloadFromBackend,
      onAfterRepoWrite,
    ],
  );

  const handleDeleteActiveFolder = useCallback(
    async (directoryPath) => {
      if (!activeRepoSlug || archivedViewOpen || !directoryPath) return;
      if (directoryPath === WIKI_ROOT) return;
      const ok = await confirm({
        title: "Delete empty folder?",
        description: "Delete this empty folder permanently? This cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        variant: "danger",
      });
      if (!ok) return;
      try {
        await deleteActiveWikiFolder(directoryPath, activeRepoSlug);
        if (openedFolderPath === directoryPath) setOpenedFolderPath(null);
        if (selectedFolderPath === directoryPath) setSelectedFolderPath(null);
        await reloadFromBackend({ resort: true });
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to delete folder");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      confirm,
      openedFolderPath,
      selectedFolderPath,
      reloadFromBackend,
      onAfterRepoWrite,
    ],
  );

  const handleRestoreFolder = useCallback(
    async (directoryPath) => {
      if (!activeRepoSlug || !archivedViewOpen || !directoryPath) return;
      try {
        await restoreWikiFolder(directoryPath, activeRepoSlug);
        if (openedFolderPath === directoryPath) setOpenedFolderPath(null);
        if (selectedFolderPath === directoryPath) setSelectedFolderPath(null);
        await reloadFromBackend({ resort: true });
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to restore folder");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      openedFolderPath,
      selectedFolderPath,
      reloadFromBackend,
      onAfterRepoWrite,
    ],
  );

  const handleDeleteFolder = useCallback(
    async (directoryPath) => {
      if (!activeRepoSlug || !archivedViewOpen || !directoryPath) return;
      const ok = await confirm({
        title: "Delete folder?",
        description: "Delete this archived folder and its pages permanently? This cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        variant: "danger",
      });
      if (!ok) return;
      try {
        await deleteWikiFolder(directoryPath, activeRepoSlug);
        if (openedFolderPath === directoryPath) setOpenedFolderPath(null);
        if (selectedFolderPath === directoryPath) setSelectedFolderPath(null);
        await reloadFromBackend({ resort: true });
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to delete folder");
      }
    },
    [
      activeRepoSlug,
      archivedViewOpen,
      confirm,
      openedFolderPath,
      selectedFolderPath,
      reloadFromBackend,
      onAfterRepoWrite,
    ],
  );

  const handleMoveWikiPages = useCallback(
    async (filePaths, targetFolderPath) => {
      if (!activeRepoSlug || archivedViewOpen) return;
      const paths = (filePaths || []).filter(Boolean);
      if (paths.length === 0 || !targetFolderPath) return;
      try {
        await moveWikiPages(paths, targetFolderPath, activeRepoSlug);
        if (selectedPathRef.current && paths.includes(selectedPathRef.current)) {
          const nextPath = computeCaseMovePath(selectedPathRef.current, targetFolderPath);
          setSelectedPath(nextPath);
          selectedPathRef.current = nextPath;
          const nextFolder = wikiFolderFromPath(nextPath) || targetFolderPath;
          setSelectedFolderPath(nextFolder);
        }
        await reloadFromBackend({ resort: true });
        onAfterRepoWrite?.();
      } catch (err) {
        window.alert(err?.message || "Failed to move wiki page");
        await reloadFromBackend({ resort: true });
      }
    },
    [activeRepoSlug, archivedViewOpen, reloadFromBackend, onAfterRepoWrite],
  );

  const caseSelectionConfig = useMemo(() => {
    if (archivedViewOpen || searchOpen) return null;
    return {
      selectedPaths: selectedWikiPaths,
      onChange: setSelectedWikiPaths,
      orderedPaths: orderedWikiPaths,
      onMoveCasesToFolder: handleMoveWikiPages,
    };
  }, [
    archivedViewOpen,
    searchOpen,
    selectedWikiPaths,
    orderedWikiPaths,
    handleMoveWikiPages,
  ]);

  const handleOpenArchivedView = useCallback(() => {
    handleCloseSearch();
    setCreatingFolder(false);
    setCreatingPageInFolder(null);
    setOpenedFolderPath(null);
    setSelectedFolderPath(null);
    clearPageSelection();
    setArchivedViewOpen(true);
  }, [handleCloseSearch, clearPageSelection]);

  const handleCloseArchivedView = useCallback(() => {
    setOpenedFolderPath(null);
    setSelectedFolderPath(null);
    clearPageSelection();
    setArchivedViewOpen(false);
  }, [clearPageSelection]);

  const getFolderContextMenuItems = useCallback(
    (node, close) => {
      if (!node?.directory_path) return [];
      const items = [];
      const dir = node.directory_path;
      const pageCount = node.case_count ?? 0;
      if (archivedViewOpen) {
        if (dir !== WIKI_ARCHIVE_ROOT && openedFolderPath !== dir) {
          items.push({
            icon: FolderOpen,
            label: "Open Folder",
            hint: "Double-click",
            onClick: () => {
              close();
              handleOpenFolder(dir);
            },
          });
        }
        if (pageCount > 0) {
          items.push({
            icon: RotateCcw,
            label: "Restore folder",
            onClick: () => {
              close();
              void handleRestoreFolder(dir);
            },
          });
        }
        items.push({
          icon: Trash2,
          label: "Delete permanently",
          danger: true,
          onClick: () => {
            close();
            void handleDeleteFolder(dir);
          },
        });
        return items;
      }
      if (dir !== WIKI_ROOT && openedFolderPath !== dir) {
        items.push({
          icon: FolderOpen,
          label: "Open Folder",
          hint: "Double-click",
          onClick: () => {
            close();
            handleOpenFolder(dir);
          },
        });
      }
      items.push({
        icon: FilePlus2,
        label: "New page",
        onClick: () => {
          close();
          startInlineCreate(dir);
        },
      });
      items.push({
        icon: FolderPlus,
        label: "New folder",
        onClick: () => {
          close();
          setCreatingFolderInPath(dir);
          setExpanded((prev) => {
            const next = new Set(prev);
            for (const key of wikiExpandKeysFromFilePath(`${dir}/x.yaml`)) next.add(key);
            return next;
          });
        },
      });
      if (pageCount > 0 && dir !== WIKI_ROOT) {
        items.push({
          icon: Archive,
          label: "Archive folder",
          onClick: () => {
            close();
            void handleArchiveFolder(dir);
          },
        });
      }
      if (pageCount === 0 && dir !== WIKI_ROOT) {
        items.push({ type: "separator" });
        items.push({
          icon: Trash2,
          label: "Delete folder",
          danger: true,
          onClick: () => {
            close();
            void handleDeleteActiveFolder(dir);
          },
        });
      }
      return items;
    },
    [
      archivedViewOpen,
      openedFolderPath,
      handleOpenFolder,
      startInlineCreate,
      setCreatingFolderInPath,
      handleArchiveFolder,
      handleDeleteActiveFolder,
      handleRestoreFolder,
      handleDeleteFolder,
    ],
  );

  const handleCommitInlineFolder = async (name) => {
    const parent = openedFolderPath || WIKI_ROOT;
    setCreatingFolder(false);
    setCreatingFolderInPath(null);
    if (!name?.trim() || !activeRepoSlug) return;
    await handleCreateFolder(parent, name);
  };

  const handleAutoSavePage = async (payload) => {
    if (archivedViewOpen) return;
    const pathAtSave = payload?.file_path || selectedPathRef.current;
    if (!pathAtSave || !activeRepoSlug) return;
    const updated = await updateWikiPage(pathAtSave, payload, activeRepoSlug);
    if (selectedPathRef.current === pathAtSave && updated?.file_path) {
      setPageDetail(updated);
    }
    setPages((prev) => {
      const next = prev.map((p) => {
        if (p.file_path !== pathAtSave) return p;
        return {
          ...p,
          title: payload.title ?? p.title,
          ...(updated?.updated_at != null ? { updated_at: updated.updated_at } : {}),
        };
      });
      pagesRef.current = next;
      return next;
    });
    onAfterRepoWrite?.();
  };

  const searchButton = (
    <SearchToggleButton
      isOpen={searchOpen}
      hasActiveChips={!!searchChips.length}
      onClick={handleSearchClick}
      ariaLabelWhenClosed="Filter wiki pages"
    />
  );

  const handleArchivedClick = () => {
    if (archivedViewOpen) {
      handleCloseArchivedView();
    } else {
      handleOpenArchivedView();
    }
  };

  const archivedButton = (
    <Tooltip label={archivedViewOpen ? "Back to tree" : "Archived wiki pages"} placement="bottom">
      <button
        type="button"
        onClick={handleArchivedClick}
        className={`${TOOLBAR_BTN_BASE} ${archivedViewOpen ? TOOLBAR_BTN_SELECTED : ""}`}
        aria-label={archivedViewOpen ? "Back to tree" : "Archived wiki pages"}
      >
        {archivedViewOpen ? <ArrowLeft className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </button>
    </Tooltip>
  );

  const wikiToolbar = (
    <TreeToolbar
      addButton={
        archivedViewOpen ? null : (
          <TitleBarAddButton
            tooltip="New wiki folder"
            onClick={() => {
              if (searchOpen) handleCloseSearch();
              const parent =
                selectedFolderPath && selectedFolderPath !== WIKI_ROOT
                  ? selectedFolderPath
                  : openedFolderPath && openedFolderPath !== WIKI_ROOT
                    ? openedFolderPath
                    : null;
              if (parent) {
                setCreatingFolderInPath(parent);
                setExpanded((prev) => {
                  const next = new Set(prev);
                  for (const key of wikiExpandKeysFromFilePath(`${parent}/x.yaml`)) next.add(key);
                  return next;
                });
                return;
              }
              setCreatingFolder(true);
            }}
            ariaLabel="New wiki folder"
          />
        )
      }
      sortButton={null}
      searchNode={searchButton}
      extraActions={archivedButton}
      onBeforeAction={searchOpen ? handleCloseSearch : undefined}
    />
  );

  const treeBody = (
    <TreeAreaHoverProvider>
      <TreeScrollContainer className={`${flexFillScroll} min-h-0 flex-1 pl-0 pr-1 pt-0 pb-2`}>
        <CaseTree
          tree={visibleFolderTree}
          rows={pageRows}
          selectedCaseFilePath={selectedPath}
          onSelectCase={handleSelectPage}
          selectedFolderPath={selectedFolderPath}
          onSelectFolder={handleSelectFolder}
          onOpenFolder={handleOpenFolder}
          openedFolderPath={openedFolderPath}
          onCloseOpenedFolder={handleCloseOpenedFolder}
          creatingProject={creatingFolder && !openedFolderPath && !archivedViewOpen}
          onCommitInlineProject={archivedViewOpen ? undefined : handleCommitInlineFolder}
          creatingProjectPlaceholder="Folder name…"
          onCreateFolder={archivedViewOpen ? undefined : handleCreateFolder}
          creatingFolderInPath={archivedViewOpen ? null : creatingFolderInPath}
          creatingCaseInPath={archivedViewOpen ? null : creatingPageInFolder}
          creatingCaseError={createError}
          creatingCasePlaceholder="Page filename…"
          onStartCreatingCase={archivedViewOpen ? undefined : startInlineCreate}
          onCommitInlineCase={archivedViewOpen ? undefined : handleCommitCreatePage}
          getFolderContextMenuItems={getFolderContextMenuItems}
          folderMenuNewItemLabel="New page"
          folderMenuNewFolderLabel="New folder"
          showFolderRename={false}
          archivedView={archivedViewOpen}
          isArchivedFilePath={isArchivedWikiPath}
          onArchiveCase={archivedViewOpen ? undefined : handleArchivePage}
          onRestoreCase={archivedViewOpen ? handleRestorePage : undefined}
          onDeleteCase={archivedViewOpen ? handleDeletePage : undefined}
          caseSelectionConfig={caseSelectionConfig}
          emptyMessage={
            !activeRepoSlug
              ? "Connect a repository"
              : archivedViewOpen
                ? "No archived wiki pages."
                : "No wiki folders yet. Use + to create one."
          }
          expanded={expanded}
          onExpandedChange={setExpanded}
          forceExpandAll={searchOpen}
          hideEmptyNodes={searchOpen}
          pinningEnabled={false}
          showCaseId={false}
          caseRowIcon={<WikiPageIcon />}
        />
      </TreeScrollContainer>
    </TreeAreaHoverProvider>
  );

  const listColumn = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
        <SidebarSection title="Wiki" titleRight={sidebarTitleRight} toolbar={wikiToolbar} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {searchOpen ? (
          <SearchPanel
            searchKeys={wikiSearchKeys()}
            freeTextSearchKey="q"
            freeTextPlaceholder="Search by title or id…"
            filterOptions={{ tags: allWikiTags }}
            onSearch={handleSearch}
            onClose={handleCloseSearch}
            history={history}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            isFavorite={isFavorite}
            resultsContent={treeBody}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {archivedViewOpen ? (
              <HiddenViewBanner
                label="Archived"
                tooltip="Only archived wiki pages are shown. Click the toolbar button to go back to the main tree."
              />
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">{treeBody}</div>
          </div>
        )}
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
      storageKeys={{ sidebarWidth: "wiki.col.sidebarWidth" }}
      sidebarColumn={listColumn}
      detailColumn={
        <WikiEditorPanel
          pageDetail={pageDetail}
          selectedPageFilePath={selectedPath}
          pageDetailLoading={detailLoading}
          pageDetailLoadGeneration={pageDetailLoadGeneration}
          isEditing={archivedViewOpen ? false : isEditing}
          readOnly={archivedViewOpen}
          onToggleEdit={handleToggleEdit}
          onSave={handleAutoSavePage}
          onStartCreate={canCreatePage ? handleStartCreate : undefined}
          allTags={allWikiTags}
          repoSlug={activeRepoSlug}
          storageSyncConfigured={storageSyncConfigured}
          onOpenStorageSyncSettings={onOpenStorageSyncSettings}
          onOpenTicket={onNavigateToTicket}
          onOpenWikiPage={handleSelectPage}
        />
      }
    />
  );
}

export default WikiPage;
