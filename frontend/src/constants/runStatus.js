/**
 * Shared labels for test run status (not_started, in_progress, completed).
 * Used by Dashboard and Test Run for consistent display.
 */
export const RUN_STATUS_LABELS = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

/** Tailwind classes per run status for badge/pill styling. */
export const RUN_STATUS_STYLES = {
  completed: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  not_started: "bg-slate-100 text-slate-600 dark:bg-slate-600/30 dark:text-slate-400",
};

/**
 * @param {string} [status] - Run status key (e.g. from run.status).
 * @returns {string} Display label for the status.
 */
export function getRunStatusLabel(status) {
  if (!status) return RUN_STATUS_LABELS.not_started;
  return RUN_STATUS_LABELS[status] ?? status;
}

/**
 * @param {string} [status] - Run status key (e.g. from run.status).
 * @returns {{ key: string; label: string; className: string }}
 */
export function getRunStatusDisplay(status) {
  const key =
    status === "completed" ? "completed"
    : status === "in_progress" ? "in_progress"
    : "not_started";
  return {
    key,
    label: getRunStatusLabel(status),
    className: RUN_STATUS_STYLES[key],
  };
}
