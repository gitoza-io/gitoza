import Tooltip from "./Tooltip";
import { changeStatusLabel } from "../utils/confirmChangesFileStatus";

const STATUS_STYLES = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  M: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  R: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  D: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
};

/**
 * Git staged-change badge for Confirm Changes case rows (A / M / R / D).
 */
export default function ChangeStatusBadge({ status, path: _path, oldPath: _oldPath = null }) {
  const letter = (status || "M").toUpperCase();
  const style = STATUS_STYLES[letter] ?? STATUS_STYLES.M;
  const label = changeStatusLabel(letter);

  return (
    <Tooltip label={label} placement="bottom">
      <span
        className={`pointer-events-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[10px] font-semibold leading-none tabular-nums ${style}`}
        aria-label={label}
      >
        {letter}
      </span>
    </Tooltip>
  );
}
