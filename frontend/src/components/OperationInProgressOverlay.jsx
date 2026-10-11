import { Loader2 } from "lucide-react";

import { LONG_OPERATION_KEEP_OPEN_HINT } from "../copy/longOperationCopy";

/**
 * Full-screen blocking overlay for indeterminate long-running operations
 * (sync capture, export, etc.). Matches SyncProgressOverlay card styling.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} props.title
 * @param {string} [props.hint]
 */
export default function OperationInProgressOverlay({
  open,
  title,
  hint = LONG_OPERATION_KEEP_OPEN_HINT,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="operation-progress-title"
      aria-busy="true"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md animate-dropdown-enter rounded-ui border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-4 py-2">
          <Loader2 className="h-10 w-10 animate-spin text-indigo-600 dark:text-indigo-400" />
          <div className="space-y-2 text-center">
            <h2
              id="operation-progress-title"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {title}
            </h2>
            {hint ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">{hint}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
