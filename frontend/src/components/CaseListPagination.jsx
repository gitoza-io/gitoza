import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildPaginationSequence } from "../utils/paginateList";

/**
 * Compact pagination controls for the case list column footer.
 */
function CaseListPagination({ page, totalPages, onPageChange, disabled = false }) {
  if (totalPages <= 1) return null;

  const sequence = buildPaginationSequence(page, totalPages);

  return (
    <nav
      className="flex shrink-0 items-center justify-center gap-1 border-t border-slate-200 px-2 py-2 dark:border-slate-700"
      aria-label="Case list pagination"
    >
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {sequence.map((entry, idx) =>
        entry === "ellipsis" ? (
          <span key={`e-${idx}`} className="px-1 text-xs text-slate-400">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            disabled={disabled}
            onClick={() => onPageChange(entry)}
            className={`min-w-[1.75rem] rounded px-1.5 py-0.5 text-xs font-medium tabular-nums transition ${
              entry === page
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
            aria-label={`Page ${entry}`}
            aria-current={entry === page ? "page" : undefined}
          >
            {entry}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

export default CaseListPagination;
