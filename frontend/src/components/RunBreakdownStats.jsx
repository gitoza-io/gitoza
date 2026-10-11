import { useEffect, useMemo, useRef, useState } from "react";
import TagChipPicker from "./TagChipPicker";
import RunSuiteBreakdownList, {
  BreakdownRowHeader,
  ResultStackBar,
} from "./RunSuiteBreakdownList";
import { getRunBreakdown } from "../services/api";

const PRIORITY_ORDER = ["high", "medium", "low", "unset"];

const EMPTY_PRIORITY_BUCKETS = {
  high: { totalCases: 0, passed: 0, failed: 0, skipped: 0, pending: 0 },
  medium: { totalCases: 0, passed: 0, failed: 0, skipped: 0, pending: 0 },
  low: { totalCases: 0, passed: 0, failed: 0, skipped: 0, pending: 0 },
  unset: { totalCases: 0, passed: 0, failed: 0, skipped: 0, pending: 0 },
};

function priorityLabel(key) {
  if (key === "unset") return "Unset";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Map selected tag labels to pre-aggregated stats from `get_run_breakdown`. */
function tagBreakdownRowsFromApi(byTag, selectedTags) {
  if (!byTag || !selectedTags?.length) return [];
  const rows = [];
  const seen = new Set();
  for (const tag of selectedTags) {
    const label = String(tag ?? "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    const stats = byTag[key];
    if (stats && (stats.totalCases ?? 0) > 0) {
      rows.push({ key, label, stats });
    }
  }
  return rows;
}

function MetricCard({ title, titleId, children }) {
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-none border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/50"
    >
      <h3
        id={titleId}
        className="mb-3 shrink-0 border-b border-slate-100 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:border-slate-700/80 dark:text-slate-400"
      >
        {title}
      </h3>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * Run priority / tag / suite breakdown for RunSummaryPanel (between description and comments).
 */
function RunBreakdownStats({ runId, repoSlug = null, totalCases = 0 }) {
  const [breakdown, setBreakdown] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const haveDataRef = useRef(false);
  const suiteScrollRef = useRef(null);

  useEffect(() => {
    setSelectedTags([]);
    haveDataRef.current = false;
  }, [runId]);

  useEffect(() => {
    if (!runId || !repoSlug) {
      setBreakdown(null);
      haveDataRef.current = false;
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    if (!haveDataRef.current) setLoading(true);
    setError(null);
    getRunBreakdown(runId, repoSlug)
      .then((data) => {
        if (!cancelled) {
          setBreakdown(data ?? null);
          haveDataRef.current = true;
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBreakdown(null);
          haveDataRef.current = false;
          setError("Failed to load run breakdown.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, repoSlug]);

  const priorityBuckets = useMemo(() => {
    const fromApi = breakdown?.by_priority;
    if (!fromApi) return EMPTY_PRIORITY_BUCKETS;
    return {
      high: fromApi.high ?? EMPTY_PRIORITY_BUCKETS.high,
      medium: fromApi.medium ?? EMPTY_PRIORITY_BUCKETS.medium,
      low: fromApi.low ?? EMPTY_PRIORITY_BUCKETS.low,
      unset: fromApi.unset ?? EMPTY_PRIORITY_BUCKETS.unset,
    };
  }, [breakdown]);

  const runTags = useMemo(
    () => (Array.isArray(breakdown?.tags) ? breakdown.tags : []),
    [breakdown],
  );

  const tagRows = useMemo(
    () => tagBreakdownRowsFromApi(breakdown?.by_tag, selectedTags),
    [breakdown, selectedTags],
  );

  const suiteRows = useMemo(
    () => (Array.isArray(breakdown?.by_suite) ? breakdown.by_suite : []),
    [breakdown],
  );

  const initialLoad = loading && !breakdown;
  const hasCases = (totalCases ?? 0) > 0;

  return (
    <div className="mb-4 space-y-3" ref={suiteScrollRef}>
      {error ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
      ) : null}

      <MetricCard title="By priority" titleId="run-breakdown-priority-heading">
        {!error && hasCases && (breakdown || !initialLoad) ? (
          <ul className="space-y-2">
            {PRIORITY_ORDER.map((pk) => {
              const b = priorityBuckets[pk];
              if ((b.totalCases ?? 0) === 0) return null;
              return (
                <li
                  key={pk}
                  className="rounded-none border border-slate-100 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700/60 dark:bg-slate-800/40"
                >
                  <BreakdownRowHeader title={priorityLabel(pk)} stats={b} />
                  <ResultStackBar
                    passed={b.passed}
                    failed={b.failed}
                    skipped={b.skipped}
                    pending={b.pending}
                  />
                </li>
              );
            })}
          </ul>
        ) : initialLoad ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">…</p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {hasCases
              ? "No case breakdown available."
              : "Priority breakdown appears when cases are in the run."}
          </p>
        )}
      </MetricCard>

      <MetricCard title="By tag" titleId="run-breakdown-tag-heading">
        {!error && hasCases && (breakdown || !initialLoad) ? (
          runTags.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No tags on cases in this run (tags come from each case&apos;s YAML snapshot).
            </p>
          ) : (
            <div className="space-y-3">
              <TagChipPicker
                id="run-breakdown-tag-picker"
                options={runTags}
                value={selectedTags}
                onChange={setSelectedTags}
                placeholder="Search tags…"
                aria-label="Search and select tags for result breakdown"
                emptyOptionsMessage="No tags on cases in this run."
              />
              {tagRows.length > 0 ? (
                <ul className="space-y-2">
                  {tagRows.map(({ key, label, stats }) => (
                    <li
                      key={key}
                      className="rounded-none border border-slate-100 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700/60 dark:bg-slate-800/40"
                    >
                      <BreakdownRowHeader title={label} stats={stats} />
                      <ResultStackBar
                        passed={stats.passed}
                        failed={stats.failed}
                        skipped={stats.skipped}
                        pending={stats.pending}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Search and add tags to see pass, fail, skip, and pending counts.
                </p>
              )}
            </div>
          )
        ) : initialLoad ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">…</p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {hasCases
              ? "No case breakdown available."
              : "Tag breakdown appears when cases are in the run."}
          </p>
        )}
      </MetricCard>

      <MetricCard title="By suite / project" titleId="run-breakdown-suite-heading">
        {!error && (hasCases || initialLoad) ? (
          <RunSuiteBreakdownList
            rows={suiteRows}
            loading={initialLoad}
            emptyMessage="No suite rows for this run."
            parentScrollRef={suiteScrollRef}
          />
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {hasCases
              ? "No case breakdown available."
              : "Add cases to this run to see suite breakdown."}
          </p>
        )}
      </MetricCard>
    </div>
  );
}

export default RunBreakdownStats;
