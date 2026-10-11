import {
  Box,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ContextMenu from "./ContextMenu";
import InlineRenameInput from "./InlineRenameInput";
import { TreeRowGuides, TREE_ROW_CONTENT_GAP, treeRowSelectedFullWidthClass, treeRowHoverFullWidthClass } from "./SidebarSection";

/**
 * Folder-only sidebar tree with semantic icons, live case-count badges,
 * and a right-click context menu for "New Test Case", "New Test Suite",
 * and "Rename".
 */
function SidebarTree({
  tree = [],
  selectedFolderPath = null,
  onSelectFolder,
  expandFolderNames = [],
  onContextCreateTestCase,
  onRenameFolder,
  onCreateFolder,
  onDeleteFolder,
}) {
  const [expanded, setExpanded] = useState(() => new Set(expandFolderNames));
  const [contextMenu, setContextMenu] = useState(null); // { x, y, node }
  const [renamingPath, setRenamingPath] = useState(null);
  const [creatingInPath, setCreatingInPath] = useState(null); // parent path for new folder

  useEffect(() => {
    if (expandFolderNames?.length) {
      setExpanded((prev) => {
        const next = new Set(prev);
        expandFolderNames.forEach((name) => next.add(name));
        return next;
      });
    }
  }, [expandFolderNames?.join(",")]);

  const toggleFolder = useCallback((pathKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  // Close context menu on outside click or scroll
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

  const handleContextMenu = useCallback((e, node) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // ─── Context menu actions ───

  const handleContextNewCase = () => {
    if (contextMenu?.node?.directory_path) {
      onContextCreateTestCase?.(contextMenu.node.directory_path);
    }
    setContextMenu(null);
  };

  const handleContextNewSuite = () => {
    if (contextMenu?.node?.directory_path) {
      const dirPath = contextMenu.node.directory_path;
      setCreatingInPath(dirPath);
      // Auto-expand the folder so the inline input is visible
      const pathKey = contextMenu.node.name;
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(pathKey);
        return next;
      });
    }
    setContextMenu(null);
  };

  const handleContextRename = () => {
    if (contextMenu?.node?.directory_path) {
      setRenamingPath(contextMenu.node.directory_path);
    }
    setContextMenu(null);
  };

  const handleContextDeleteSuite = () => {
    if (contextMenu?.node?.directory_path) {
      onDeleteFolder?.(contextMenu.node.directory_path);
    }
    setContextMenu(null);
  };

  const handleRenameCommit = (folderPath, newName) => {
    setRenamingPath(null);
    if (newName && onRenameFolder) {
      onRenameFolder(folderPath, newName);
    }
  };

  const handleCreateFolderCommit = (parentPath, folderName) => {
    setCreatingInPath(null);
    if (folderName && onCreateFolder) {
      onCreateFolder(parentPath, folderName);
    }
  };

  if (!tree?.length) {
    return (
      <div className="py-4 text-center text-sm text-slate-600 dark:text-slate-400">
        No test suites in repository.
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-0">
        {tree.map((node) => (
          <FolderNode
            key={node.name + (node.directory_path ?? "")}
            node={node}
            pathKey={node.name}
            level={0}
            expanded={expanded}
            onToggle={toggleFolder}
            selectedFolderPath={selectedFolderPath}
            onSelectFolder={onSelectFolder}
            onContextMenu={handleContextMenu}
            renamingPath={renamingPath}
            onRenameCommit={handleRenameCommit}
            creatingInPath={creatingInPath}
            onCreateFolderCommit={handleCreateFolderCommit}
          />
        ))}
      </ul>

      {/* ─── Context Menu ─── */}
      {contextMenu && (
        <ContextMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { icon: FilePlus2, label: "New Test Case", onClick: handleContextNewCase },
            { icon: FolderPlus, label: "New Test Suite", onClick: handleContextNewSuite },
            { type: "separator" },
            { icon: Pencil, label: "Rename", onClick: handleContextRename },
            ...(!contextMenu.node?.is_project && onDeleteFolder
              ? [
                  { type: "separator" },
                  { icon: Trash2, label: "Delete Suite", onClick: handleContextDeleteSuite, variant: "danger" },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}

/* ─── Folder Node ─── */
function FolderNode({
  node,
  pathKey,
  level,
  expanded,
  onToggle,
  selectedFolderPath,
  onSelectFolder,
  onContextMenu,
  renamingPath,
  onRenameCommit,
  creatingInPath,
  onCreateFolderCommit,
}) {
  const isExpanded = expanded.has(pathKey);
  const hasChildren = node.children?.length > 0;
  const isSelected = node.directory_path === selectedFolderPath;
  const isProject = node.is_project === true;
  const count = node.case_count ?? 0;
  const isRenaming = renamingPath === node.directory_path;
  const isCreatingChild = creatingInPath === node.directory_path;
  const gap = TREE_ROW_CONTENT_GAP;

  const canToggle = hasChildren || isProject;

  const handleClick = () => {
    if (isRenaming) return;
    onSelectFolder?.(node.directory_path);
    if (canToggle) onToggle(pathKey);
  };

  const handleKeyDown = (e) => {
    const target = e.target;
    const isEditable =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      (target.isContentEditable && target.getAttribute("contenteditable") !== "false");
    if (isEditable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const editableName = node.name;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={canToggle ? isExpanded : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => onContextMenu(e, node)}
        className={`group flex min-w-0 w-full cursor-pointer ${
          isSelected ? treeRowSelectedFullWidthClass : treeRowHoverFullWidthClass
        }`}
        title={node.display_name ?? node.name}
      >
        <TreeRowGuides level={level} />
        <div
          className={`flex min-w-0 flex-1 items-center gap-2 rounded pl-1 pr-2 py-1.5 text-left text-sm transition ${
            isSelected
              ? "bg-transparent font-semibold text-ink dark:text-slate-100"
              : "font-medium text-slate-600 dark:text-slate-300"
          }`}
          style={{ paddingLeft: `${gap}px` }}
        >
          {/* Chevron */}
          {canToggle ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {/* Project = minimal Box icon; suite = no icon */}
          {isProject ? (
            <Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          ) : null}

          {/* Name or inline rename input */}
          {isRenaming ? (
            <InlineRenameInput
              initialValue={node.display_name ?? node.name}
              placeholder="New name…"
              onCommit={(val) => onRenameCommit(node.directory_path, val)}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{node.display_name ?? node.name}</span>
          )}

          {/* Count badge */}
          {!isRenaming && (
            <span
              className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums ${
                count === 0
                  ? "bg-slate-50 text-slate-300 dark:bg-slate-800/50 dark:text-slate-600"
                  : isSelected
                    ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/30 dark:text-indigo-300"
                    : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-slate-700"
              }`}
            >
              {count}
            </span>
          )}
        </div>
      </div>

      {/* Children + optional "new folder" inline input */}
      {(hasChildren || isCreatingChild) && (isExpanded || isCreatingChild) && (
        <ul className="space-y-0">
          {(node.children ?? []).map((child) => (
            <FolderNode
              key={child.name + (child.directory_path ?? "")}
              node={child}
              pathKey={`${pathKey}/${child.name}`}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedFolderPath={selectedFolderPath}
              onSelectFolder={onSelectFolder}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onRenameCommit={onRenameCommit}
              creatingInPath={creatingInPath}
              onCreateFolderCommit={onCreateFolderCommit}
            />
          ))}

          {/* Inline "new test suite" input appended at the bottom of children */}
          {isCreatingChild && (
            <li>
              <div className="flex min-w-0">
                <TreeRowGuides level={level + 1} />
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded py-1.5" style={{ paddingLeft: `${gap}px` }}>
                  <FolderPlus className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
                  <InlineRenameInput
                    initialValue=""
                    placeholder="Folder name…"
                    onCommit={(val) => onCreateFolderCommit(node.directory_path, val)}
                  />
                </div>
              </div>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

export default SidebarTree;
