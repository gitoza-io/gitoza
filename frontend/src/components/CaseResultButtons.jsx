import { Check, Circle, Minus, MinusCircle, X, XCircle } from "lucide-react";

export const RESULT_STYLES = {
  passed: {
    active:
      "bg-green-200 text-green-800 ring-1 ring-green-500 dark:bg-green-600/30 dark:text-green-200 dark:ring-green-400",
    idle: "text-green-700/50 hover:text-green-700 hover:bg-green-100/70 dark:text-green-500/40 dark:hover:text-green-400 dark:hover:bg-green-600/15",
    segmentActive: "bg-green-400 text-green-950 dark:bg-green-600/55 dark:text-green-50",
    segmentIdle:
      "bg-transparent text-green-700/35 hover:bg-green-100/70 hover:text-green-700 dark:text-green-500/40 dark:hover:bg-green-600/15 dark:hover:text-green-400",
  },
  failed: {
    active:
      "bg-red-200 text-red-800 ring-1 ring-red-500 dark:bg-red-600/30 dark:text-red-200 dark:ring-red-400",
    idle: "text-red-600/50 hover:text-red-600 hover:bg-red-100/60 dark:text-red-400/40 dark:hover:text-red-400 dark:hover:bg-red-500/15",
    segmentActive: "bg-red-500 text-white dark:bg-red-500 dark:text-white",
    segmentIdle:
      "bg-transparent text-red-500/35 hover:bg-red-50 hover:text-red-600 dark:text-red-400/40 dark:hover:bg-red-500/15 dark:hover:text-red-400",
  },
  skipped: {
    active:
      "bg-slate-200 text-slate-800 ring-1 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-200 dark:ring-slate-500",
    idle: "text-slate-500/50 hover:text-slate-600 hover:bg-slate-100/60 dark:text-slate-400/40 dark:hover:text-slate-400 dark:hover:bg-slate-500/15",
    segmentActive: "bg-slate-500 text-white dark:bg-slate-400 dark:text-slate-900",
    segmentIdle:
      "bg-transparent text-slate-500/50 hover:bg-slate-100/60 hover:text-slate-600 dark:text-slate-400/40 dark:hover:bg-slate-500/15 dark:hover:text-slate-400",
  },
  pending: {
    active:
      "bg-amber-100 text-amber-900 ring-1 ring-amber-400 dark:bg-amber-500/25 dark:text-amber-200 dark:ring-amber-500",
    idle: "text-amber-700/50 hover:text-amber-800 hover:bg-amber-100/70 dark:text-amber-400/40 dark:hover:text-amber-300 dark:hover:bg-amber-500/15",
  },
};

const RESULT_ICON_CONFIG = {
  passed: { Icon: Check, style: RESULT_STYLES.passed.active, title: "Passed" },
  failed: { Icon: XCircle, style: RESULT_STYLES.failed.active, title: "Failed" },
  skipped: { Icon: MinusCircle, style: RESULT_STYLES.skipped.active, title: "Skipped" },
  pending: { Icon: Circle, style: RESULT_STYLES.pending.active, title: "Pending" },
};

const RESULT_SEGMENT_OPTIONS = [
  {
    value: "passed",
    label: "Pass",
    Icon: Check,
    active: RESULT_STYLES.passed.segmentActive,
    idle: RESULT_STYLES.passed.segmentIdle,
  },
  {
    value: "failed",
    label: "Fail",
    Icon: X,
    active: RESULT_STYLES.failed.segmentActive,
    idle: RESULT_STYLES.failed.segmentIdle,
  },
  {
    value: "skipped",
    label: "Skip",
    Icon: Minus,
    active: RESULT_STYLES.skipped.segmentActive,
    idle: RESULT_STYLES.skipped.segmentIdle,
  },
];

const SEGMENT_BASE =
  "flex h-7 w-7 shrink-0 items-center justify-center touch-manipulation active:scale-[0.96] active:duration-0";

function normalizeResult(result) {
  if (!result || result === "pending") return "pending";
  if (RESULT_ICON_CONFIG[result]) return result;
  return "pending";
}

/**
 * Single read-only result icon (Review run list).
 */
export function CaseResultIcon({ result }) {
  const r = normalizeResult(result);
  const { Icon, style, title } = RESULT_ICON_CONFIG[r];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm p-1.5 ${style}`}
      title={title}
      aria-label={title}
    >
      <Icon className="h-[1.125rem] w-[1.125rem]" strokeWidth={2.5} />
    </span>
  );
}

/**
 * Compact Pass / Fail / Skip segmented control for run case rows.
 */
function CaseResultButtons({ result, filePath, onSetResult }) {
  if (!onSetResult) return null;
  const handleClick = (e, value) => {
    e.stopPropagation();
    onSetResult(filePath, value);
  };
  return (
    <span
      role="radiogroup"
      aria-label="Test result"
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-slate-200 divide-x divide-slate-200 dark:border-slate-600 dark:divide-slate-600"
    >
      {RESULT_SEGMENT_OPTIONS.map(({ value, label, Icon, active, idle }) => {
        const isActive = result === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            title={label}
            onClick={(e) => handleClick(e, value)}
            className={`${SEGMENT_BASE} ${isActive ? active : idle}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
          </button>
        );
      })}
    </span>
  );
}

/**
 * Result controls for a run case row: buttons or read-only icon.
 */
export function CaseResultRight({ result, filePath, onSetResult, caseResultMode = "buttons" }) {
  if (caseResultMode === "icon") {
    return <CaseResultIcon result={result} />;
  }
  return <CaseResultButtons result={result} filePath={filePath} onSetResult={onSetResult} />;
}

export default CaseResultButtons;
