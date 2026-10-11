import { relativeTime } from "../utils/relativeTime";

/**
 * "Added by {name} · {time}" for a pending test case within a run.
 *
 * @param {{ addedAt?: string | null; addedBy?: string | null; className?: string }} props
 */
function AddedByLine({ addedAt, addedBy, className = "" }) {
  if (!addedAt && !addedBy) return null;

  return (
    <span className={`text-xs text-slate-400 dark:text-slate-500 ${className}`}>
      {addedBy && addedAt ? (
        <>
          Added by{" "}
          <span className="font-medium text-slate-600 dark:text-slate-400">{addedBy}</span>
          {" · "}
          {relativeTime(addedAt)}
        </>
      ) : addedBy ? (
        <>
          Added by{" "}
          <span className="font-medium text-slate-600 dark:text-slate-400">{addedBy}</span>
        </>
      ) : (
        <>Added {relativeTime(addedAt)}</>
      )}
    </span>
  );
}

export default AddedByLine;
