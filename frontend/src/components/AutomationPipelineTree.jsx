import { Box } from "lucide-react";
import {
  TreeRowGuides,
  treeRowHoverFullWidthClass,
  treeRowSelectedFullWidthClass,
} from "./SidebarSection";
import SidebarRow from "./SidebarRow";
import { PipelineIcon, TestRunIcon } from "./TestEntityIcons";

function executionLabel(exec) {
  const parts = [];
  if (exec.build_id) parts.push(`#${exec.build_id}`);
  if (exec.branch) parts.push(exec.branch);
  if (exec.commit_sha) parts.push(exec.commit_sha.slice(0, 7));
  const head = parts.length ? parts.join(" · ") : exec.title || exec.execution_id;
  const stats = `${exec.junit_file_count} JUnit · ${exec.total} tests`;
  const bad = exec.failed + exec.error;
  const tail = bad > 0 ? ` · ${bad} failed` : "";
  return { head, sub: `${stats}${tail}` };
}

function suiteStatsLabel(suite) {
  const parts = [`${suite.total} test${suite.total === 1 ? "" : "s"}`];
  const bad = (suite.failed ?? 0) + (suite.error ?? 0);
  if (bad > 0) parts.push(`${bad} failed`);
  else if ((suite.skipped ?? 0) > 0) parts.push(`${suite.skipped} skipped`);
  return parts.join(" · ");
}

function AutomationPipelineTree({
  pipelines = [],
  executionsByPipeline = {},
  suitesByExecution = {},
  expandedPipelines = {},
  expandedExecutions = {},
  loadingPipelines = false,
  loadingExecutionsFor = null,
  loadingSuitesFor = null,
  selectedPipelineName = null,
  selectedExecutionId = null,
  selectedSuiteKey = null,
  onTogglePipeline,
  onToggleExecution,
  onSelectExecution,
  onSelectSuite,
}) {
  if (loadingPipelines) {
    return (
      <div className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
        Loading pipelines…
      </div>
    );
  }

  if (!pipelines.length) {
    return (
      <div className="px-1 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
        No pipeline results yet. Run CI upload, then click Load from storage.
      </div>
    );
  }

  return (
    <ul className="space-y-0">
      {pipelines.map((pipeline) => {
        const name = pipeline.pipeline_name;
        const expanded = Boolean(expandedPipelines[name]);
        const executions = executionsByPipeline[name] ?? [];
        const loadingExec = loadingExecutionsFor === name;
        const pipelineSelected =
          selectedPipelineName === name && selectedExecutionId == null;

        return (
          <li key={name}>
            <div
              className={`flex min-w-0 w-full sticky top-0 z-10 ${
                pipelineSelected
                  ? treeRowSelectedFullWidthClass
                  : `${treeRowHoverFullWidthClass} bg-white dark:bg-slate-950`
              }`}
            >
              <div className="min-w-0 flex-1 px-1">
                <SidebarRow
                  selected={pipelineSelected}
                  selectionOnParent
                  expandIcon={expanded ? "open" : "closed"}
                  icon={<PipelineIcon />}
                  label={
                    <div className="min-w-0">
                      <div className="truncate font-medium">{name}</div>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {pipeline.execution_count} run
                        {pipeline.execution_count === 1 ? "" : "s"}
                        {pipeline.last_finished_at
                          ? ` · ${pipeline.last_finished_at.slice(0, 10)}`
                          : ""}
                      </p>
                    </div>
                  }
                  onClick={() => onTogglePipeline?.(name)}
                />
              </div>
            </div>

            {expanded && (
              <ul className="space-y-0">
                {loadingExec && (
                  <li className="py-2 pl-5 text-xs text-slate-500">Loading runs…</li>
                )}
                {!loadingExec &&
                  executions.map((exec) => {
                    const { head, sub } = executionLabel(exec);
                    const execExpanded = Boolean(expandedExecutions[exec.execution_id]);
                    const suites = suitesByExecution[exec.execution_id] ?? [];
                    const loadingSuites = loadingSuitesFor === exec.execution_id;
                    const executionSelected =
                      selectedExecutionId === exec.execution_id && selectedSuiteKey == null;

                    return (
                      <li key={exec.execution_id}>
                        <div
                          className={`flex min-w-0 w-full ${
                            executionSelected
                              ? treeRowSelectedFullWidthClass
                              : treeRowHoverFullWidthClass
                          }`}
                        >
                          <TreeRowGuides level={2} />
                          <div className="min-w-0 flex-1 pl-1 pr-1">
                            <SidebarRow
                              selected={executionSelected}
                              selectionOnParent
                              expandIcon={execExpanded ? "open" : "closed"}
                              icon={<TestRunIcon />}
                              label={
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">{head}</div>
                                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                    {sub}
                                  </p>
                                </div>
                              }
                              onClick={() => onToggleExecution?.(name, exec)}
                            />
                          </div>
                        </div>

                        {execExpanded && (
                          <ul className="space-y-0">
                            {loadingSuites && (
                              <li className="py-2 pl-8 text-xs text-slate-500">
                                Loading suites…
                              </li>
                            )}
                            {!loadingSuites &&
                              suites.map((suite) => {
                                const suiteSelected =
                                  selectedExecutionId === exec.execution_id &&
                                  selectedSuiteKey === suite.suite_key;
                                return (
                                  <li key={`${exec.execution_id}:${suite.suite_key}`}>
                                    <div
                                      className={`flex min-w-0 w-full ${
                                        suiteSelected
                                          ? treeRowSelectedFullWidthClass
                                          : treeRowHoverFullWidthClass
                                      }`}
                                    >
                                      <TreeRowGuides level={3} />
                                      <div className="min-w-0 flex-1 pl-1 pr-1">
                                        <SidebarRow
                                          selected={suiteSelected}
                                          selectionOnParent
                                          expandIcon="none"
                                          icon={
                                            <Box className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                          }
                                          label={
                                            <div className="min-w-0">
                                              <div className="truncate text-sm">
                                                {suite.display_name}
                                              </div>
                                              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                                {suiteStatsLabel(suite)}
                                              </p>
                                            </div>
                                          }
                                          onClick={() =>
                                            onSelectSuite?.(name, exec, suite)
                                          }
                                        />
                                      </div>
                                    </div>
                                  </li>
                                );
                              })}
                            {!loadingSuites && suites.length === 0 && (
                              <li className="py-2 pl-8 text-xs text-slate-500">
                                No suites indexed
                              </li>
                            )}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                {!loadingExec && executions.length === 0 && (
                  <li className="py-2 pl-5 text-xs text-slate-500">No executions indexed</li>
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default AutomationPipelineTree;
