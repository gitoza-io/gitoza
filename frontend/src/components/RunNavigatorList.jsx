import {
  TreeRowGuides,
  TREE_ROW_CONTENT_GAP,
  treeRowSelectedFullWidthClass,
  treeRowHoverFullWidthClass,
} from "./SidebarSection";
import InlineRenameInput from "./InlineRenameInput";
import SidebarRow from "./SidebarRow";
import RunStatusBadge from "./RunStatusBadge";
import { TestRunIcon } from "./TestEntityIcons";

/**
 * Runs-only navigator for Test Run / Review column 1 (no nested case tree).
 */
function RunNavigatorList({
  runs = [],
  runDetailsByRunId = {},
  selectedRunId = null,
  selectedCaseId = null,
  onSelectRun,
  onContextMenuRun,
  runRowRight,
  renamingRunId = null,
  onRenameRunCommit,
  onRenameRunCancel,
  creatingRun = false,
  onCommitCreateRun,
  emptyMessage = "No test runs yet.",
  compact = false,
}) {
  return (
    <ul className="space-y-0">
      {creatingRun && onCommitCreateRun && (
        <li>
          <div
            className="flex min-w-0 w-full items-center gap-2 rounded py-1.5"
            style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}
          >
            <TreeRowGuides level={0} />
            <div
              className="flex min-w-0 flex-1 items-center gap-2"
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
        const detail = runDetailsByRunId[run.run_id];
        const isRunRowSelected = selectedRunId === run.run_id && selectedCaseId == null;
        return (
          <li key={run.run_id}>
            <div
              className={`flex min-w-0 w-full ${
                compact ? "" : "sticky top-0 z-20"
              } ${isRunRowSelected ? treeRowSelectedFullWidthClass : `${treeRowHoverFullWidthClass} bg-white dark:bg-slate-950`}`}
            >
              <TreeRowGuides level={0} />
              <div className="min-w-0 flex-1" style={{ paddingLeft: `${TREE_ROW_CONTENT_GAP}px` }}>
                <SidebarRow
                  selected={isRunRowSelected}
                  selectionOnParent
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
                        <div className="truncate font-medium">
                          {(detail?.run?.name ?? run.name) || "Unnamed run"}
                        </div>
                      )}
                      {renamingRunId !== run.run_id && !compact && (
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
                  onClick={() => onSelectRun?.(run)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenuRun?.(run, e);
                  }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default RunNavigatorList;
