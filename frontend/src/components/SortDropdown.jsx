import { useRef, useState } from "react";
import { ArrowUpDown, Check } from "lucide-react";
import Tooltip from "./Tooltip";
import ToolbarPopover from "./ToolbarPopover";
import { TOOLBAR_BTN_BASE } from "../constants/toolbarStyles";

/** Icon-only trigger button height/alignment is driven by `TOOLBAR_BTN_BASE`. */

/** Container for sort options (card radius, matches list vs card design). */
export const SORT_DROPDOWN_CONTAINER_CLASS =
  "rounded-ui bg-white p-1 shadow-lg ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700";

/** Base class for one sort option row: checkmark slot + label; hover = light bg + border. */
export const SORT_OPTION_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-ui border border-transparent px-2.5 py-1.5 text-left text-xs font-medium text-ink transition hover:bg-list-hover hover:border-slate-200 dark:text-slate-200 dark:hover:bg-slate-700/50 dark:hover:border-slate-600";

/** Width for checkmark slot so options align. */
const CHECK_SLOT_CLASS = "w-5 shrink-0 flex items-center justify-center";

/**
 * Reusable sort dropdown: one icon button, click opens a menu with options.
 * Selection indicated by checkmark; optional title row (e.g. "Sort by").
 * Uses ToolbarPopover (Portal) so it is never clipped by sticky rows or sidebar overflow.
 *
 * @param {{ options: { value: string, label: string }[]; value: string; onChange: (value: string) => void; ariaLabel?: string; title?: string; placement?: 'left' | 'right' }} props
 */
function SortDropdown({
  options = [],
  value,
  onChange,
  ariaLabel = "Sort",
  title,
  placement = "right",
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);

  return (
    <div className="relative inline-block" ref={triggerRef}>
      <Tooltip label="Sort" placement="bottom">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={TOOLBAR_BTN_BASE}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <ArrowUpDown className="h-4 w-4" />
        </button>
      </Tooltip>
      <ToolbarPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align={placement}
      >
        <div className={`${SORT_DROPDOWN_CONTAINER_CLASS} flex flex-col`} role="listbox" aria-label={ariaLabel}>
          {title != null && title !== "" && (
            <p className="border-b border-slate-100 px-2.5 py-1.5 text-xs font-medium text-muted dark:border-slate-700 dark:text-slate-400">
              {title}
            </p>
          )}
          {options.map((opt) => {
            const isActive = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={SORT_OPTION_ROW_CLASS}
              >
                <span className={CHECK_SLOT_CLASS} aria-hidden>
                  {isActive ? (
                    <Check className="h-4 w-4 text-ink dark:text-slate-100" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </ToolbarPopover>
    </div>
  );
}

export default SortDropdown;
