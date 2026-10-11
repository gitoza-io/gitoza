import {
  sidebarTreePlaceholderClass,
  getTreePaddingLeft,
  TreeRowGuides,
  TREE_ROW_CONTENT_GAP,
  treeRowSelectedFullWidthClass,
  treeRowHoverFullWidthClass,
} from "./SidebarSection";
import InlineRenameInput from "./InlineRenameInput";
import SidebarRow from "./SidebarRow";
import RunStatusBadge from "./RunStatusBadge";
import { TestRunIcon } from "./TestEntityIcons";
import RunCaseTree from "./RunCaseTree";
import { flattenRunCasePathsInDisplayOrder } from "../utils/runCaseTree";

/**
 * Left tree for Test Run main view: runs as top-level rows, expand to show cases by project/suite (same structure as Test Repository).
 * Click case → onSelectCase(runId, case). Optional runRowRight (e.g. approve/reject) and onSelectRun for Review.
 */
function RunListTree({
  runs = [],
  expandedRunIds = new Set(),
  onToggleRun,
  runDetailsByRunId = {},
  onLoadRunDetail,
  selectedRunId = null,
  selectedCaseId = null,
  onSelectCase,
  onSelectRun,
  onContextMenuRun,
  onSetResult,
  onContextMenuCase,
  selectedRunCasePathsByRunId = {},
  onSelectedRunCasePathsChange,
  /** "buttons" | "icon" — forwarded to RunCaseTree (Review uses "icon"). */
  caseResultMode = "buttons",
  runRowRight,
  renamingRunId = null,
  onRenameRunCommit,
  onRenameRunCancel,
  /** When true, show inline "new run" row at top. onCommitCreateRun(name) on commit, or null on cancel. */
  creatingRun = false,
  onCommitCreateRun,
  /** When true, each run's case tree expands all project/suite nodes (toolbar "Expand all"). */
  forceExpandAllInner = false,
  /** Custom message shown when runs list is empty (e.g. "No matching runs." in search). */
  emptyMessage = "No test runs yet.",
}) {
  return (
    <ul className="space-y-0">
      {creatingRun && onCommitCreateRun && (
        <li>
          <div className="flex min-w-0 w-full items-center gap-2 rounded py-1.5" style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}>
            <TreeRowGuides level={0} />
            <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}>
              <TestRunIcon className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400" />
              <InlineRenameInput
                initialValue=""
                placeholder="Run name…"
                onCommit={onCommitCreateRun}
              />
            </div>
          </div>
        </li>
      )}
      {!runs?.length && !creatingRun && (
        <li>
          <div className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {emptyMessage}
          </div>
        </li>
      )}
      {runs.map((run) => {
        const isExpanded = expandedRunIds.has(run.run_id);
        const detail = runDetailsByRunId[run.run_id];
        const cases = detail?.cases ?? [];
        const isLoading = isExpanded && detail === undefined && onLoadRunDetail != null;
        const selectedPathsForRun = selectedRunCasePathsByRunId?.[run.run_id] ?? new Set();
        const orderedPathsForRun = flattenRunCasePathsInDisplayOrder(cases);

        const isRunRowSelected = selectedRunId === run.run_id && selectedCaseId == null;
        return (
          <li key={run.run_id}>
            <div className={`sticky top-0 z-20 flex min-w-0 w-full ${isRunRowSelected ? treeRowSelectedFullWidthClass : `${treeRowHoverFullWidthClass} bg-white dark:bg-slate-950`}`}>
              <TreeRowGuides level={0} />
              <div className="min-w-0 flex-1" style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}>
                <SidebarRow
                  selected={isRunRowSelected}
                  selectionOnParent
                  expandIcon={isExpanded ? "open" : "closed"}
                  icon={<TestRunIcon />}
                  label={
                    <div className="min-w-0">
                      {renamingRunId === run.run_id ? (
                        <InlineRenameInput
                          initialValue={(detail?.run?.name ?? run.name) || ""}
                          placeholder="Run name…"
                          onCommit={(val) => {
                            if (val != null) onRenameRunCommit?.(run.run_id, val);
                            else onRenameRunCancel?.();
                          }}
                        />
                      ) : (
                        <div className="truncate font-medium">{(detail?.run?.name ?? run.name) || "Unnamed run"}</div>
                      )}
                      {renamingRunId !== run.run_id && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 truncate text-sm text-slate-600 dark:text-slate-400">
                          <span>
                            {(detail?.run?.total_cases ?? run.total_cases) ?? 0} cases ·{" "}
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">
                              {(detail?.run?.passed ?? run.passed) ?? 0} passed
                            </span>
                            {", "}
                            <span
                              className={
                                ((detail?.run?.failed ?? run.failed) ?? 0) > 0
                                  ? "font-semibold text-red-600 dark:text-red-400"
                                  : "font-medium text-slate-700 dark:text-slate-400"
                              }
                            >
                              {(detail?.run?.failed ?? run.failed) ?? 0} failed
                            </span>
                          </span>
                          <RunStatusBadge status={detail?.run?.status ?? run.status} />
                        </div>
                      )}
                    </div>
                  }
                  right={typeof runRowRight === "function" ? runRowRight(run) : runRowRight}
                  onClick={() => {
                    onToggleRun?.(run.run_id);
                    onSelectRun?.(run);
                  }}
                  onContextMenu={(e) => { e.preventDefault(); onContextMenuRun?.(run, e); }}
                />
              </div>
            </div>

            {isExpanded && (
              <ul className="space-y-0">
                {isLoading ? (
                  <li className={`${sidebarTreePlaceholderClass} text-center`} style={{ paddingLeft: `${getTreePaddingLeft(1) + TREE_ROW_CONTENT_GAP}px` }}>Loading…</li>
                ) : !cases.length ? (
                  <li className={sidebarTreePlaceholderClass} style={{ paddingLeft: `${getTreePaddingLeft(1) + TREE_ROW_CONTENT_GAP}px` }}>No cases</li>
                ) : (
                  <li>
                    <RunCaseTree
                      runCases={cases}
                      selectedCaseId={selectedRunId === run.run_id ? selectedCaseId : null}
                      onSelectCase={(c) => onSelectCase?.(run.run_id, c)}
                      onSetResult={onSetResult ? (filePath, result) => onSetResult(run.run_id, filePath, result) : undefined}
                      onContextMenuCase={onContextMenuCase ? (c, e) => onContextMenuCase(run.run_id, c, e) : undefined}
                      caseResultMode={caseResultMode}
                      baseLevel={1}
                      forceExpandAll={forceExpandAllInner}
                      selectedPaths={selectedPathsForRun}
                      orderedPaths={orderedPathsForRun}
                      onSelectedPathsChange={(next) => onSelectedRunCasePathsChange?.(run.run_id, next)}
                    />
                  </li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default RunListTree;
