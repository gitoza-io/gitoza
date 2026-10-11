import { relativeTime } from "../utils/relativeTime";

/**
 * Unified "Updated by {name} · {time}" display line.
 * Used in Case detail/editor, Run summary, and any future entity footers.
 *
 * @param {{ updatedAt?: string | null; updatedBy?: string | null; className?: string }} props
 */
function UpdatedByLine({ updatedAt, updatedBy, className = "" }) {
  if (!updatedAt && !updatedBy) return null;

  return (
    <span className={`text-xs text-slate-400 dark:text-slate-500 ${className}`}>
      {updatedBy && updatedAt ? (
        <>
          Updated by{" "}
          <span className="font-medium text-slate-600 dark:text-slate-400">{updatedBy}</span>
          {" · "}
          {relativeTime(updatedAt)}
        </>
      ) : updatedBy ? (
        <>
          Updated by{" "}
          <span className="font-medium text-slate-600 dark:text-slate-400">{updatedBy}</span>
        </>
      ) : (
        <>Updated {relativeTime(updatedAt)}</>
      )}
    </span>
  );
}

export default UpdatedByLine;
