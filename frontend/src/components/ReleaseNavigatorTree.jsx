import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, FolderOpen, Rocket } from "lucide-react";
import { TreeAreaHoverProvider } from "../contexts/TreeAreaHoverContext";
import { VirtualCaseListRegistryProvider, useVirtualCaseListRegistry } from "../contexts/VirtualCaseListRegistryContext";
import { TreeScrollContainer } from "../contexts/TreeScrollContext";
import { VIRTUAL_CASE_LIST_THRESHOLD } from "../constants/virtualCaseList";
import { flexFillScroll, browseColumnNoSelect } from "../utils/layoutClasses";
import {
  buildReleaseTree,
  collectExpandKeysForTicket,
  resolveReleaseTicketBadgeCount,
  sortReleaseTreeWithPins,
} from "../utils/releaseTree";
import ReleaseTreeRow from "./ReleaseTreeRow";
import ReleaseTicketRow from "./ReleaseTicketRow";
import VirtualCaseList from "./VirtualCaseList";
import InlineRenameInput from "./InlineRenameInput";
import ContextMenu from "./ContextMenu";
import {
  sidebarTreeEmptyBlockClass,
  sidebarTreePlaceholderClass,
  getTreePaddingLeft,
  TREE_ROW_CONTENT_GAP,
  TreeRowGuides,
} from "./SidebarSection";

