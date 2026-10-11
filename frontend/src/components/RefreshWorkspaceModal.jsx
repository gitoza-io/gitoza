import { Loader2, RefreshCw, Wrench, X } from "lucide-react";

import { LONG_OPERATION_KEEP_OPEN_HINT } from "../copy/longOperationCopy";

/**
 * Modal chooser for workspace refresh options.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {boolean} props.loading
 * @param {string} [props.loadingTitle]
 * @param {string|null} props.error
 * @param {() => void} props.onIncremental
 * @param {() => void} props.onFullReindex
 * @param {boolean} props.readOnly
 */
export default function RefreshWorkspaceModal({
  open,
  onClose,
  loading = false,
  loadingTitle = "Refreshing workspace…",
  error = null,
  onIncremental,
  onFullReindex,
  readOnly = false,
}) {
  if (!open) return null;

  const disabled = loading || readOnly;

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refresh-workspace-title"
      aria-busy={loading}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose?.();
      }}
    >
      <div
        className="w-full min-w-0 max-w-md animate-dropdown-enter overflow-hidden rounded-ui border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2
              id="refresh-workspace-title"
              className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              Refresh Workspace
            </h2>
            {!loading ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Update the local cache from external file changes in your workspace.
              </p>
            ) : null}
          </div>
          {!loading ? (
            <button
              type="button"
              onClick={onClose}
              className="ml-3 rounded p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="space-y-4 px-6 py-5">
          {error ? (
            <div className="max-h-48 overflow-y-auto break-all rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <Loader2 className="h-10 w-10 animate-spin text-indigo-600 dark:text-indigo-400" />
              <div className="space-y-2 text-center">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {loadingTitle}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {LONG_OPERATION_KEEP_OPEN_HINT}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={onIncremental}
                disabled={disabled}
                className="w-full rounded-ui bg-indigo-600 px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
              >
                <div className="flex items-start gap-3">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-white/90" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span>Incremental Refresh</span>
                    </div>
                    <p className="mt-1 text-xs font-normal text-white/80">
                      Fast refresh from changed files (recommended).
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={onFullReindex}
                disabled={disabled}
                className="w-full rounded-ui border border-slate-300 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-900 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <div className="flex items-start gap-3">
                  <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span>Force Full Reindex</span>
                      <span className="rounded-ui bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        Repair
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-normal text-slate-600 dark:text-slate-400">
                      Wipes and rebuilds the local database cache. May take several seconds on large repositories.
                    </p>
                    <p className="mt-1 text-xs font-normal text-slate-500 dark:text-slate-500">
                      Cases, tickets, and wiki.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
