/**
 * Unified case/ticket row label: prominent title, quieter secondary id.
 * Use in Test Repository (CaseTree), Test Run (RunCaseTree), RunSummaryPanel, Review, and Tickets
 * so all case/ticket rows share the same format and styling.
 *
 * @param {{ title?: string; caseId?: string; line1Extra?: React.ReactNode; deleted?: boolean; showCaseId?: boolean }} props
 *   - line1Extra: optional node after title on first line (e.g. ApproveStatusBadge in Review).
 *   - deleted: strikethrough + muted styling (Confirm Changes deleted cases).
 *   - showCaseId: when false, omit the secondary id line (e.g. Confirm Changes ticket rows).
 */
function CaseRowLabel({ title, caseId, line1Extra, deleted = false, showCaseId = true }) {
  const deletedClass = deleted
    ? "line-through text-slate-400 dark:text-slate-500"
    : "";
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`truncate text-sm font-medium leading-snug text-ink dark:text-slate-100 ${deletedClass}`}
        >
          {title || caseId || "Untitled"}
        </span>
        {line1Extra}
      </div>
      {showCaseId && caseId ? (
        <p
          className={`mt-px truncate text-[10px] leading-tight text-slate-600 dark:text-slate-400 ${deletedClass}`}
        >
          {caseId}
        </p>
      ) : null}
    </div>
  );
}

export default CaseRowLabel;
