import { Check, Circle, MinusCircle, XCircle } from "lucide-react";
import { RESULT_STYLES } from "./CaseResultButtons";

const PILL_BASE =
  "inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none";

const ZERO_PILL =
  "bg-slate-50 text-slate-300 ring-1 ring-slate-200 dark:bg-slate-800/50 dark:text-slate-600 dark:ring-slate-700";

function pillClass(activeStyle, count) {
  return count > 0 ? activeStyle : ZERO_PILL;
}

const FULL_STATUS_ITEMS = [
  { key: "passed", Icon: Check, activeStyle: RESULT_STYLES.passed.segmentActive, label: "passed" },
  { key: "failed", Icon: XCircle, activeStyle: RESULT_STYLES.failed.segmentActive, label: "failed" },
  { key: "skipped", Icon: MinusCircle, activeStyle: RESULT_STYLES.skipped.segmentActive, label: "skipped" },
  { key: "pending", Icon: Circle, activeStyle: RESULT_STYLES.pending.active, label: "pending" },
];

const TREE_CLEAR_ITEMS = [
  { key: "passed", Icon: Check, activeStyle: RESULT_STYLES.passed.segmentActive, label: "passed" },
  { key: "skipped", Icon: MinusCircle, activeStyle: RESULT_STYLES.skipped.segmentActive, label: "skipped" },
];

const TREE_ATTENTION_ITEMS = [
  { key: "failed", Icon: XCircle, activeStyle: RESULT_STYLES.failed.segmentActive, label: "failed" },
  { key: "pending", Icon: Circle, activeStyle: RESULT_STYLES.pending.active, label: "pending" },
];

function renderStatusPills(items, counts, { hideZero = false } = {}) {
  const visible = hideZero ? items.filter(({ key }) => (counts[key] ?? 0) > 0) : items;
  if (visible.length === 0) return null;

  const label = visible.map(({ key, label: statusLabel }) => `${counts[key]} ${statusLabel}`).join(", ");

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={label}
      aria-label={label}
    >
      {visible.map(({ key, Icon, activeStyle, label: statusLabel }) => (
        <span
          key={key}
          className={`${PILL_BASE} ${pillClass(activeStyle, counts[key])}`}
          title={`${counts[key]} ${statusLabel}`}
        >
          <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
          {counts[key]}
        </span>
      ))}
    </span>
  );
}

/**
 * Compact result count pills for run folder and suite rows.
 * Default (column 1): failed + pending when any need attention; otherwise pass (+ skip only if skipped > 0).
 * showAllStatuses: pass, fail, skip, pending always shown (column 3 rollup).
 */
function RunResultCountBadges({ stats, showAllStatuses = false }) {
  if (showAllStatuses) {
    const passed = stats?.passed ?? 0;
    const failed = stats?.failed ?? 0;
    const skipped = stats?.skipped ?? 0;
    const pending = stats?.pending ?? 0;
    const label = `${passed} passed, ${failed} failed, ${skipped} skipped, ${pending} pending`;
    const counts = { passed, failed, skipped, pending };

    return (
      <span
        className="inline-flex shrink-0 items-center gap-1"
        title={label}
        aria-label={label}
      >
        {FULL_STATUS_ITEMS.map(({ key, Icon, activeStyle, label: statusLabel }) => (
          <span
            key={key}
            className={`${PILL_BASE} ${pillClass(activeStyle, counts[key])}`}
            title={`${counts[key]} ${statusLabel}`}
          >
            <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
            {counts[key]}
          </span>
        ))}
      </span>
    );
  }

  const passed = stats?.passed ?? 0;
  const failed = stats?.failed ?? 0;
  const skipped = stats?.skipped ?? 0;
  const pending = stats?.pending ?? 0;
  const counts = { passed, failed, skipped, pending };

  if (failed > 0 || pending > 0) {
    return renderStatusPills(TREE_ATTENTION_ITEMS, counts, { hideZero: true });
  }

  const clearItems =
    skipped > 0 ? TREE_CLEAR_ITEMS : TREE_CLEAR_ITEMS.filter((item) => item.key !== "skipped");
  return renderStatusPills(clearItems, counts);
}

export default RunResultCountBadges;
