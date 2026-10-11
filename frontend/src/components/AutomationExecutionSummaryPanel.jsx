import DetailPanel from "./DetailPanel";

function AutomationResultSummary({ execution }) {
  if (!execution) return null;
  const { passed = 0, failed = 0, skipped = 0, error = 0, total = 0 } = execution;
  const pending = Math.max(0, total - passed - failed - skipped - error);
  if (total === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="rounded-ui bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
        {passed} passed
      </span>
      <span className="rounded-ui bg-red-100 px-2.5 py-1 text-sm font-semibold text-red-800 dark:bg-red-500/20 dark:text-red-300">
        {failed + error} failed
      </span>
      {skipped > 0 && (
        <span className="rounded-ui bg-amber-100 px-2.5 py-1 text-sm font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
          {skipped} skipped
        </span>
      )}
      {pending > 0 && (
        <span className="rounded-ui bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {pending} other
        </span>
      )}
    </div>
  );
}

function MetaRow({ label, value, href }) {
  if (!value) return null;
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

function AutomationExecutionSummaryPanel({ detail, loading = false }) {
  const execution = detail?.execution;
  const junitFiles = detail?.junit_files ?? [];

  if (loading) {
    return (
      <DetailPanel>
        <div className="p-4 text-sm text-slate-500">Loading execution…</div>
      </DetailPanel>
    );
  }

  if (!execution) {
    return (
      <DetailPanel>
        <div className="p-4 text-sm text-slate-500">Execution not found</div>
      </DetailPanel>
    );
  }

  const title =
    execution.title ||
    `${execution.pipeline_name} #${execution.build_id}`;

  return (
    <DetailPanel header={<h2 className="truncate text-lg font-semibold">{title}</h2>}>
      <div className="space-y-4 p-4">
        <AutomationResultSummary execution={execution} />
        <dl className="space-y-2">
          <MetaRow label="Pipeline" value={execution.pipeline_name} />
          <MetaRow label="Build" value={execution.build_id} />
          <MetaRow label="Branch" value={execution.branch} />
          <MetaRow label="Commit" value={execution.commit_sha} />
          <MetaRow label="Finished" value={execution.finished_at} />
          <MetaRow label="Triggered by" value={execution.triggered_by} />
          <MetaRow label="CI run" value={execution.ci_url ? "Open in CI" : null} href={execution.ci_url} />
          <MetaRow
            label="Duration"
            value={
              execution.duration_sec != null
                ? `${execution.duration_sec.toFixed(1)}s`
                : null
            }
          />
          <MetaRow label="Status" value={execution.status} />
        </dl>

        {junitFiles.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              JUnit files
            </h3>
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">File</th>
                    <th className="px-2 py-1.5 font-medium">Total</th>
                    <th className="px-2 py-1.5 font-medium">Passed</th>
                    <th className="px-2 py-1.5 font-medium">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {junitFiles.map((row) => (
                    <tr
                      key={row.junit_file}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-2 py-1.5 font-mono">{row.junit_file}</td>
                      <td className="px-2 py-1.5">{row.total}</td>
                      <td className="px-2 py-1.5">{row.passed}</td>
                      <td className="px-2 py-1.5">{row.failed + row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}

export default AutomationExecutionSummaryPanel;
