import { AlertTriangle, Loader2 } from "lucide-react";

const CONTAINER_CLASS = "rounded-ui border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300";
const CONTAINER_EMPTY_CLASS = "rounded-ui border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900/70";
const CONTAINER_LOADING_HINT_CLASS = `${CONTAINER_CLASS} p-8 text-center`;

/**
 * Page-level message for loading, empty (no data), or hint (e.g. select workspace).
 * Single source for layout, rounded corners (rounded-ui), and accessibility.
 *
 * @param {{ variant: "loading" | "empty" | "hint"; title?: string; description?: string; icon?: React.ReactNode }} props
 * - variant: "loading" (spinner + optional title), "empty" (icon + title + description), "hint" (optional icon + title/description)
 * - title: main text (or message for loading/hint when description not used)
 * - description: secondary text (empty/hint)
 * - icon: override default icon per variant (loading default: Loader2, empty: AlertTriangle, hint: none)
 */
export default function PageMessage({ variant, title, description, icon }) {
  const isLoading = variant === "loading";
  const isEmpty = variant === "empty";
  const isHint = variant === "hint";

  if (isLoading) {
    const spinner = icon ?? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-500 dark:text-slate-400" aria-hidden="true" />;
    return (
      <div
        className={CONTAINER_LOADING_HINT_CLASS}
        role="status"
        aria-live="polite"
        aria-label={title || "Loading"}
      >
        {spinner}
        {title && <p className="mt-2 text-sm">{title}</p>}
      </div>
    );
  }

  if (isEmpty) {
    const DefaultIcon = AlertTriangle;
    const IconNode = icon ?? <DefaultIcon className="mx-auto h-7 w-7 text-slate-500 dark:text-slate-400" aria-hidden="true" />;
    return (
      <div className={CONTAINER_EMPTY_CLASS}>
        {IconNode}
        {title && <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
    );
  }

  // hint: optional icon, title and/or description
  const hintContent = description ? (
    <>
      {title && <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>}
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </>
  ) : (
    <p>{title}</p>
  );
  return (
    <div className={CONTAINER_LOADING_HINT_CLASS}>
      {icon && <span className="mb-2 block" aria-hidden="true">{icon}</span>}
      {hintContent}
    </div>
  );
}
