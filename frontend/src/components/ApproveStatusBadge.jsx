import { BADGE_BASE_CLASS } from "../constants/uiRadius";

/**
 * Single source of truth for approval status (Draft / Approved / Rejected):
 * normalization, labels, and badge styling. Use this component everywhere
 * approve_status is displayed to avoid duplication and inconsistency.
 *
 * For runs, the "draft" state (execution done, not yet reviewed) is shown as "Pending review"
 * instead of "Draft". For cases, "Draft" remains (case not yet finalized).
 */

const APPROVE_STATUS_COLORS = {
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  draft: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
};

const APPROVE_STATUS_LABELS = {
  approved: "Approved",
  rejected: "Rejected",
  draft: "Draft",
};

/** Label for run when approve_status is draft: execution done, awaiting review. */
export const RUN_PENDING_REVIEW_LABEL = "Pending review";

/**
 * Normalizes raw approve_status (e.g. from API) to one of approved | rejected | draft.
 * @param {string} [status]
 * @returns {"approved" | "rejected" | "draft"}
 */
export function normalizeApproveStatus(status) {
  const s = (status || "draft").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "draft";
}

/**
 * Returns { key, label, className } for the given approve_status.
 * Use when you need the label or className without rendering the badge.
 * @param {string} [status]
 * @param {"run" | "case"} [entityType] - When "run" and status is draft, label is "Pending review".
 */
export function getApproveStatusDisplay(status, entityType) {
  const key = normalizeApproveStatus(status);
  const label =
    entityType === "run" && key === "draft"
      ? RUN_PENDING_REVIEW_LABEL
      : APPROVE_STATUS_LABELS[key];
  return {
    key,
    label,
    className: APPROVE_STATUS_COLORS[key] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
}

/**
 * Renders a small badge for approve_status (Draft / Approved / Rejected).
 * @param {{ status?: string; entityType?: "run" | "case"; reviewEnabled?: boolean }} props
 */
export default function ApproveStatusBadge({ status, entityType, reviewEnabled = true }) {
  if (!reviewEnabled) return null;
  const { label, className } = getApproveStatusDisplay(status, entityType);
  return (
    <span className={`${BADGE_BASE_CLASS} ${className}`}>
      {label}
    </span>
  );
}
