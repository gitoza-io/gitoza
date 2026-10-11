import CaseRowLabel from "./CaseRowLabel";
import { CaseResultRight } from "./CaseResultButtons";
import { treeRowHoverFullWidthClass, treeRowSelectedFullWidthClass } from "./SidebarSection";
import SidebarRow from "./SidebarRow";
import { TestCaseIcon } from "./TestEntityIcons";

/**
 * Flat case row for RunPaginatedCaseList (no tree indent).
 */
function RunCaseListRow({
  caseRow: c,
  multiSelectActive = false,
  isSelected = false,
  onCaseRowClick,
  onSelectCase,
  onContextMenuCase,
  onSetResult,
  caseResultMode = "buttons",
  rowRight = null,
  as: Root = "li",
}) {
  const resultRight = (
    <span className="inline-flex shrink-0 items-center gap-1">
      {rowRight}
      <CaseResultRight
        result={c.result}
        filePath={c.file_path}
        onSetResult={onSetResult}
        caseResultMode={caseResultMode}
      />
    </span>
  );

  return (
    <Root>
      <div
        className={`flex min-w-0 w-full select-none ${
          isSelected ? treeRowSelectedFullWidthClass : treeRowHoverFullWidthClass
        }`}
        onMouseDown={(e) => {
          if (e.button !== 0) e.preventDefault();
        }}
        onContextMenu={
          onContextMenuCase ? (e) => onContextMenuCase(e, c) : undefined
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 px-1">
          <div className="min-w-0 flex-1">
            <SidebarRow
              selected={isSelected}
              selectionOnParent
              icon={<TestCaseIcon />}
              label={<CaseRowLabel title={c.title} caseId={c.case_id} />}
              right={resultRight}
              onClick={(e) =>
                multiSelectActive && onCaseRowClick
                  ? onCaseRowClick(c, e)
                  : onSelectCase?.(c)
              }
            />
          </div>
        </div>
      </div>
    </Root>
  );
}

export default RunCaseListRow;
