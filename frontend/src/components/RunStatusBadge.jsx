import { getRunStatusDisplay } from "../constants/runStatus";
import { ROUNDED_UI } from "../constants/uiRadius";

const BADGE_CLASS = `inline-flex shrink-0 ${ROUNDED_UI} px-1.5 py-0.5 text-[10px] font-medium`;

/**
 * Badge for test run status (Not started / In progress / Completed).
 * Uses shared labels and styles from constants/runStatus.
 *
 * @param {{ status?: string }} props - status from run.status (e.g. not_started, in_progress, completed).
 */
export default function RunStatusBadge({ status }) {
  const { label, className } = getRunStatusDisplay(status);
  return <span className={`${BADGE_CLASS} ${className}`}>{label}</span>;
}
