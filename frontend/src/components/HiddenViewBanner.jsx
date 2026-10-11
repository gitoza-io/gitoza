import Tooltip from "./Tooltip";

const BANNER_CLASS =
  "w-full shrink-0 border-b border-amber-200 bg-amber-100 px-2 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/50 dark:text-amber-200";

/**
 * Banner strip for "hidden" views (Archived cases, Archived runs).
 * Uses the same amber styling as the Archived badge for consistency.
 *
 * @param {{ label: string; tooltip?: string }} props
 */
function HiddenViewBanner({ label, tooltip }) {
  const content = (
    <div className={BANNER_CLASS}>
      {label}
    </div>
  );
  if (tooltip) {
    return (
      <Tooltip label={tooltip} placement="bottom">
        {content}
      </Tooltip>
    );
  }
  return content;
}

export default HiddenViewBanner;
