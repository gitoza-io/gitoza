/**
 * Section divider for grouped case list column: subsuite boundary + highlighted label.
 */
function CaseListSuiteHeader({ label, depth = 0 }) {
  if (!label) return null;
  return (
    <li role="separator" aria-label={`Suite: ${label}`} className="list-none">
      <div
        className="mt-1 flex items-center border-t border-slate-200 pt-1.5 dark:border-slate-700"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <span className="truncate text-xs font-semibold text-indigo-600 dark:text-indigo-400">
          {label}
        </span>
      </div>
    </li>
  );
}

export default CaseListSuiteHeader;
