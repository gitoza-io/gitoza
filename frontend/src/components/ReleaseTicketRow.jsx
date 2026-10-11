import CaseRowLabel from "./CaseRowLabel";
import SidebarRow from "./SidebarRow";
import { TicketTypeIcon } from "./TestEntityIcons";
import {
  TreeRowGuides,
  TREE_ROW_CONTENT_GAP,
  treeRowHoverFullWidthClass,
  treeRowSelectedFullWidthClass,
} from "./SidebarSection";

/**
 * Single ticket row in ReleaseNavigatorTree (virtual list compatible).
 */
function ReleaseTicketRow({
  ticket,
  effectiveLevel = 0,
  isSelected = false,
  onSelect,
  rowRef,
  as: Root = "li",
}) {
  const gap = TREE_ROW_CONTENT_GAP;
  const ticketType = ticket.type ?? ticket.ticket_type ?? "task";

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
            icon={<TicketTypeIcon type={ticketType} />}
            label={<CaseRowLabel title={ticket.title} caseId={ticket.ticket_id} />}
            onClick={() => onSelect?.(ticket)}
          />
        </div>
      </div>
    </Root>
  );
}

export default ReleaseTicketRow;
