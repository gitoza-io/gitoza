import { useEffect, useMemo, useRef, useState } from "react";
import DetailPanel from "./DetailPanel";
import TagChipPicker from "./TagChipPicker";
import { priorityColors } from "./TestCaseDetailModal";
import { getProjectCaseBreakdown } from "../services/api";

const PRIORITY_ORDER = ["high", "medium", "low", "unset"];

const PRIORITY_BAR_COLORS = {
  high: "bg-red-500",
  medium: "bg-orange-500",
  low: "bg-blue-500",
  unset: "bg-slate-400",
};

function priorityLabel(key) {
  if (key === "unset") return "Unset";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Map selected tag labels to pre-aggregated counts from `get_project_case_breakdown`. */
function tagCaseBreakdownRowsFromApi(byTag, selectedTags) {
  if (!byTag || !selectedTags?.length) return [];
  const rows = [];
  const seen = new Set();
  for (const tag of selectedTags) {
    const label = String(tag ?? "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    const count = byTag[key];
    if (count > 0) {
      rows.push({ key, label, count });
    }
  }
  return rows;
}

function MetricCard({ title, titleId, children, className = "" }) {
  return (
    <section
      aria-labelledby={titleId}
      className={`flex flex-col rounded-none border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-700/90 dark:bg-slate-900/50 ${className}`}
    >
      <h3
        id={titleId}
        className="mb-3 shrink-0 border-b border-slate-100 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-700 dark:border-slate-700/80 dark:text-slate-300"
      >
        {title}
      </h3>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function CaseCountRow({ label, count, labelClassName = "" }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-none border border-slate-100 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700/60 dark:bg-slate-800/40">
      <span
        className={`min-w-0 truncate text-sm font-medium ${labelClassName || "text-slate-800 dark:text-slate-100"}`}
      >
        {label}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {count}
      </span>
    </li>
  );
}

function PriorityCountBar({ counts, total }) {
  if (!total) return null;
  const segments = PRIORITY_ORDER.map((pk) => ({
    key: pk,
    pct: ((counts[pk] ?? 0) / total) * 100,
    color: PRIORITY_BAR_COLORS[pk],
  }));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div className="flex h-full w-full">
        {segments.map((seg) =>
          seg.pct > 0 ? (
            <div
              key={seg.key}
              className={seg.color}
              style={{ width: `${seg.pct}%` }}
              title={priorityLabel(seg.key)}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

function DonutChart({ data, size = 96, centerLabel = null, centerSub = null }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const fraction = total > 0 ? d.value / total : 0;
      const length = fraction * circumference;
      const seg = { ...d, dashArray: `${length} ${circumference - length}`, dashOffset: -offset };
      offset += length;
      return seg;
    });
  const cx = size / 2;
  const cy = size / 2;
  const hasCenter = centerLabel != null || centerSub != null;
  const summary = data.map((d) => `${d.label} ${d.value}`).join(", ");
  return (
    <svg
      width={size}
      height={size}
      className="shrink-0"
      aria-hidden={hasCenter ? undefined : "true"}
      aria-label={hasCenter ? summary : undefined}
      role={hasCenter ? "img" : undefined}
    >
      <g transform={`translate(${cx}, ${cy}) rotate(-90)`}>
        {segments.map((seg, i) => (
          <circle
            key={i}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="10"
            strokeDasharray={seg.dashArray}
            strokeDashoffset={seg.dashOffset}
            className="transition-opacity duration-200"
          />
        ))}
      </g>
      {hasCenter && (
        <g transform={`translate(${cx}, ${cy})`}>
          {centerLabel != null && (
            <text
              x={0}
              y={centerSub != null ? -2 : 4}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-800 text-xl font-bold tabular-nums dark:fill-slate-100"
            >
              {centerLabel}
            </text>
          )}
          {centerSub != null && (
            <text
              x={0}
              y={16}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-700 text-[10px] font-medium uppercase tracking-wide dark:fill-slate-300"
            >
              {centerSub}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

function DonutLegend({ items }) {
  return (
    <ul className="flex flex-col gap-1.5 text-xs" aria-label="Result legend">
      {items.map(({ label, value, color }) => (
        <li key={label} className="flex items-center justify-between gap-3 tabular-nums">
          <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-200">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
            <span className="truncate">{label}</span>
          </span>
          <span className="shrink-0 font-medium text-slate-900 dark:text-slate-50">{value}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Project case metrics for Test Repository detail when a project is selected and no case is open.
 */
function ProjectOverviewPanel({
  projectPath,
  projectName,
  suiteCount = 0,
  automatedCount = 0,
  totalTestCases = 0,
  activeRepoSlug = null,
}) {
  const [breakdown, setBreakdown] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const haveDataRef = useRef(false);

  useEffect(() => {
    setSelectedTags([]);
    haveDataRef.current = false;
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath || !activeRepoSlug) {
      setBreakdown(null);
      haveDataRef.current = false;
      setLoading(false);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    if (!haveDataRef.current) setLoading(true);
    setError(null);
    getProjectCaseBreakdown(projectPath, activeRepoSlug)
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
          setError("Failed to load project breakdown.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, activeRepoSlug]);

  const priorityCounts = useMemo(() => {
    const fromApi = breakdown?.by_priority;
    if (!fromApi) return { high: 0, medium: 0, low: 0, unset: 0 };
    return {
      high: fromApi.high ?? 0,
      medium: fromApi.medium ?? 0,
      low: fromApi.low ?? 0,
      unset: fromApi.unset ?? 0,
    };
  }, [breakdown]);

  const tags = useMemo(
    () => (Array.isArray(breakdown?.tags) ? breakdown.tags : []),
    [breakdown],
  );

  const tagRows = useMemo(
    () => tagCaseBreakdownRowsFromApi(breakdown?.by_tag, selectedTags),
    [breakdown, selectedTags],
  );

  const userRows = useMemo(() => {
    const byUser = breakdown?.by_user;
    if (!byUser) return [];
    return Object.entries(byUser)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [breakdown]);

  const automationStats = useMemo(() => {
    const total = breakdown?.total_cases ?? totalTestCases ?? 0;
    const automated = breakdown?.automated_count ?? automatedCount ?? 0;
    const manual = Math.max(0, total - automated);
    const rate = total > 0 ? Math.round((100 * automated) / total) : 0;
    return { total, automated, manual, rate };
  }, [breakdown, totalTestCases, automatedCount]);

  const initialLoad = loading && !breakdown;
  const hasCases = (breakdown?.total_cases ?? totalTestCases ?? 0) > 0;
  const displaySuiteCount = suiteCount ?? 0;
  const title = projectName || "Untitled";

  return (
    <DetailPanel title={title} bodyScroll>
      <div className="space-y-3 pb-4">
        {error ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <MetricCard title="Total cases" titleId="project-overview-total-heading">
              {!error && (hasCases || initialLoad) ? (
                <div className="space-y-3">
                  <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {breakdown?.total_cases ?? totalTestCases ?? 0}
                  </p>
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    {displaySuiteCount} suite
                    {displaySuiteCount !== 1 ? "s" : ""} in this project
                  </p>
                </div>
              ) : initialLoad ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300">No test cases in this project yet.</p>
              )}
            </MetricCard>

            {automationStats.automated >= 1 ? (
              <MetricCard title="Automation" titleId="project-overview-automation-heading">
                {!error && (breakdown || !initialLoad) ? (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <DonutChart
                        data={[
                          {
                            label: "Automated",
                            value: automationStats.automated,
                            color: "rgb(99, 102, 241)",
                          },
                          {
                            label: "Manual",
                            value: automationStats.manual,
                            color: "rgb(203, 213, 225)",
                          },
                        ]}
                        size={140}
                        centerLabel={`${automationStats.rate}%`}
                        centerSub="Automated"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <DonutLegend
                        items={[
                          {
                            label: "Automated",
                            value: automationStats.automated,
                            color: "rgb(99, 102, 241)",
                          },
                          {
                            label: "Manual",
                            value: automationStats.manual,
                            color: "rgb(203, 213, 225)",
                          },
                        ]}
                      />
                    </div>
                  </div>
                ) : initialLoad ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
                ) : null}
              </MetricCard>
            ) : null}

            <MetricCard title="By priority" titleId="project-overview-priority-heading">
              {!error && hasCases && (breakdown || !initialLoad) ? (
                <div className="space-y-3">
                  <PriorityCountBar
                    counts={priorityCounts}
                    total={breakdown?.total_cases ?? 0}
                  />
                  <ul className="space-y-2">
                    {PRIORITY_ORDER.map((pk) => {
                      const count = priorityCounts[pk] ?? 0;
                      if (count === 0) return null;
                      return (
                        <CaseCountRow
                          key={pk}
                          label={priorityLabel(pk)}
                          count={count}
                          labelClassName={
                            priorityColors[pk] || "text-slate-700 dark:text-slate-300"
                          }
                        />
                      );
                    })}
                  </ul>
                </div>
              ) : initialLoad ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Priority breakdown appears when cases exist in this project.
                </p>
              )}
            </MetricCard>
          </div>

          <div className="flex flex-col gap-3">
            <MetricCard title="By tag" titleId="project-overview-tag-heading">
              {!error && hasCases && (breakdown || !initialLoad) ? (
                tags.length === 0 ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    No tags on cases in this project.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <TagChipPicker
                      id="project-overview-tag-picker"
                      options={tags}
                      value={selectedTags}
                      onChange={setSelectedTags}
                      placeholder="Search tags…"
                      aria-label="Search and select tags for case breakdown"
                      emptyOptionsMessage="No tags on cases in this project."
                    />
                    {tagRows.length > 0 ? (
                      <ul className="space-y-2">
                        {tagRows.map(({ key, label, count }) => (
                          <CaseCountRow key={key} label={label} count={count} />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        Search and add tags to see case counts.
                      </p>
                    )}
                  </div>
                )
              ) : initialLoad ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Tag breakdown appears when cases exist in this project.
                </p>
              )}
            </MetricCard>

            <MetricCard title="By assignee" titleId="project-overview-assignee-heading">
              {!error && hasCases && (breakdown || !initialLoad) ? (
                userRows.length === 0 ? (
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    No assignee data for cases in this project.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {userRows.map(({ label, count }) => (
                      <CaseCountRow key={label} label={label} count={count} />
                    ))}
                  </ul>
                )
              ) : initialLoad ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Assignee breakdown appears when cases exist in this project.
                </p>
              )}
            </MetricCard>

            <MetricCard title="Orphan cases" titleId="project-overview-orphan-heading">
              {!error && (hasCases || initialLoad) ? (
                <div className="space-y-2">
                  <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                    {breakdown?.untagged_count ?? 0}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">Cases with no tags</p>
                </div>
              ) : initialLoad ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">…</p>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300">No untagged cases to report.</p>
              )}
            </MetricCard>
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}

export default ProjectOverviewPanel;
