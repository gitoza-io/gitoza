import DetailPanel from "./DetailPanel";
import { PipelineIcon } from "./TestEntityIcons";

function MetaRow({ label, value, href }) {
  if (value == null || value === "") return null;
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="min-w-0 break-all text-slate-800 dark:text-slate-100">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline dark:text-blue-400"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function AutomationPipelineSummaryPanel({
  pipeline,
  executions = [],
  loadingExecutions = false,
}) {
  if (!pipeline) {
    return (
      <DetailPanel>
        <div className="p-4 text-sm text-slate-500">Pipeline not found</div>
      </DetailPanel>
    );
  }

  const name = pipeline.pipeline_name;
  const latest = executions[0] ?? null;

  return (
    <DetailPanel
      header={
        <div className="flex min-w-0 items-center gap-2">
          <PipelineIcon />
          <h2 className="truncate text-lg font-semibold">{name}</h2>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <dl className="space-y-2">
          <MetaRow label="Runs indexed" value={String(pipeline.execution_count ?? 0)} />
          <MetaRow
            label="Runs with failures"
            value={String(pipeline.failed_count ?? 0)}
          />
          <MetaRow label="Last finished" value={pipeline.last_finished_at} />
        </dl>

        {loadingExecutions && (
          <p className="text-sm text-slate-500">Loading runs for this pipeline…</p>
        )}

        {!loadingExecutions && latest && (
          <div className="rounded-ui border border-slate-200 p-3 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Latest run
            </h3>
            <dl className="mt-2 space-y-2">
              <MetaRow label="Build" value={latest.build_id} />
              <MetaRow label="Branch" value={latest.branch} />
              <MetaRow
                label="Commit"
                value={
                  latest.commit_sha
                    ? latest.commit_sha.length > 12
                      ? latest.commit_sha.slice(0, 12)
                      : latest.commit_sha
                    : null
                }
              />
              <MetaRow label="Finished" value={latest.finished_at} />
              <MetaRow
                label="JUnit files"
                value={String(latest.junit_file_count ?? 0)}
              />
              <MetaRow
                label="Tests"
                value={`${latest.passed ?? 0} passed · ${(latest.failed ?? 0) + (latest.error ?? 0)} failed · ${latest.total ?? 0} total`}
              />
            </dl>
          </div>
        )}

        {!loadingExecutions && executions.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Runs in this pipeline
            </h3>
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Build</th>
                    <th className="px-2 py-1.5 font-medium">Branch</th>
                    <th className="px-2 py-1.5 font-medium">Commit</th>
                    <th className="px-2 py-1.5 font-medium">JUnit</th>
                    <th className="px-2 py-1.5 font-medium">Tests</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.map((exec) => (
                    <tr
                      key={exec.execution_id}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-2 py-1.5 font-mono">#{exec.build_id}</td>
                      <td className="px-2 py-1.5">{exec.branch || "—"}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {exec.commit_sha ? exec.commit_sha.slice(0, 7) : "—"}
                      </td>
                      <td className="px-2 py-1.5">{exec.junit_file_count}</td>
                      <td className="px-2 py-1.5">{exec.total}</td>
                      <td className="px-2 py-1.5">{exec.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loadingExecutions && executions.length === 0 && (
          <p className="text-sm text-slate-500">
            No runs loaded yet. Expand this pipeline in the sidebar or click Load from storage
            after CI upload.
          </p>
        )}
      </div>
    </DetailPanel>
  );
}

export default AutomationPipelineSummaryPanel;
