import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import TreeContentLayout from "../components/TreeContentLayout";
import TreeToolbar from "../components/TreeToolbar";
import DetailPanel from "../components/DetailPanel";
import DetailPanelEmpty from "../components/DetailPanelEmpty";
import RunSummaryPanel from "../components/RunSummaryPanel";
import OperationInProgressOverlay from "../components/OperationInProgressOverlay";
import { LONG_OPERATION_TITLE_EXPORT_RUNS } from "../copy/longOperationCopy";
import { normalizeRequirementIds } from "../utils/requirementIds";

const EXPORT_FORMATS = [
  { id: "csv", label: "CSV" },
  { id: "pdf", label: "PDF" },
];

import { fetchAllRunCases } from "../services/api";

function ExportRunsPage({
  runs = [],
  getRun,
  getRunCaseContent,
  activeRepoSlug,
  onExport,
  onCancel,
  sidebarFooter,
  sidebarTitleRight,
}) {
  const [selectedRunIds, setSelectedRunIds] = useState(() => new Set());
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [exportFormat, setExportFormat] = useState("csv");
  const [formatDropdownOpen, setFormatDropdownOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewDetail, setPreviewDetail] = useState(null);

  const selectedCount = selectedRunIds.size;
  const currentFormatLabel = EXPORT_FORMATS.find((f) => f.id === exportFormat)?.label ?? exportFormat;

  useEffect(() => {
    if (!selectedRunId || !activeRepoSlug) {
      setPreviewDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    getRun(selectedRunId, activeRepoSlug, { includeCases: false })
      .then((data) => {
        if (!cancelled) setPreviewDetail(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setPreviewDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, getRun, activeRepoSlug]);

  const toggleRun = useCallback((runId) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    const runIds = Array.from(selectedRunIds);
    if (runIds.length === 0 || !activeRepoSlug) return;
    setExporting(true);
    try {
      const runDetails = await Promise.all(
        runIds.map(async (runId) => {
          const detail = await getRun(runId, activeRepoSlug, { includeCases: false });
          const run = detail?.run ?? runs.find((r) => r.run_id === runId) ?? { run_id: runId };
          const cases = await fetchAllRunCases(runId, activeRepoSlug);
          const fullCases = await Promise.all(
            cases.map(async (c) => {
              if (!c?.file_path) return c;
              try {
                const content = await getRunCaseContent(runId, c.file_path, activeRepoSlug);
                return {
                  ...c,
                  title: content?.title ?? c.title,
                  priority: content?.priority ?? c.priority,
                  requirement_ids: normalizeRequirementIds(content ?? c),
                  tags: content?.tags ?? c.tags,
                  body: content?.body ?? c.body,
                };
              } catch {
                return c;
              }
            }),
          );
          return { run, cases: fullCases };
        }),
      );
      await onExport?.(runDetails, exportFormat);
    } finally {
      setExporting(false);
    }
  }, [selectedRunIds, activeRepoSlug, getRun, getRunCaseContent, runs, onExport, exportFormat]);

  const toolbarRight = (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        Cancel
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setFormatDropdownOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {currentFormatLabel}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {formatDropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" aria-hidden onClick={() => setFormatDropdownOpen(false)} />
            <ul className="absolute right-0 top-full z-20 mt-1 min-w-[6rem] rounded-ui border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800">
              {EXPORT_FORMATS.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setExportFormat(f.id);
                      setFormatDropdownOpen(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {f.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={handleExport}
        disabled={selectedCount === 0 || exporting}
        className="rounded bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-50"
      >
        {exporting ? "Exporting..." : `Export (${selectedCount})`}
      </button>
    </div>
  );

  const runItems = useMemo(
    () =>
      runs.map((run) => {
        const checked = selectedRunIds.has(run.run_id);
        return (
          <li key={run.run_id}>
            <label className="flex cursor-pointer items-start gap-2 border-b border-slate-200 px-2 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleRun(run.run_id)}
                className="mt-0.5 rounded border-slate-300"
              />
              <button
                type="button"
                onClick={() => setSelectedRunId(run.run_id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate font-medium text-slate-800 dark:text-slate-200">{run.name || "Unnamed run"}</p>
                <p className="truncate text-sm text-slate-600 dark:text-slate-400">
                  {run.total_cases ?? 0} cases ·{" "}
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">{run.passed ?? 0} passed</span>
                  {" · "}
                  <span className="font-semibold text-red-600 dark:text-red-400">{run.failed ?? 0} failed</span>
                </p>
              </button>
            </label>
          </li>
        );
      }),
    [runs, selectedRunIds, toggleRun],
  );

  return (
    <>
      <OperationInProgressOverlay open={exporting} title={LONG_OPERATION_TITLE_EXPORT_RUNS} />
      <TreeContentLayout
        sidebarTitle="Export runs"
        sidebarTitleRight={sidebarTitleRight}
        sidebarToolbar={<TreeToolbar sortButton={null} searchNode={null} trailingActions={toolbarRight} />}
        sidebarContent={<ul className="space-y-0">{runItems}</ul>}
        sidebarFooter={sidebarFooter}
      >
      {selectedRunId ? (
        loadingPreview ? (
          <DetailPanel>
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Loading run...
            </div>
          </DetailPanel>
        ) : (
          <RunSummaryPanel
            run={previewDetail?.run ?? null}
            runCases={previewDetail?.cases ?? []}
            loading={false}
          />
        )
      ) : (
        <DetailPanel>
          <DetailPanelEmpty title="Select a run to preview" iconComponent={null} />
        </DetailPanel>
      )}
    </TreeContentLayout>
    </>
  );
}

export default ExportRunsPage;

