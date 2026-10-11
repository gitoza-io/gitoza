import { ChevronRight } from "lucide-react";
import { filePath2Breadcrumb } from "../utils/breadcrumb";

/**
 * Renders a tree-style breadcrumb from a case file path (e.g. auth > securechange > testnewnew).
 */
function CaseBreadcrumb({ filePath }) {
  const segments = filePath2Breadcrumb(filePath);
  if (segments.length === 0) return null;

  return (
    <nav className="flex min-w-0 items-center gap-1 text-xs text-slate-400 dark:text-slate-500" aria-label="Case location">
      {segments.map((seg, i) => (
        <span key={i} className="flex shrink-0 items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />}
          <span
            className={
              i === segments.length - 1
                ? "font-medium text-slate-500 dark:text-slate-400"
                : ""
            }
          >
            {seg}
          </span>
        </span>
      ))}
    </nav>
  );
}

export default CaseBreadcrumb;
