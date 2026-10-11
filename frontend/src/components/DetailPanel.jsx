import { flexFillHidden, flexFillScroll } from "../utils/layoutClasses";

/**
 * Shared right-side editor skeleton: optional header, scrollable body, optional footer.
 * Used by Dashboard, Test Repository, Test Run, and Review for a consistent layout.
 *
 * @param {React.ReactNode} [title] - Optional header title (e.g. run name, case title).
 * @param {React.ReactNode} [statusBadge] - Optional badge (e.g. Draft / Approved).
 * @param {() => void} [onClose] - Optional close handler; when set, shows a close button in header.
 * @param {React.ReactNode} [subtitle] - Optional line below title (e.g. description, "Last modified by …").
 * @param {React.ReactNode} [headerExtra] - Optional extra content (e.g. Edit), inline after title/status in the same row (not pushed to the far right).
 * @param {React.ReactNode} [footer] - Optional footer (e.g. Approve / Pass / Fail buttons).
 * @param {boolean} [bodyScroll=true] - If false, body does not scroll (content uses inner scroll only, e.g. Case edit).
 * @param {React.ReactNode} children - Main body content.
 */
function DetailPanel({
  title = null,
  statusBadge = null,
  onClose = null,
  subtitle = null,
  headerExtra = null,
  footer = null,
  bodyScroll = true,
  children,
}) {
  const hasHeader = title != null || statusBadge != null || onClose != null || subtitle != null || headerExtra != null;
  const bodyClass = bodyScroll ? flexFillScroll : flexFillHidden;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {hasHeader && (
        <header className="shrink-0 border-b border-slate-200 px-2 py-2 dark:border-slate-700">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              {(title != null || statusBadge != null || headerExtra != null) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  {title != null &&
                    (typeof title === "string" ? (
                      <h2 className="min-w-0 truncate text-base font-semibold text-ink dark:text-slate-100">
                        {title}
                      </h2>
                    ) : (
                      <div className="min-w-0 truncate text-base font-semibold text-ink dark:text-slate-100">
                        {title}
                      </div>
                    ))}
                  {statusBadge}
                  {headerExtra}
                </div>
              )}
              {subtitle != null && (
                <div className="mt-1 text-xs text-muted dark:text-slate-400">
                  {subtitle}
                </div>
              )}
            </div>
            {onClose != null && (
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        </header>
      )}
      <div className={`${bodyClass} flex flex-col px-2 py-2`}>
        {children}
      </div>
      {footer != null && (
        <footer className="shrink-0 border-t border-slate-200 px-2 py-2 dark:border-slate-700">
          {footer}
        </footer>
      )}
    </div>
  );
}

export default DetailPanel;
