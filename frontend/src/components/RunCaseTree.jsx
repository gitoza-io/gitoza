import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, ChevronRight } from "lucide-react";
import { buildRunCaseTree, buildRunCaseLocationMap, collectRunCaseExpandKeys } from "../utils/runCaseTree";
import { VirtualCaseListRegistryProvider, useVirtualCaseListRegistry } from "../contexts/VirtualCaseListRegistryContext";
import RunCaseTreeCaseRow from "./RunCaseTreeCaseRow";
import VirtualCaseList from "./VirtualCaseList";
import { CaseResultRight } from "./CaseResultButtons";
import { sidebarTreeEmptyBlockClass, TreeRowGuides, TREE_ROW_CONTENT_GAP, treeRowHoverFullWidthClass } from "./SidebarSection";
import { VIRTUAL_CASE_LIST_THRESHOLD } from "../constants/virtualCaseList";

function collectExpandKeysForSelectedCase(nodes, selectedCaseId) {
  if (!Array.isArray(nodes) || !selectedCaseId) return new Set();
  const out = new Set();

  const visit = (node) => {
    if (!node) return false;
    const cases = Array.isArray(node.cases) ? node.cases : [];
    const children = Array.isArray(node.children) ? node.children : [];

    const hasDirect = cases.some((c) => (c?.file_path ?? null) === selectedCaseId);
    const hasInChild = children.some((ch) => visit(ch));

    if (hasDirect || hasInChild) {
      if (node.key) out.add(node.key);
      return true;
    }
    return false;
  };

  for (const n of nodes) visit(n);
  return out;
}

/**
 * Left tree for Test Run: project → suite → case (cases in current run only).
 * Click case → onSelectCase(case). Shows Pass/Fail/Skip buttons per case.
 * baseLevel: add to level for indent when nested under a run row (e.g. baseLevel={1}).
 */
function RunCaseTree(props) {
  return (
    <VirtualCaseListRegistryProvider>
      <RunCaseTreeInner {...props} />
    </VirtualCaseListRegistryProvider>
  );
}

