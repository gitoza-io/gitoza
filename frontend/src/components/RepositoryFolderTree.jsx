import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Archive, Box, FilePlus2, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import ContextMenu from "./ContextMenu";
import InlineRenameInput from "./InlineRenameInput";
import FolderTreeRow from "./FolderTreeRow";
import VirtualizedFolderList from "./VirtualizedFolderList";
import { TestRunIcon } from "./TestEntityIcons";
import { SidebarLoading, TreeRowGuides, TREE_ROW_CONTENT_GAP } from "./SidebarSection";
import { TreeScrollContainer } from "../contexts/TreeScrollContext";
import { VIRTUAL_FOLDER_TREE_THRESHOLD } from "../constants/virtualFolderTree";
import { flexFillScroll } from "../utils/layoutClasses";
import { isRenameNameConflictError } from "../utils/renameConflict";
import { buildDirectoryRowIndex } from "../utils/casePickerSelection";
import { flattenVisibleFolderRows } from "../utils/folderTreeFlat";
import { sortTreeWithPinnedProjects } from "../utils/folderTreePins";

/**
 * Folder-only tree for Test Repository browse pane (projects + suites).
 */
function RepositoryFolderTree({
  tree = [],
  projectsReady = false,
  treeStructureLoadingPrefixes = null,
  selectedFolderPath = null,
  onSelectFolder,
  expanded: expandedProp,
  onExpandedChange,
  onContextCreateTestCase,
  onCommitInlineCase,
  onRenameFolder,
  onCreateFolder,
  onArchiveFolder,
  onRestoreFolder,
  onDeleteFolder,
  onDeleteProject,
  editorLocked = false,
  archivedView = false,
  creatingProject = false,
  onCommitInlineProject,
  onFolderExpand,
  loadingPrefixes,
  loadedPrefixes,
  dragOverFolderPath = null,
  draggingSourcePaths = null,
  onStartCreatingCase,
  creatingInPath: creatingInPathProp,
  onCreatingInPathChange,
  pickerMode = false,
  pickerRows = [],
  selectedFilePaths,
  onToggleProject,
  onToggleSuite,
  filterPath,
  pickerDisabled = false,
  badgeSourceRows = null,
  creatingRun = false,
  onCommitCreateRun,
  renamingRunId = null,
  onRenameRunCommit,
  onRenameRunCancel,
  onContextMenuRun,
  runRowRight,
  getFolderContextMenuItems,
  pinningEnabled = false,
  pinnedProjectPaths = null,
  onTogglePinProject = null,
  isPinnedProject = null,
  onOpenProject = null,
  openedProjectPath = null,
  onCloseOpenedProject = null,
  onOpenRun = null,
  openedRunPath = null,
  onCloseOpenedRun = null,
}) {
  const [internalExpanded, setInternalExpanded] = useState(() => new Set());
  const isControlled = expandedProp !== undefined && onExpandedChange != null;
  const expanded = isControlled ? expandedProp : internalExpanded;
  const setExpanded = isControlled ? onExpandedChange : setInternalExpanded;

  const [contextMenu, setContextMenu] = useState(null);
  const [renamingPath, setRenamingPath] = useState(null);
  const [renameFolderConflict, setRenameFolderConflict] = useState(null);
  const [internalCreatingInPath, setInternalCreatingInPath] = useState(null);
  const creatingInPath =
    creatingInPathProp !== undefined ? creatingInPathProp : internalCreatingInPath;
  const setCreatingInPath = onCreatingInPathChange ?? setInternalCreatingInPath;

  const virtualListRef = useRef(null);
  const lastScrolledFolderRef = useRef(null);

  const multiSelectActive = Boolean(draggingSourcePaths?.length);

  const sortedTree = useMemo(() => {
    if (pinningEnabled && pinnedProjectPaths?.size) {
      return sortTreeWithPinnedProjects(tree, pinnedProjectPaths);
    }
    return tree;
  }, [tree, pinningEnabled, pinnedProjectPaths]);

  const flatRows = useMemo(
    () => flattenVisibleFolderRows(sortedTree, expanded, { creatingInPath }),
    [sortedTree, expanded, creatingInPath],
  );

  const directoryIndex = useMemo(() => {
    const rows = badgeSourceRows ?? (pickerMode ? pickerRows : null);
    if (!rows?.length) return null;
    return buildDirectoryRowIndex(rows, { filterPath });
  }, [badgeSourceRows, pickerMode, pickerRows, filterPath]);

  const shouldVirtualize = flatRows.length >= VIRTUAL_FOLDER_TREE_THRESHOLD;

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

  const toggle = useCallback(
    (pathKey) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(pathKey)) next.delete(pathKey);
        else next.add(pathKey);
        return next;
      });
    },
    [setExpanded],
  );

  const handleContextNewCase = () => {
    if (contextMenu?.node?.directory_path) {
      if (onStartCreatingCase) {
        onStartCreatingCase(contextMenu.node.directory_path);
      } else if (onCommitInlineCase) {
        onContextCreateTestCase?.(contextMenu.node.directory_path);
      } else {
        onContextCreateTestCase?.(contextMenu.node.directory_path);
      }
      const pathKey =
        contextMenu.node.directory_path?.replace(/^\.gitoza\/test\/cases\/?/, "") ||
        contextMenu.node.name;
      setExpanded((prev) => new Set([...prev, pathKey]));
      onSelectFolder?.(contextMenu.node.directory_path);
    }
    setContextMenu(null);
  };

  const handleContextNewSuite = () => {
    if (contextMenu?.node?.directory_path) {
      setCreatingInPath(contextMenu.node.directory_path);
      setExpanded((prev) => new Set([...prev, contextMenu.node.name]));
    }
    setContextMenu(null);
  };

  const handleContextRename = () => {
    if (contextMenu?.node?.directory_path) {
      setRenamingPath(contextMenu.node.directory_path);
      setRenameFolderConflict(null);
    }
    setContextMenu(null);
  };

  const handleContextDelete = () => {
    if (contextMenu?.node?.directory_path) onDeleteFolder?.(contextMenu.node.directory_path);
    setContextMenu(null);
  };

  const handleContextArchive = () => {
    if (contextMenu?.node) onArchiveFolder?.(contextMenu.node);
    setContextMenu(null);
  };

  const handleContextRestore = () => {
    if (contextMenu?.node) onRestoreFolder?.(contextMenu.node);
    setContextMenu(null);
  };

  const handleRenameCommit = useCallback(
    async (folderPath, newName) => {
      if (newName == null) {
        setRenamingPath(null);
        setRenameFolderConflict(null);
        return;
      }
      if (!onRenameFolder) return;
      setRenameFolderConflict(null);
      try {
        await onRenameFolder(folderPath, newName);
        setRenamingPath(null);
        setRenameFolderConflict(null);
      } catch (err) {
        if (isRenameNameConflictError(err)) {
          setRenameFolderConflict({ folderPath, displayName: err.displayName });
          setRenamingPath(folderPath);
          return;
        }
        setRenamingPath(null);
        setRenameFolderConflict(null);
      }
    },
    [onRenameFolder],
  );

  const handleCreateFolderCommit = useCallback(
    (parentPath, folderName) => {
      setCreatingInPath(null);
      if (folderName && onCreateFolder) onCreateFolder(parentPath, folderName);
    },
    [onCreateFolder, setCreatingInPath],
  );

  const handleContextMenu = useCallback((e, n) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node: n });
  }, []);

  let contextMenuItems = [];
  if (contextMenu?.node && getFolderContextMenuItems) {
    contextMenuItems =
      getFolderContextMenuItems(contextMenu.node, () => setContextMenu(null)) ?? [];
  } else if (contextMenu?.node && archivedView && !editorLocked) {
    const isProject = contextMenu.node?.is_project === true;
    const isRun = contextMenu.node?.is_run === true;
    const hasCases = (contextMenu.node.case_count ?? 0) > 0;
    if (
      onOpenProject &&
      isProject &&
      !isRun &&
      openedProjectPath !== contextMenu.node.directory_path
    ) {
      contextMenuItems.push({
        icon: FolderOpen,
        label: "Open Project",
        hint: "Double-click",
        onClick: () => {
          onOpenProject(contextMenu.node.directory_path);
          setContextMenu(null);
        },
      });
    }
    if (onRestoreFolder && hasCases) {
      if (contextMenuItems.length > 0) contextMenuItems.push({ type: "separator" });
      contextMenuItems.push({
        icon: Archive,
        label: isProject ? "Restore project…" : "Restore suite…",
        onClick: handleContextRestore,
      });
    }
    if (!isProject && onDeleteFolder) {
      if (contextMenuItems.length > 0) contextMenuItems.push({ type: "separator" });
      contextMenuItems.push({
        icon: Trash2,
        label: "Delete Suite",
        onClick: handleContextDelete,
        variant: "danger",
      });
    } else if (isProject && onDeleteProject) {
      if (contextMenuItems.length > 0) contextMenuItems.push({ type: "separator" });
      contextMenuItems.push({
        icon: Trash2,
        label: "Delete project…",
        variant: "danger",
        onClick: () => {
          onDeleteProject(contextMenu.node);
          setContextMenu(null);
        },
      });
    }
  } else if (contextMenu?.node && !editorLocked) {
    const isProject = contextMenu.node?.is_project === true;
    const isRun = contextMenu.node?.is_run === true;
    const hasCases = (contextMenu.node.case_count ?? 0) > 0;
    if (
      onOpenProject &&
      isProject &&
      !isRun &&
      openedProjectPath !== contextMenu.node.directory_path
    ) {
      contextMenuItems.push({
        icon: FolderOpen,
        label: "Open Project",
        hint: "Double-click",
        onClick: () => {
          onOpenProject(contextMenu.node.directory_path);
          setContextMenu(null);
        },
      });
    }
    if (onArchiveFolder && hasCases) {
      if (contextMenuItems.length > 0) contextMenuItems.push({ type: "separator" });
      contextMenuItems.push({
        icon: Archive,
        label: isProject ? "Archive project…" : "Archive suite…",
        onClick: handleContextArchive,
      });
      contextMenuItems.push({ type: "separator" });
    }
    contextMenuItems.push(
      { icon: FilePlus2, label: "New Test Case", onClick: handleContextNewCase },
      { icon: FolderPlus, label: "New Test Suite", onClick: handleContextNewSuite },
      { type: "separator" },
      { icon: Pencil, label: "Rename", onClick: handleContextRename },
    );
  }

  const rowProps = useMemo(
    () => ({
      selectedFolderPath,
      onSelectFolder,
      onFolderExpand,
      onToggle: toggle,
      loadingPrefixes,
      loadedPrefixes,
      treeStructureLoadingPrefixes,
      contextMenuTargetFolderNode: contextMenu?.node ?? null,
      onContextMenu: handleContextMenu,
      renamingPath,
      renameFolderConflict,
      onFolderRenameValueChange: () => setRenameFolderConflict(null),
      onRenameCommit: handleRenameCommit,
      onCreateFolderCommit: handleCreateFolderCommit,
      multiSelectActive,
      dragOverFolderPath,
      draggingSourcePaths,
      pickerMode,
      pickerRows,
      selectedFilePaths,
      onToggleProject,
      onToggleSuite,
      filterPath,
      pickerDisabled,
      directoryIndex,
      renamingRunId,
      onRenameRunCommit,
      onRenameRunCancel,
      onContextMenuRun,
      runRowRight,
      pinningEnabled,
      isPinned: isPinnedProject,
      onTogglePin: onTogglePinProject,
      onOpenProject,
      openedProjectPath,
      onCloseOpenedProject,
      onOpenRun,
      openedRunPath,
      onCloseOpenedRun,
    }),
    [
      selectedFolderPath,
      onSelectFolder,
      onFolderExpand,
      toggle,
      loadingPrefixes,
      loadedPrefixes,
      treeStructureLoadingPrefixes,
      contextMenu?.node,
      handleContextMenu,
      handleRenameCommit,
      handleCreateFolderCommit,
      renamingPath,
      renameFolderConflict,
      multiSelectActive,
      dragOverFolderPath,
      draggingSourcePaths,
      pickerMode,
      pickerRows,
      selectedFilePaths,
      onToggleProject,
      onToggleSuite,
      filterPath,
      pickerDisabled,
      directoryIndex,
      renamingRunId,
      onRenameRunCommit,
      onRenameRunCancel,
      onContextMenuRun,
      runRowRight,
      pinningEnabled,
      isPinnedProject,
      onTogglePinProject,
      onOpenProject,
      openedProjectPath,
      onCloseOpenedProject,
      onOpenRun,
      openedRunPath,
      onCloseOpenedRun,
    ],
  );

  useLayoutEffect(() => {
    if (!shouldVirtualize || !selectedFolderPath) {
      lastScrolledFolderRef.current = null;
      return;
    }
    if (lastScrolledFolderRef.current === selectedFolderPath) return;
    lastScrolledFolderRef.current = selectedFolderPath;
    virtualListRef.current?.scrollToDirectoryPath(selectedFolderPath, {
      align: "auto",
      behavior: "auto",
    });
  }, [shouldVirtualize, selectedFolderPath, flatRows]);

  if (!tree?.length && !creatingProject && !creatingRun) {
    if (!projectsReady) {
      return (
        <div className="px-2 py-4">
          <SidebarLoading message="Loading projects…" />
        </div>
      );
    }
    return (
      <div className="px-2 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
        No test suites in repository.
      </div>
    );
  }

  return (
    <>
      <TreeScrollContainer className={`${flexFillScroll} min-h-0 flex-1 pl-0 pr-1 pt-0 pb-2`}>
        {creatingProject && onCommitInlineProject ? (
          <div className="flex min-w-0">
            <TreeRowGuides level={0} />
            <div
              className="flex min-w-0 flex-1 items-center gap-2 rounded py-1.5"
              style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}
            >
              <Box className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" aria-hidden />
              <InlineRenameInput
                initialValue=""
                placeholder="Project name…"
                onCommit={onCommitInlineProject}
              />
            </div>
          </div>
        ) : null}
        {creatingRun && onCommitCreateRun ? (
          <div className="flex min-w-0">
            <TreeRowGuides level={0} />
            <div
              className="flex min-w-0 flex-1 items-center gap-2 rounded py-1.5"
              style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}
            >
              <TestRunIcon className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
              <InlineRenameInput
                initialValue=""
                placeholder="Run name…"
                onCommit={onCommitCreateRun}
              />
            </div>
          </div>
        ) : null}
        {shouldVirtualize ? (
          <VirtualizedFolderList ref={virtualListRef} flatRows={flatRows} rowProps={rowProps} />
        ) : (
          <ul className="space-y-0">
            {flatRows.map((row) => (
              <FolderTreeRow
                key={
                  row.kind === "folder"
                    ? row.node.directory_path ?? row.pathKey
                    : `create:${row.parentPath}`
                }
                row={row}
                {...rowProps}
              />
            ))}
          </ul>
        )}
      </TreeScrollContainer>
      {contextMenu && contextMenuItems.length > 0 ? (
        <ContextMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={contextMenuItems}
        />
      ) : null}
    </>
  );
}

export default RepositoryFolderTree;
