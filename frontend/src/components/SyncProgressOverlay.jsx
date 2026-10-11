import { Check, Loader2 } from "lucide-react";

import { LONG_OPERATION_KEEP_OPEN_HINT } from "../copy/longOperationCopy";

export const SYNC_PROGRESS_STEP_LABELS = [
  "Fetching remote updates",
  "Applying updates",
  "Publishing changes",
  "Refreshing workspace",
];

export const SYNC_ASSET_UPLOAD_STEP_LABEL = "Uploading images";

export const SYNC_PROGRESS_STEP_LABELS_WITH_ASSETS = [
  SYNC_ASSET_UPLOAD_STEP_LABEL,
  ...SYNC_PROGRESS_STEP_LABELS,
];

/**
 * Full-screen blocking overlay during workspace sync (confirm / resolve rebase).
 * Matches ConfirmDialog / PushFailedModal card styling; no backdrop dismiss while running.
 */
export default function SyncProgressOverlay({
  open,
  /** 'running' | 'success' | 'error' */
  phase = "running",
  stepLabels = SYNC_PROGRESS_STEP_LABELS,
  /** Same length as stepLabels: 'pending' | 'active' | 'done' */
  stepStatuses = [],
  errorMessage = "",
  onDismissError,
}) {
  if (!open) return null;

  const n = stepLabels.length || 1;
  const doneCount = stepStatuses.filter((s) => s === "done").length;
  const hasActive = stepStatuses.some((s) => s === "active");
  let progressFraction = doneCount / n;
  if (phase === "running" && hasActive) progressFraction += 0.35 / n;
  if (phase === "success") progressFraction = 1;
  const progressPct = Math.min(100, Math.round(progressFraction * 100));

  const running = phase === "running";

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sync-progress-title"
      aria-busy={running}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full min-w-0 max-w-md animate-dropdown-enter overflow-hidden rounded-ui border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="sync-progress-title"
          className="text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          {phase === "success"
            ? "Sync complete"
            : phase === "error"
              ? "Sync could not finish"
              : "Syncing workspace"}
        </h2>

        {running ? (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {LONG_OPERATION_KEEP_OPEN_HINT}
          </p>
        ) : null}

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${
              phase === "success"
                ? "bg-emerald-500"
                : phase === "error"
                  ? "bg-amber-500"
                  : "bg-indigo-600 dark:bg-indigo-500"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {phase === "success" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
              <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
            </div>
            <p className="text-center text-sm text-slate-600 dark:text-slate-400">
              Your workspace is up to date with the remote.
            </p>
          </div>
        ) : null}

        {phase === "error" ? (
          <div className="mt-6 space-y-4">
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onDismissError}
                className="rounded-ui bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {running ? (
          <ol className="mt-6 list-none space-y-0 p-0" aria-live="polite">
            {stepLabels.map((label, i) => {
              const status = stepStatuses[i] ?? "pending";
              return (
                <li key={label} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                    {status === "done" ? (
                      <Check className="h-5 w-5 text-emerald-500" strokeWidth={2.5} />
                    ) : status === "active" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <span className="block h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" />
                    )}
                  </span>
                  <span
                    className={
                      status === "pending"
                        ? "text-slate-400 dark:text-slate-500"
                        : status === "active"
                          ? "font-medium text-slate-900 dark:text-slate-100"
                          : "text-slate-700 dark:text-slate-300"
                    }
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
