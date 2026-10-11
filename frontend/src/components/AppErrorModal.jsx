import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";

/**
 * App-wide blocking error modal (replacement for the sticky top banner).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.title]
 * @param {string} [props.message]
 * @param {string} [props.dismissLabel]
 * @param {() => void} props.onDismiss
 */
export default function AppErrorModal({
  open,
  title = "Something went wrong",
  message = "",
  dismissLabel = "Dismiss",
  onDismiss,
}) {
  const dismissRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss?.();
      }
    };
    document.addEventListener("keydown", onKey);
    queueMicrotask(() => dismissRef.current?.focus());
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="app-error-title"
      aria-describedby="app-error-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss?.();
      }}
    >
      <div
        className="w-full min-w-0 max-w-md animate-dropdown-enter overflow-hidden rounded-ui border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="app-error-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            <p
              id="app-error-desc"
              className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-sm text-slate-700 dark:text-slate-300"
            >
              {message || "An unexpected error occurred."}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            ref={dismissRef}
            onClick={onDismiss}
            className="rounded-ui bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            {dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