function ReleaseNavigatorTreeInner({
  projects = [],
  releasesByProject = {},
  getReleaseTickets,
  selectedPath = null,
  selectedTicketPath = null,
  selectedTicketReleaseId = null,
  expanded,
  onToggleExpand,
  onSelectPath,
  onSelectTicket,
  isProjectLoading,
  isReleaseLoading,
  emptyMessage = "No ticket projects yet.",
  pinningEnabled = false,
  pinnedPathSet = null,
  isPinnedRelease = null,
  onTogglePinRelease = null,
  creatingReleaseInProject = null,
  createError = "",
  onStartCreateRelease = null,
  onCommitCreateRelease = null,
  onCancelCreateRelease = null,
  openedProjectName = null,
  onOpenProject = null,
  onCloseOpenedProject = null,
  openedReleasePath = null,
  onOpenRelease = null,
  onCloseOpenedRelease = null,
  onCreateTicketUnderRelease = null,
}) {
  const registry = useVirtualCaseListRegistry();
  const scrollIntentRef = useRef(null);
  const lastRevealSignatureRef = useRef(null);
  const lastScrolledSignatureRef = useRef(null);
  const ticketRowRefs = useRef(new Map());
  const [contextMenu, setContextMenu] = useState(null);

  const tree = useMemo(() => {
    const built = buildReleaseTree(projects, releasesByProject);
    if (pinningEnabled && pinnedPathSet?.size) {
      return sortReleaseTreeWithPins(built, pinnedPathSet);
    }
    return built;
  }, [projects, releasesByProject, pinningEnabled, pinnedPathSet]);

  const registerTicketRowRef = useCallback((filePath, el) => {
    if (!filePath) return;
    if (el) ticketRowRefs.current.set(filePath, el);
    else ticketRowRefs.current.delete(filePath);
  }, []);

  useEffect(() => {
    if (!selectedTicketPath && !selectedTicketReleaseId) {
      lastRevealSignatureRef.current = null;
      scrollIntentRef.current = null;
      return;
    }
    scrollIntentRef.current = "selection";
    const needed = collectExpandKeysForTicket(
      tree,
      selectedTicketPath,
      selectedTicketReleaseId,
    );
    if (needed.size === 0) return;
    const signature = `${selectedTicketPath || ""}\0${selectedTicketReleaseId || ""}\0${[...needed].sort().join("\0")}`;
    if (lastRevealSignatureRef.current === signature) return;
    lastRevealSignatureRef.current = signature;
    for (const key of needed) {
      if (expanded.has(key)) continue;
      onToggleExpand(key, { expandOnly: true });
    }
  }, [
    selectedTicketPath,
    selectedTicketReleaseId,
    tree,
    expanded,
    onToggleExpand,
  ]);

  useLayoutEffect(() => {
    if (scrollIntentRef.current !== "selection" || !selectedTicketPath) return;

    const needed = collectExpandKeysForTicket(
      tree,
      selectedTicketPath,
      selectedTicketReleaseId,
    );
    const ancestorsReady = needed.size === 0 || [...needed].every((k) => expanded.has(k));
    if (!ancestorsReady) return;

    const signature = `${selectedTicketPath}\0${[...needed].sort().join("\0")}`;
    if (lastScrolledSignatureRef.current === signature) {
      scrollIntentRef.current = null;
      return;
    }

    const loc = findTicketInTree(tree, selectedTicketPath, getReleaseTickets);
    if (loc?.listId) {
      if (loc && loc.ticketCount >= VIRTUAL_CASE_LIST_THRESHOLD) {
        registry?.scrollToIndexInList(loc.listId, loc.index, { align: "auto", behavior: "auto" });
        lastScrolledSignatureRef.current = signature;
        scrollIntentRef.current = null;
        return;
      }
    }

    const el = ticketRowRefs.current.get(selectedTicketPath);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "auto" });
      lastScrolledSignatureRef.current = signature;
    }
    scrollIntentRef.current = null;
  }, [selectedTicketPath, selectedTicketReleaseId, tree, expanded, registry, getReleaseTickets]);

  const handleProjectContextMenu = useCallback((e, node) => {
    if (!node?.is_project) return;
    if (!onStartCreateRelease && !onOpenProject) return;
    setContextMenu({
      kind: "project",
      x: e.clientX,
      y: e.clientY,
      projectName: node.project_name || node.name,
    });
  }, [onStartCreateRelease, onOpenProject]);

  const handleReleaseContextMenu = useCallback((e, node) => {
    if (!node?.is_release) return;
    if (!onOpenRelease && !onCreateTicketUnderRelease) return;
    setContextMenu({
      kind: "release",
      x: e.clientX,
      y: e.clientY,
      releasePath: node.directory_path,
      releaseNode: node,
    });
  }, [onOpenRelease, onCreateTicketUnderRelease]);

  const contextMenuItems = useMemo(() => {
    if (contextMenu?.kind === "release") {
      const items = [];
      const isFocused =
        openedReleasePath && openedReleasePath === contextMenu.releasePath;
      if (onOpenRelease && !isFocused) {
        items.push({
          icon: Rocket,
          label: "Open Release",
          hint: "Double-click",
          onClick: () => {
            onOpenRelease(contextMenu.releaseNode);
          },
        });
      }
      if (onCreateTicketUnderRelease) {
        items.push({
          icon: FilePlus2,
          label: "New ticket",
          onClick: () => {
            onCreateTicketUnderRelease(contextMenu.releaseNode);
          },
        });
      }
      return items;
    }
    if (!contextMenu?.projectName) return [];
    const items = [];
    if (onOpenProject && openedProjectName !== contextMenu.projectName) {
      items.push({
        icon: FolderOpen,
        label: "Open Project",
        hint: "Double-click",
        onClick: () => {
          onOpenProject(contextMenu.projectName);
        },
      });
    }
    if (onStartCreateRelease) {
      items.push({
        icon: FilePlus2,
        label: "Add release",
        onClick: () => {
          onStartCreateRelease(contextMenu.projectName);
        },
      });
    }
    return items;
  }, [
    contextMenu,
    onStartCreateRelease,
    onOpenProject,
    openedProjectName,
    onOpenRelease,
    openedReleasePath,
    onCreateTicketUnderRelease,
  ]);

  if (!tree.length) {
    return <div className={sidebarTreeEmptyBlockClass}>{emptyMessage}</div>;
  }

  return (
    <TreeAreaHoverProvider>
      <TreeScrollContainer
        className={`${flexFillScroll} ${browseColumnNoSelect} min-h-0 flex-1 pl-0 pr-1 pt-0 pb-2`}
      >
        <ul className="space-y-0">
          {tree.map((projectNode) => (
            <ProjectTreeBranch
              key={projectNode.directory_path}
              projectNode={projectNode}
              level={0}
              expanded={expanded}
              selectedPath={selectedPath}
              selectedTicketPath={selectedTicketPath}
              onToggleExpand={onToggleExpand}
              onSelectPath={onSelectPath}
              onSelectTicket={onSelectTicket}
              getReleaseTickets={getReleaseTickets}
              isProjectLoading={isProjectLoading}
              isReleaseLoading={isReleaseLoading}
              childrenLoaded={Boolean(projectNode.children_loaded)}
              registerTicketRowRef={registerTicketRowRef}
              pinningEnabled={pinningEnabled}
              isPinnedRelease={isPinnedRelease}
              onTogglePinRelease={onTogglePinRelease}
              onProjectContextMenu={
                onStartCreateRelease || onOpenProject ? handleProjectContextMenu : null
              }
              onReleaseContextMenu={
                onOpenRelease || onCreateTicketUnderRelease
                  ? handleReleaseContextMenu
                  : null
              }
              onOpenProject={onOpenProject}
              openedProjectName={openedProjectName}
              onCloseOpenedProject={onCloseOpenedProject}
              openedReleasePath={openedReleasePath}
              onOpenRelease={onOpenRelease}
              onCloseOpenedRelease={onCloseOpenedRelease}
              creatingReleaseInProject={creatingReleaseInProject}
              createError={createError}
              onCommitCreateRelease={onCommitCreateRelease}
              onCancelCreateRelease={onCancelCreateRelease}
            />
          ))}
        </ul>
        <ContextMenu
          open={Boolean(contextMenu) && contextMenuItems.length > 0}
          x={contextMenu?.x ?? 0}
          y={contextMenu?.y ?? 0}
          onClose={() => setContextMenu(null)}
          items={contextMenuItems}
        />
      </TreeScrollContainer>
    </TreeAreaHoverProvider>
  );
}

