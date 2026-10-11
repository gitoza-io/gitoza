import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, X } from "lucide-react";

/**
 * Minimal app toast (no external dependency).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.message]
 * @param {() => void} props.onClose
 * @param {number} [props.durationMs]
 */
export default function IndexSuccessToast({
  open,
  message = "Workspace reindexed",
  onClose,
  durationMs = 3000,
}) {
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => onClose?.(), durationMs);
    return () => window.clearTimeout(t);
  }, [open, durationMs, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[220]">
      <div
        className="flex max-w-sm items-start gap-3 rounded-ui border border-slate-200 bg-white px-4 py-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="status"
        aria-live="polite"
      >
        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {message}
          </div>
          <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Your tree and case list have been refreshed.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

