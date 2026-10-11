import { ArrowUpDown, Search } from "lucide-react";
import Tooltip from "./Tooltip";
import { TOOLBAR_BTN_BASE } from "../constants/toolbarStyles";

const TAB_BASE =
  "px-2 py-1.5 text-sm font-medium transition border-b-2 border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";
const TAB_ACTIVE =
  "text-slate-900 dark:text-slate-100 relative after:content-[''] after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-9 after:-translate-x-1/2 after:bg-slate-900 dark:after:bg-slate-100";
/** Icon-only tab: aligned with section title; active uses underline. */
const TAB_ICON_ONLY_BASE =
  "border-b-2 border-transparent h-7 w-7 p-0 text-sm transition text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";
const TAB_ICON_ONLY_ACTIVE =
  "relative text-slate-900 dark:text-slate-100 after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-6 after:-translate-x-1/2 after:bg-slate-900 dark:after:bg-slate-100";

/**
 * Unified tree/sidebar toolbar: Outlook-style layout.
 * Left: optional tabs (e.g. Test Run | Test Case). Right: sort, search slots + extra actions.
 * Use the same component on Dashboard, Review, Test Run, Test Repository for consistent UX.
 *
 * @param {{
 *   tabs?: { id: string; label: string; icon?: React.ReactNode; iconOnly?: boolean }[];
 *   activeTabId?: string;
 *   onTabChange?: (id: string) => void;
 *   leftExtra?: React.ReactNode;
 *   addButton?: React.ReactNode;
 *   sortButton?: React.ReactNode;
 *   searchNode?: React.ReactNode | null; — pass `null` to hide the default search button
 *   extraActions?: React.ReactNode;
 *   trailingActions?: React.ReactNode;
 *   onBeforeAction?: () => void;
 * }} props
 */
function TreeToolbar({
  tabs,
  activeTabId,
  onTabChange,
  leftExtra,
  addButton,
  sortButton,
  searchNode,
  extraActions,
  trailingActions,
  onBeforeAction,
}) {
  const hasTabs = Array.isArray(tabs) && tabs.length > 0;

  const defaultSort = (
    <Tooltip label="Sort" placement="bottom">
      <button type="button" className={TOOLBAR_BTN_BASE} disabled aria-label="Sort (not yet implemented)">
        <ArrowUpDown className="h-4 w-4" />
      </button>
    </Tooltip>
  );
  const defaultSearch = (
    <Tooltip label="Search" placement="bottom">
      <button type="button" className={TOOLBAR_BTN_BASE} disabled aria-label="Search (not yet implemented)">
        <Search className="h-4 w-4" />
      </button>
    </Tooltip>
  );

  const beforeAction = onBeforeAction ?? undefined;

  const iconGroup = (
    <div className="flex shrink-0 items-center gap-1">
      {addButton != null && <div className="shrink-0" onClickCapture={beforeAction}>{addButton}</div>}
      {sortButton !== undefined
        ? <div className="shrink-0" onClickCapture={beforeAction}>{sortButton}</div>
        : <div className="shrink-0" onClickCapture={beforeAction}>{defaultSort}</div>}
      {searchNode !== undefined ? searchNode : defaultSearch}
      {extraActions != null && <div className="flex items-center gap-1 pl-1" onClickCapture={beforeAction}>{extraActions}</div>}
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={`flex min-w-0 flex-1 items-center gap-3 ${hasTabs ? "pl-4" : ""}`}>
        {hasTabs && (
          <div className="flex items-center gap-0.5" role="tablist" aria-label="View mode" onClickCapture={beforeAction}>
            {tabs.map((tab) => {
              const isActive = activeTabId === tab.id;
              if (tab.iconOnly && tab.icon != null) {
                return (
                  <Tooltip key={tab.id} label={tab.label} placement="bottom">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-label={tab.label}
                      onClick={() => onTabChange?.(tab.id)}
                      className={`${TAB_ICON_ONLY_BASE} ${isActive ? TAB_ICON_ONLY_ACTIVE : ""} flex items-center justify-center`}
                    >
                      {tab.icon}
                    </button>
                  </Tooltip>
                );
              }
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onTabChange?.(tab.id)}
                  className={`${TAB_BASE} ${isActive ? TAB_ACTIVE : ""} flex items-center gap-1.5`}
                >
                  {tab.icon != null && tab.icon}
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
        {leftExtra != null && <div className="shrink-0">{leftExtra}</div>}
      </div>
      {iconGroup}
      {trailingActions != null ? (
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
          {trailingActions}
        </div>
      ) : (
        <div className="min-w-0 flex-1" aria-hidden="true" />
      )}
    </div>
  );
}

export default TreeToolbar;
