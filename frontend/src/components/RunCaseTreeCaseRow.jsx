import CaseRowLabel from "./CaseRowLabel";
import { TreeRowGuides, TREE_ROW_CONTENT_GAP, treeRowSelectedFullWidthClass, treeRowHoverFullWidthClass } from "./SidebarSection";
import SidebarRow from "./SidebarRow";
import { TestCaseIcon } from "./TestEntityIcons";

/**
 * Single case row in RunCaseTree (extracted for VirtualCaseList reuse).
 *
 * @param {Object} props
 * @param {React.ReactNode} props.resultRight - CaseResultRight element
 */
function RunCaseTreeCaseRow({
  caseRow: c,
  effectiveLevel,
  isSelected = false,
  resultRight,
  multiSelectActive = false,
  onCaseRowClick,
  onSelectCase,
  onContextMenuCase,
  rowRef,
  as: Root = "li",
}) {
  const gap = TREE_ROW_CONTENT_GAP;

  return (
    <Root ref={rowRef}>
      <div
        className={`flex min-w-0 w-full ${isSelected ? treeRowSelectedFullWidthClass : treeRowHoverFullWidthClass}`}
      >
        <TreeRowGuides level={effectiveLevel + 1} />
        <div className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: `${gap}px` }}>
          <SidebarRow
            selected={isSelected}
            selectionOnParent
            icon={<TestCaseIcon />}
            label={<CaseRowLabel title={c.title} caseId={c.case_id} />}
            right={resultRight}
            onClick={(e) =>
              multiSelectActive && onCaseRowClick ? onCaseRowClick(c, e) : onSelectCase?.(c)
            }
            onContextMenu={(e) => onContextMenuCase?.(c, e)}
          />
        </div>
      </div>
    </Root>
  );
}

export default RunCaseTreeCaseRow;
