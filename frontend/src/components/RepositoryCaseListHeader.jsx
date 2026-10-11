import { FilePlus2, Loader2 } from "lucide-react";
import Tooltip from "./Tooltip";

/**
 * Header for the Test Repository case list column.
 */
function RepositoryCaseListHeader({
  title = null,
  rangeLabel = null,
  loadingMore = false,
  selectionLabel = null,
  onNewCase,
  newCaseDisabled = false,
  newCaseTooltip = "New test case",
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
      <div className="min-w-0 flex-1">
        {title ? (
          <p className="truncate text-sm font-semibold text-ink dark:text-slate-100">{title}</p>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Cases</p>
        )}
        {rangeLabel || loadingMore ? (
          <p className="flex items-center gap-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {rangeLabel ? <span>{rangeLabel}</span> : null}
            {loadingMore ? (
              <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Loading more…
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {selectionLabel ? (
        <span className="shrink-0 text-xs tabular-nums text-indigo-600 dark:text-indigo-400">
          {selectionLabel}
        </span>
      ) : null}
      {onNewCase ? (
        <Tooltip label={newCaseTooltip} placement="bottom">
          <button
            type="button"
            onClick={onNewCase}
            disabled={newCaseDisabled}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label={newCaseTooltip}
          >
            <FilePlus2 className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

export default RepositoryCaseListHeader;
