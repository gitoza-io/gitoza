import { Ban, CheckCircle2, FlaskConical, Inbox, OctagonAlert, Timer } from "lucide-react";
import { TicketTypeIcon } from "./TestEntityIcons";
import { formatTicketStatusLabel, TICKET_STATUS_OPTIONS } from "../utils/ticketStatus";

export const TICKET_TYPE_ORDER = ["bug", "story", "task", "spike", "unset"];

export const TICKET_STATUS_VISUAL = {
  open: {
    Icon: Inbox,
    className: "text-sky-700 dark:text-sky-300",
    barClassName: "bg-sky-500",
  },
  in_progress: {
    Icon: Timer,
    className: "text-amber-700 dark:text-amber-300",
    barClassName: "bg-amber-500",
  },
  in_testing: {
    Icon: FlaskConical,
    className: "text-violet-700 dark:text-violet-300",
    barClassName: "bg-violet-500",
  },
  blocked: {
    Icon: OctagonAlert,
    className: "text-rose-700 dark:text-rose-300",
    barClassName: "bg-rose-500",
  },
  done: {
    Icon: CheckCircle2,
    className: "text-emerald-700 dark:text-emerald-300",
    barClassName: "bg-emerald-500",
  },
  cancelled: {
    Icon: Ban,
    className: "text-slate-700 dark:text-slate-300",
    barClassName: "bg-slate-400 dark:bg-slate-500",
  },
  unset: {
    Icon: null,
    className: "text-slate-700 dark:text-slate-300",
    barClassName: "bg-slate-300 dark:bg-slate-600",
  },
};

/** Release lifecycle status colors (not ticket workflow status). */
export const RELEASE_LIFECYCLE_STATUS_VISUAL = {
  open: "text-sky-700 dark:text-sky-300",
  shipped: "text-emerald-700 dark:text-emerald-300",
  cancelled: "text-slate-700 dark:text-slate-300",
};

export function ticketTypeLabel(key) {
  if (key === "unset") return "Unset";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function orderedCountRows(map, preferredOrder, labelFn) {
  if (!map) return [];
  const seen = new Set();
  const rows = [];
  for (const key of preferredOrder) {
    const count = map[key] ?? 0;
    if (count > 0) {
      rows.push({ key, label: labelFn(key), count });
      seen.add(key);
    }
  }
  const extras = Object.entries(map)
    .filter(([key, count]) => count > 0 && !seen.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, label: labelFn(key), count }));
  return [...rows, ...extras];
}

export function statusCountRowsFromBreakdown(byStatus) {
  return orderedCountRows(
    byStatus,
    TICKET_STATUS_OPTIONS.map((o) => o.value).concat(["unset"]),
    formatTicketStatusLabel,
  );
}

export function typeCountRowsFromBreakdown(byType) {
  return orderedCountRows(byType, TICKET_TYPE_ORDER, ticketTypeLabel);
}

export function MetricCard({ title, titleId, children, className = "" }) {
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

export function CountRow({ label, count, leading = null, labelClassName = "" }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-none border border-slate-100 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700/60 dark:bg-slate-800/40">
      <span className="flex min-w-0 items-center gap-2">
        {leading}
        <span
          className={`min-w-0 truncate text-sm font-medium ${labelClassName || "text-slate-800 dark:text-slate-100"}`}
        >
          {label}
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">
        {count}
      </span>
    </li>
  );
}

export function StatusCountList({ rows, emptyMessage = "No status data yet." }) {
  if (!rows?.length) {
    return <p className="text-xs text-slate-600 dark:text-slate-300">{emptyMessage}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const visual = TICKET_STATUS_VISUAL[row.key] || TICKET_STATUS_VISUAL.unset;
        const Icon = visual.Icon;
        return (
          <CountRow
            key={row.key}
            label={row.label || formatTicketStatusLabel(row.key)}
            count={row.count}
            labelClassName={visual.className}
            leading={
              Icon ? (
                <Icon
                  className={`h-4 w-4 shrink-0 ${visual.className}`}
                  aria-hidden
                  strokeWidth={2}
                />
              ) : null
            }
          />
        );
      })}
    </ul>
  );
}

export function TypeCountList({ rows, emptyMessage = "No type data yet." }) {
  if (!rows?.length) {
    return <p className="text-xs text-slate-600 dark:text-slate-300">{emptyMessage}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <CountRow
          key={row.key}
          label={row.label}
          count={row.count}
          leading={row.key !== "unset" ? <TicketTypeIcon type={row.key} /> : null}
        />
      ))}
    </ul>
  );
}

/**
 * Segmented status composition bar + completion % for release overview.
 * Completion = done / (total − cancelled); cancelled is excluded from the denominator.
 *
 * @param {{ byStatus?: Record<string, number>|null }} props
 */
export function TicketStatusProgressBar({ byStatus }) {
  if (!byStatus) return null;
  const orderedKeys = TICKET_STATUS_OPTIONS.map((o) => o.value).concat(["unset"]);
  const seen = new Set();
  const segments = [];
  let total = 0;
  let done = 0;
  let cancelled = 0;

  for (const key of orderedKeys) {
    const count = byStatus[key] ?? 0;
    if (count <= 0) continue;
    seen.add(key);
    total += count;
    if (key === "done") done += count;
    if (key === "cancelled") cancelled += count;
    const visual = TICKET_STATUS_VISUAL[key] || TICKET_STATUS_VISUAL.unset;
    segments.push({
      key,
      count,
      label: formatTicketStatusLabel(key),
      color: visual.barClassName,
    });
  }
  for (const [key, count] of Object.entries(byStatus)) {
    if (count <= 0 || seen.has(key)) continue;
    total += count;
    const visual = TICKET_STATUS_VISUAL.unset;
    segments.push({
      key,
      count,
      label: formatTicketStatusLabel(key),
      color: visual.barClassName,
    });
  }

  if (total <= 0) return null;

  const activeTotal = Math.max(0, total - cancelled);
  const completionPct = activeTotal > 0 ? Math.round((100 * done) / activeTotal) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {completionPct}% done
        </p>
        <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
          {done} of {activeTotal}
          {cancelled > 0 ? ` · ${cancelled} cancelled` : ""}
        </p>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
        role="img"
        aria-label={`Release progress ${completionPct}% done`}
      >
        <div className="flex h-full w-full">
          {segments.map((seg) => (
            <div
              key={seg.key}
              className={seg.color}
              style={{ width: `${(100 * seg.count) / total}%` }}
              title={`${seg.label}: ${seg.count}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
