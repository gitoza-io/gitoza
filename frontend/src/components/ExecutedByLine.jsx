import { relativeTime } from "../utils/relativeTime";

/**
 * "Executed by {name} · {time}" for a test case within a run.
 *
 * @param {{ executedAt?: string | null; executedBy?: string | null; className?: string }} props
 */
function ExecutedByLine({ executedAt, executedBy, className = "" }) {
  if (!executedAt && !executedBy) return null;

  return (
    <span className={`text-xs text-slate-400 dark:text-slate-500 ${className}`}>
      {executedBy && executedAt ? (
        <>
          Executed by{" "}
          <span className="font-medium text-slate-600 dark:text-slate-400">{executedBy}</span>
          {" · "}
          {relativeTime(executedAt)}
        </>
      ) : executedBy ? (
        <>
          Executed by{" "}
          <span className="font-medium text-slate-600 dark:text-slate-400">{executedBy}</span>
        </>
      ) : (
        <>Executed {relativeTime(executedAt)}</>
      )}
    </span>
  );
}

export default ExecutedByLine;