function RunCaseTreeInner({
  runCases = [],
  selectedCaseId = null,
  onSelectCase,
  onSetResult,
  onContextMenuCase,
  baseLevel = 0,
  /** "buttons" = Pass/Fail/Skip when onSetResult set (default). "icon" = single read-only result icon. */
  caseResultMode = "buttons",
  /** When true, expand all project/suite nodes (used with toolbar "Expand all"). */
  forceExpandAll = false,
  /** Modifier-key multi-select for bulk actions (remove from run). */
  selectedPaths = null,
  onSelectedPathsChange,
  orderedPaths = null,
}) {
  const registry = useVirtualCaseListRegistry();
  const [expanded, setExpanded] = useState(() => new Set());
  const tree = useMemo(() => buildRunCaseTree(runCases), [runCases]);
  const allExpandKeys = useMemo(() => collectRunCaseExpandKeys(tree), [tree]);
  const caseLocationMap = useMemo(() => buildRunCaseLocationMap(tree), [tree]);
  const selectionAnchorRef = useRef(null);
  const scrollIntentRef = useRef(null);
  const lastRevealSignatureRef = useRef(null);
  const lastScrolledSignatureRef = useRef(null);
  const caseRowRefs = useRef(new Map());
  const registerCaseRowRef = useCallback((filePath, el) => {
    if (!filePath) return;
    if (el) caseRowRefs.current.set(filePath, el);
    else caseRowRefs.current.delete(filePath);
  }, []);
  const multiSelectActive =
    selectedPaths instanceof Set &&
    typeof onSelectedPathsChange === "function" &&
    Array.isArray(orderedPaths);

  useEffect(() => {
    if (!forceExpandAll || allExpandKeys.size === 0) return;
    setExpanded(allExpandKeys);
  }, [forceExpandAll, allExpandKeys]);

  useEffect(() => {
    if (forceExpandAll) return;
    if (!selectedCaseId) {
      lastRevealSignatureRef.current = null;
      scrollIntentRef.current = null;
      return;
    }
    scrollIntentRef.current = "selection";

    const needed = collectExpandKeysForSelectedCase(tree, selectedCaseId);
    if (needed.size === 0) return;

    const signature = `${selectedCaseId}\0${[...needed].sort().join("\0")}`;
    if (lastRevealSignatureRef.current === signature) return;
    lastRevealSignatureRef.current = signature;

    setExpanded((prev) => new Set([...prev, ...needed]));
  }, [forceExpandAll, selectedCaseId, tree]);

  useLayoutEffect(() => {
    if (scrollIntentRef.current !== "selection") return;

    if (!selectedCaseId) {
      lastScrolledSignatureRef.current = null;
      scrollIntentRef.current = null;
      return;
    }
    const needed = collectExpandKeysForSelectedCase(tree, selectedCaseId);
    const ancestorsReady =
      forceExpandAll || needed.size === 0 || [...needed].every((k) => expanded.has(k));
    if (!ancestorsReady) return;

    const signature = `${selectedCaseId}\0${[...needed].sort().join("\0")}`;
    if (lastScrolledSignatureRef.current === signature) {
      scrollIntentRef.current = null;
      return;
    }

    const loc = caseLocationMap.get(selectedCaseId);
    if (loc && loc.listCaseCount >= VIRTUAL_CASE_LIST_THRESHOLD) {
      registry?.scrollToIndexInList(loc.listId, loc.index, { align: "auto", behavior: "auto" });
      lastScrolledSignatureRef.current = signature;
      scrollIntentRef.current = null;
      return;
    }

    const el = caseRowRefs.current.get(selectedCaseId);
    if (!el) return;

    lastScrolledSignatureRef.current = signature;
    scrollIntentRef.current = null;
    el.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [forceExpandAll, selectedCaseId, tree, expanded, caseLocationMap, registry]);

  const toggle = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleCaseClick = useCallback(
    (c, e) => {
      if (!multiSelectActive) {
        onSelectCase?.(c);
        return;
      }
      const path = c?.file_path;
      if (!path) return;
      const order = orderedPaths || [];

      if (e.shiftKey && selectionAnchorRef.current && order.length) {
        const i1 = order.indexOf(selectionAnchorRef.current);
        const i2 = order.indexOf(path);
        if (i1 !== -1 && i2 !== -1) {
          const [a, b] = i1 <= i2 ? [i1, i2] : [i2, i1];
          onSelectedPathsChange(new Set(order.slice(a, b + 1)));
          onSelectCase?.(c);
          e.preventDefault();
          return;
        }
      }

      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const next = new Set(selectedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        onSelectedPathsChange(next);
        selectionAnchorRef.current = path;
        onSelectCase?.(c);
        return;
      }

      selectionAnchorRef.current = path;
      onSelectedPathsChange(new Set([path]));
      onSelectCase?.(c);
    },
    [multiSelectActive, orderedPaths, onSelectedPathsChange, onSelectCase, selectedPaths],
  );

  const handleCaseContextMenu = useCallback(
    (c, e) => {
      e.preventDefault();
      if (multiSelectActive) {
        const path = c?.file_path;
        if (path && (!selectedPaths || selectedPaths.size === 0 || !selectedPaths.has(path))) {
          selectionAnchorRef.current = path;
          onSelectedPathsChange(new Set([path]));
        }
      }
      onContextMenuCase?.(c, e);
    },
    [multiSelectActive, onContextMenuCase, onSelectedPathsChange, selectedPaths],
  );

  if (!tree?.length) {
    return (
      <div className={sidebarTreeEmptyBlockClass}>
        No cases in this run.
      </div>
    );
  }

  return (
    <ul className="space-y-0">
      {tree.map((node) => (
        <RunTreeNode
          key={node.key}
          node={node}
          level={0}
          baseLevel={baseLevel}
          expanded={expanded}
          onToggle={toggle}
          selectedCaseId={selectedCaseId}
          multiSelectActive={multiSelectActive}
          selectedPaths={selectedPaths}
          onSelectCase={onSelectCase}
          onSetResult={onSetResult}
          onContextMenuCase={handleCaseContextMenu}
          caseResultMode={caseResultMode}
          onCaseRowClick={handleCaseClick}
          registerCaseRowRef={registerCaseRowRef}
        />
      ))}
    </ul>
  );
}

function RunTreeNode({
  node,
  level,
  baseLevel = 0,
  expanded,
  onToggle,
  selectedCaseId,
  multiSelectActive = false,
  selectedPaths,
  onSelectCase,
  onSetResult,
  onContextMenuCase,
  caseResultMode = "buttons",
  onCaseRowClick,
  registerCaseRowRef,
}) {
  const isProject = node.type === "project";
  const hasChildren = (node.children?.length ?? 0) > 0;
  const hasCases = (node.cases?.length ?? 0) > 0;
  const isExpanded = expanded.has(node.key);
  const gap = TREE_ROW_CONTENT_GAP;
  const effectiveLevel = level + baseLevel;

  const canToggle = hasChildren || hasCases || isProject;

  const handleRowClick = () => {
    if (canToggle) onToggle(node.key);
  };

  const handleRowKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick();
    }
  };

  return (
    <li>
      <div
        role={canToggle ? "button" : undefined}
        tabIndex={canToggle ? 0 : undefined}
        aria-expanded={canToggle ? isExpanded : undefined}
        onClick={canToggle ? handleRowClick : undefined}
        onKeyDown={canToggle ? handleRowKeyDown : undefined}
        className={`flex min-w-0 w-full ${canToggle ? "cursor-pointer" : ""} ${treeRowHoverFullWidthClass}`}
      >
        <TreeRowGuides level={effectiveLevel} />
        <div
          className="flex min-w-0 flex-1 select-none items-center gap-2 rounded pl-1 pr-2 py-1.5 text-left text-sm font-medium text-slate-600 transition dark:text-slate-300"
          style={{ paddingLeft: `${gap}px` }}
        >
          {canToggle ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {isProject ? (
            <Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{node.displayName}</span>
          {!isProject && (node.cases?.length ?? 0) > 0 && (
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {node.cases.length}
            </span>
          )}
        </div>
      </div>

      {(hasChildren || hasCases) && isExpanded && (
        <ul className="space-y-0">
          {(node.children ?? []).map((child) => (
            <RunTreeNode
              key={child.key}
              node={child}
              level={level + 1}
              baseLevel={baseLevel}
              expanded={expanded}
              onToggle={onToggle}
              selectedCaseId={selectedCaseId}
              multiSelectActive={multiSelectActive}
              selectedPaths={selectedPaths}
              onSelectCase={onSelectCase}
              onSetResult={onSetResult}
              onContextMenuCase={onContextMenuCase}
              caseResultMode={caseResultMode}
              onCaseRowClick={onCaseRowClick}
              registerCaseRowRef={registerCaseRowRef}
            />
          ))}
          <VirtualCaseList
            cases={node.cases ?? []}
            listId={node.key}
            renderRow={(c, _index, { virtual }) => {
              const path = c?.file_path ?? null;
              const isSelected = multiSelectActive
                ? Boolean(path && selectedPaths?.has(path))
                : selectedCaseId === c.file_path;
              const useDomRef = (node.cases?.length ?? 0) < VIRTUAL_CASE_LIST_THRESHOLD;
              return (
                <RunCaseTreeCaseRow
                  key={c.file_path ?? c.case_id}
                  as={virtual ? "div" : "li"}
                  caseRow={c}
                  effectiveLevel={effectiveLevel}
                  isSelected={isSelected}
                  multiSelectActive={multiSelectActive}
                  onCaseRowClick={onCaseRowClick}
                  onSelectCase={onSelectCase}
                  onContextMenuCase={onContextMenuCase}
                  rowRef={!virtual && useDomRef ? (el) => registerCaseRowRef?.(path, el) : undefined}
                  resultRight={
                    <CaseResultRight
                      result={c.result}
                      filePath={c.file_path}
                      onSetResult={onSetResult}
                      caseResultMode={caseResultMode}
                    />
                  }
                />
              );
            }}
          />
        </ul>
      )}
    </li>
  );
}

export default RunCaseTree;
