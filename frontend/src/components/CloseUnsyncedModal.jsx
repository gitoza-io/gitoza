import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Shown when the user tries to quit with local work not yet on the remote.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {boolean} [props.pushFailed] — failed publish after confirm
 * @param {() => void} props.onStay
 * @param {() => void} props.onGoToConfirm
 * @param {() => void} props.onCloseAnyway
 */
export default function CloseUnsyncedModal({
  open,
  pushFailed = false,
  onStay,
  onGoToConfirm,
  onCloseAnyway,
}) {
  const stayRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onStay?.();
      }
    };
    document.addEventListener("keydown", onKey);
    queueMicrotask(() => stayRef.current?.focus());
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onStay]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-unsynced-title"
      aria-describedby="close-unsynced-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) onStay?.();
      }}
    >
      <div
        className="w-full min-w-0 max-w-md animate-dropdown-enter overflow-hidden rounded-ui border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2
              id="close-unsynced-title"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              Changes not on remote
            </h2>
            <p
              id="close-unsynced-desc"
              className="mt-3 text-sm text-slate-600 dark:text-slate-400"
            >
              You have local changes that are not on the shared remote yet.
              {pushFailed
                ? " Publishing failed earlier — open Confirm Changes (or Sync) to try again before quitting."
                : " Confirm and push them if you want teammates to see them."}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            ref={stayRef}
            onClick={onStay}
            className="rounded-ui border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={onGoToConfirm}
            className="rounded-ui bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            Go to Confirm Changes
          </button>
          <button
            type="button"
            onClick={onCloseAnyway}
            className="rounded-ui bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            Close anyway
          </button>
        </div>
      </div>
    </div>
  );
}
