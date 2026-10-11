import CaseRowLabel from "./CaseRowLabel";
import InlineRenameConflictAlert from "./InlineRenameConflictAlert";
import InlineRenameInput from "./InlineRenameInput";
import { treeRowHoverFullWidthClass, treeRowSelectedFullWidthClass } from "./SidebarSection";
import SidebarRow from "./SidebarRow";
import { TestCaseIcon } from "./TestEntityIcons";

/**
 * Flat case row for RepositoryCaseList (no tree indent or guide lines).
 */
function CaseListRow({
  caseRow: c,
  multiSelectActive = false,
  isSelected = false,
  isRenamingCase = false,
  dragPaths = [],
  isDragSource = false,
  onCaseRowClick,
  onSelectCase,
  onCaseRenameCommit,
  onCaseRenameValueChange,
  renameConflictName = null,
  onContextMenuCase,
  onCaseRowPointerDown,
  pickerMode = false,
  checked = false,
  onToggleCase,
  pickerDisabled = false,
  rowRight = null,
  rowDeleted = false,
  as: Root = "li",
}) {
  const titleShort =
    c.title && c.title.length > 48 ? `${c.title.slice(0, 48)}…` : (c.title ?? "");

  return (
    <Root>
      <div
        className={`flex min-w-0 w-full select-none ${
          isDragSource
            ? "opacity-60 ring-2 ring-indigo-400/80 ring-offset-1 ring-offset-white dark:ring-indigo-500/70 dark:ring-offset-slate-950"
            : isSelected
              ? treeRowSelectedFullWidthClass
              : treeRowHoverFullWidthClass
        }`}
        style={multiSelectActive && !isRenamingCase ? { touchAction: "none" } : undefined}
        onMouseDown={(e) => {
          if (!isRenamingCase && e.button !== 0) e.preventDefault();
        }}
        onContextMenu={
          onContextMenuCase && !isRenamingCase ? (e) => onContextMenuCase(e, c) : undefined
        }
        onPointerDown={
          multiSelectActive && !isRenamingCase
            ? (e) =>
                onCaseRowPointerDown?.(e, {
                  paths: dragPaths,
                  summaryLine:
                    dragPaths.length > 1
                      ? `${dragPaths.length} test cases`
                      : titleShort || c.case_id || "Untitled",
                  detailLine:
                    dragPaths.length > 1
                      ? "Drop on a project or suite folder"
                      : c.case_id || undefined,
                })
            : undefined
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 px-1">
          {pickerMode ? (
            <input
              type="checkbox"
              checked={checked}
              disabled={pickerDisabled}
              onChange={(e) => {
                e.stopPropagation();
                onToggleCase?.(c.file_path);
              }}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
            />
          ) : null}
          <div className="min-w-0 flex-1">
          {isRenamingCase && onCaseRenameCommit ? (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2 py-0.5">
                <TestCaseIcon />
                <InlineRenameInput
                  initialValue={c.case_id ?? ""}
                  placeholder="Case ID…"
                  onCommit={(val) => onCaseRenameCommit(c, val)}
                  onValueChange={onCaseRenameValueChange}
                />
              </div>
              {renameConflictName ? (
                <InlineRenameConflictAlert name={renameConflictName} />
              ) : null}
            </div>
          ) : (
            <SidebarRow
              selected={isSelected}
              selectionOnParent
              icon={<TestCaseIcon />}
              label={
                <CaseRowLabel title={c.title} caseId={c.case_id} deleted={rowDeleted} />
              }
              right={rowRight}
              onClick={(e) =>
                multiSelectActive && onCaseRowClick ? onCaseRowClick(c, e) : onSelectCase?.(c)
              }
            />
          )}
          </div>
        </div>
      </div>
    </Root>
  );
}

export default CaseListRow;