function findTicketInTree(tree, ticketFilePath, getReleaseTickets) {
  for (const project of tree) {
    for (const release of project.children ?? []) {
      const tickets = getTicketsForRelease(release, getReleaseTickets);
      const idx = tickets.findIndex((t) => t.file_path === ticketFilePath);
      if (idx >= 0) {
        return {
          listId: release.directory_path,
          index: idx,
          ticketCount: tickets.length,
        };
      }
    }
  }
  return null;
}

function getTicketsForRelease(releaseNode, getReleaseTickets) {
  if (getReleaseTickets && releaseNode.release_id) {
    const window = getReleaseTickets(releaseNode.release_id);
    if (window?.items?.length) return window.items;
  }
  return releaseNode.tickets ?? [];
}

function ProjectTreeBranch({
  projectNode,
  level,
  expanded,
  selectedPath,
  selectedTicketPath,
  onToggleExpand,
  onSelectPath,
  onSelectTicket,
  getReleaseTickets,
  isProjectLoading,
  isReleaseLoading,
  childrenLoaded = false,
  registerTicketRowRef,
  pinningEnabled = false,
  isPinnedRelease = null,
  onTogglePinRelease = null,
  onProjectContextMenu = null,
  onReleaseContextMenu = null,
  onOpenProject = null,
  openedProjectName = null,
  onCloseOpenedProject = null,
  openedReleasePath = null,
  onOpenRelease = null,
  onCloseOpenedRelease = null,
  creatingReleaseInProject = null,
  createError = "",
  onCommitCreateRelease = null,
  onCancelCreateRelease = null,
}) {
  const releaseFocus = Boolean(openedReleasePath);
  const isProjectExpanded = releaseFocus || expanded.has(projectNode.directory_path);
  const projectSelected = selectedPath === projectNode.directory_path && !selectedTicketPath;
  const loading = isProjectLoading?.(projectNode.project_name);
  const isCreatingHere = creatingReleaseInProject === projectNode.project_name;
  const showCreateRow = isProjectExpanded && isCreatingHere && !releaseFocus;
  const showProjectBackControl =
    !releaseFocus &&
    Boolean(openedProjectName) &&
    projectNode.project_name === openedProjectName &&
    Boolean(onCloseOpenedProject);

  const releaseChildren = useMemo(() => {
    const children = projectNode.children ?? [];
    if (!openedReleasePath) return children;
    return children.filter((r) => r.directory_path === openedReleasePath);
  }, [projectNode.children, openedReleasePath]);

  const showChildren =
    showCreateRow ||
    (isProjectExpanded && !childrenLoaded) ||
    (isProjectExpanded && childrenLoaded);

  return (
    <li className="min-w-0">
      {!releaseFocus ? (
        <ReleaseTreeRow
          node={projectNode}
          level={level}
          isExpanded={isProjectExpanded}
          isSelected={projectSelected || selectedPath === projectNode.directory_path}
          onSelect={onSelectPath}
          onToggle={onToggleExpand}
          onContextMenu={onProjectContextMenu}
          onDoubleClick={
            onOpenProject
              ? (n) => {
                  const name = n?.project_name || n?.name;
                  if (name && name !== openedProjectName) onOpenProject(name);
                }
              : null
          }
          showBackControl={showProjectBackControl}
          onBack={onCloseOpenedProject}
          pinningEnabled={pinningEnabled}
          isPinned={Boolean(isPinnedRelease?.(projectNode.directory_path))}
          onTogglePin={onTogglePinRelease}
        />
      ) : null}
      {showChildren ? (
        <ul className="space-y-0">
          {showCreateRow && (
            <li>
              <div className="flex min-w-0 flex-col">
                <div className="flex min-w-0">
                  <TreeRowGuides level={level + 1} />
                  <div
                    className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5"
                    style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Rocket className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" aria-hidden />
                      <InlineRenameInput
                        initialValue=""
                        placeholder="Release filename…"
                        onCommit={(val) => {
                          if (!val) {
                            onCancelCreateRelease?.();
                            return;
                          }
                          void onCommitCreateRelease?.(projectNode.project_name, val);
                        }}
                      />
                    </div>
                    {createError ? (
                      <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                        {createError}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          )}
          {isProjectExpanded && !childrenLoaded && !showCreateRow && (
            <li
              className={`${sidebarTreePlaceholderClass} text-center`}
              style={{ paddingLeft: `${getTreePaddingLeft(level + 1) + TREE_ROW_CONTENT_GAP}px` }}
            >
              Loading…
            </li>
          )}
          {isProjectExpanded &&
            childrenLoaded &&
            releaseChildren.map((releaseNode) => (
              <ReleaseTreeBranch
                key={releaseNode.directory_path}
                releaseNode={releaseNode}
                level={releaseFocus ? 0 : level + 1}
                expanded={expanded}
                selectedPath={selectedPath}
                selectedTicketPath={selectedTicketPath}
                onToggleExpand={onToggleExpand}
                onSelectPath={onSelectPath}
                onSelectTicket={onSelectTicket}
                getReleaseTickets={getReleaseTickets}
                isReleaseLoading={isReleaseLoading}
                registerTicketRowRef={registerTicketRowRef}
                pinningEnabled={pinningEnabled && !releaseFocus}
                isPinnedRelease={isPinnedRelease}
                onTogglePinRelease={onTogglePinRelease}
                onReleaseContextMenu={onReleaseContextMenu}
                openedReleasePath={openedReleasePath}
                onOpenRelease={onOpenRelease}
                onCloseOpenedRelease={onCloseOpenedRelease}
              />
            ))}
          {isProjectExpanded &&
            childrenLoaded &&
            !loading &&
            !showCreateRow &&
            releaseChildren.length === 0 && (
              <li>
                <p className="py-1 pl-10 text-[11px] text-slate-400">No releases in this project.</p>
              </li>
            )}
        </ul>
      ) : null}
    </li>
  );
}

function ReleaseTreeBranch({
  releaseNode,
  level,
  expanded,
  selectedPath,
  selectedTicketPath,
  onToggleExpand,
  onSelectPath,
  onSelectTicket,
  getReleaseTickets,
  isReleaseLoading,
  registerTicketRowRef,
  pinningEnabled = false,
  isPinnedRelease = null,
  onTogglePinRelease = null,
  onReleaseContextMenu = null,
  openedReleasePath = null,
  onOpenRelease = null,
  onCloseOpenedRelease = null,
}) {
  const releaseFocus = Boolean(openedReleasePath) && openedReleasePath === releaseNode.directory_path;
  const isReleaseExpanded = releaseFocus || expanded.has(releaseNode.directory_path);
  const releaseSelected = selectedPath === releaseNode.directory_path && !selectedTicketPath;
  const ticketWindow = getReleaseTickets?.(releaseNode.release_id);
  const ticketsKnownLoaded = ticketWindow != null;
  const tickets = ticketWindow?.items ?? [];
  const badgeCount = resolveReleaseTicketBadgeCount(releaseNode.ticket_count, ticketWindow);
  const loading = isReleaseLoading?.(releaseNode.release_id);
  const showBackControl = releaseFocus && Boolean(onCloseOpenedRelease);

  const showTicketChildren =
    isReleaseExpanded &&
    (((!ticketsKnownLoaded || loading) && tickets.length === 0) ||
      (ticketsKnownLoaded && !loading && tickets.length === 0) ||
      tickets.length > 0);

  return (
    <li className="min-w-0">
      <ReleaseTreeRow
        node={releaseNode}
        level={level}
        isExpanded={isReleaseExpanded}
        isSelected={releaseSelected || selectedPath === releaseNode.directory_path}
        onSelect={onSelectPath}
        onToggle={onToggleExpand}
        onContextMenu={onReleaseContextMenu}
        onDoubleClick={
          onOpenRelease
            ? (n) => {
                if (n?.directory_path && n.directory_path !== openedReleasePath) {
                  onOpenRelease(n);
                }
              }
            : null
        }
        showBackControl={showBackControl}
        onBack={onCloseOpenedRelease}
        backTooltip={showBackControl ? "Back to project" : undefined}
        pinningEnabled={pinningEnabled}
        isPinned={Boolean(isPinnedRelease?.(releaseNode.directory_path))}
        onTogglePin={onTogglePinRelease}
        ticketCount={badgeCount}
      />
      {showTicketChildren ? (
        <ul className="space-y-0">
          {(!ticketsKnownLoaded || loading) && tickets.length === 0 && (
            <li
              className={`${sidebarTreePlaceholderClass} text-center`}
              style={{ paddingLeft: `${getTreePaddingLeft(level + 1) + TREE_ROW_CONTENT_GAP}px` }}
            >
              Loading…
            </li>
          )}
          {ticketsKnownLoaded && !loading && tickets.length === 0 && (
            <li>
              <p className="py-1 pl-14 text-[11px] text-slate-400">No tickets linked to this release.</p>
            </li>
          )}
          {tickets.length > 0 && (
            <VirtualCaseList
              cases={tickets}
              listId={releaseNode.directory_path}
              renderRow={(ticket, _index, { virtual }) => {
                const isSelected = selectedTicketPath === ticket.file_path;
                const useDomRef = tickets.length < VIRTUAL_CASE_LIST_THRESHOLD;
                return (
                  <ReleaseTicketRow
                    key={ticket.file_path ?? ticket.ticket_id}
                    as={virtual ? "div" : "li"}
                    ticket={ticket}
                    effectiveLevel={level}
                    isSelected={isSelected}
                    onSelect={onSelectTicket}
                    rowRef={useDomRef ? (el) => registerTicketRowRef(ticket.file_path, el) : undefined}
                  />
                );
              }}
            />
          )}
        </ul>
      ) : null}
    </li>
  );
}

function ReleaseNavigatorTree(props) {
  return (
    <VirtualCaseListRegistryProvider>
      <ReleaseNavigatorTreeInner {...props} />
    </VirtualCaseListRegistryProvider>
  );
}

export default ReleaseNavigatorTree;
