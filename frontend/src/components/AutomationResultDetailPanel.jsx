import DetailPanel from "./DetailPanel";
import { CaseResultRight } from "./CaseResultButtons";

function resultLabel(result) {
  const r = (result || "").toLowerCase();
  if (r === "passed") return "Passed";
  if (r === "failed") return "Failed";
  if (r === "error") return "Error";
  if (r === "skipped") return "Skipped";
  return result || "Unknown";
}

function previewToDetail(preview) {
  if (!preview) return null;
  const classname =
    preview.classname ?? preview.case_id ?? preview.caseId ?? null;
  return {
    classname: classname || null,
    name: preview.name || preview.title,
    result: preview.result,
    duration_sec: preview.duration_sec ?? preview.durationSec,
    junit_file: preview.junit_file ?? preview.junitFile,
    failure_message: preview.failure_message ?? preview.failureMessage ?? null,
    failure_body: preview.failure_body ?? preview.failureBody ?? null,
  };
}

function normalizeDetail(detail) {
  if (!detail) return null;
  return {
    ...detail,
    classname: detail.classname ?? detail.className ?? detail.case_id ?? detail.caseId ?? null,
    failure_message: detail.failure_message ?? detail.failureMessage ?? null,
    failure_body: detail.failure_body ?? detail.failureBody ?? null,
    system_out: detail.system_out ?? detail.systemOut ?? null,
    junit_file: detail.junit_file ?? detail.junitFile ?? null,
    duration_sec: detail.duration_sec ?? detail.durationSec ?? null,
  };
}

function mergeDetail(preview, detail) {
  const base = previewToDetail(preview) ?? {};
  return { ...base, ...(normalizeDetail(detail) ?? {}) };
}

function ResultStatusBanner({ result }) {
  const r = (result || "").toLowerCase();
  if (r === "passed") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
        This test completed successfully.
      </div>
    );
  }
  if (r === "skipped") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        This test was skipped.
      </div>
    );
  }
  if (r === "failed" || r === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
        This test did not pass. See the failure details below.
      </div>
    );
  }
  return null;
}

function AutomationResultDetailPanel({
  detail = null,
  preview = null,
  detailLoading = false,
  detailError = null,
  loading = false,
}) {
  if (loading) {
    return (
      <DetailPanel>
        <div className="p-4 text-sm text-slate-500">Loading test result…</div>
      </DetailPanel>
    );
  }

  const resolved = mergeDetail(preview, detail);

  if (!resolved?.name) {
    return (
      <DetailPanel>
        <div className="p-4 text-sm text-slate-500">Test result not found</div>
      </DetailPanel>
    );
  }

  const title = resolved.classname
    ? `${resolved.classname} :: ${resolved.name}`
    : resolved.name;

  const result = (resolved.result || "").toLowerCase();
  const isFailure = result === "failed" || result === "error";
  const hasFailureDetails = Boolean(resolved.failure_message || resolved.failure_body);

  return (
    <DetailPanel
      header={
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold">{title}</h2>
          <CaseResultRight result={resolved.result} caseResultMode="icon" />
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {detailLoading && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Loading full result details…</p>
        )}
        {detailError && !detail && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Could not load extended details. Showing summary from the case list.
            {detailError !== "Failed to load test result" && (
              <span className="mt-1 block font-mono text-[11px] opacity-90">{detailError}</span>
            )}
          </p>
        )}

        <ResultStatusBanner result={resolved.result} />

        <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <dt className="text-slate-500 dark:text-slate-400">Result</dt>
          <dd>{resultLabel(resolved.result)}</dd>
          {resolved.classname && (
            <>
              <dt className="text-slate-500 dark:text-slate-400">Class</dt>
              <dd className="font-mono text-xs">{resolved.classname}</dd>
            </>
          )}
          <dt className="text-slate-500 dark:text-slate-400">Test name</dt>
          <dd className="min-w-0 break-words">{resolved.name}</dd>
          {resolved.duration_sec != null && (
            <>
              <dt className="text-slate-500 dark:text-slate-400">Duration</dt>
              <dd>{resolved.duration_sec.toFixed(3)}s</dd>
            </>
          )}
          {resolved.junit_file && (
            <>
              <dt className="text-slate-500 dark:text-slate-400">JUnit file</dt>
              <dd className="break-all font-mono text-xs">{resolved.junit_file}</dd>
            </>
          )}
        </dl>

        {isFailure && !hasFailureDetails && !detailLoading && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No failure message was recorded in the JUnit output for this test.
          </p>
        )}

        {resolved.failure_message && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">
              Failure message
            </h3>
            <pre className="whitespace-pre-wrap rounded bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950/40 dark:text-red-100">
              {resolved.failure_message}
            </pre>
          </div>
        )}

        {resolved.failure_body && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Stack trace
            </h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-3 font-mono text-xs text-slate-800 dark:bg-slate-900 dark:text-slate-100">
              {resolved.failure_body}
            </pre>
          </div>
        )}

        {resolved.system_out && (
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              System out
            </h3>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-900">
              {resolved.system_out}
            </pre>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}

export default AutomationResultDetailPanel;
