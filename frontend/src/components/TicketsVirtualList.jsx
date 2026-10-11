import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Ticket } from "lucide-react";
import ContextMenu from "./ContextMenu";
import CaseRowLabel from "./CaseRowLabel";
import RepositoryCaseListHeader from "./RepositoryCaseListHeader";
import SidebarRow from "./SidebarRow";
import { treeRowHoverFullWidthClass, treeRowSelectedFullWidthClass } from "./SidebarSection";
import {
  CASE_ROW_ESTIMATE_PX,
  VIRTUAL_CASE_LIST_OVERSCAN,
  VIRTUAL_CASE_LIST_THRESHOLD,
} from "../constants/virtualCaseList";
import { browseColumnNoSelect, flexFillScroll } from "../utils/layoutClasses";

const LOAD_MORE_THRESHOLD_PX = 240;

function TicketListRow({ ticket, isSelected, onSelect, onContextMenu }) {
  return (
    <li>
      <div
        className={`flex min-w-0 w-full select-none ${
          isSelected ? treeRowSelectedFullWidthClass : treeRowHoverFullWidthClass
        }`}
        onMouseDown={(e) => {
          if (e.button !== 0) e.preventDefault();
        }}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, ticket) : undefined}
      >
        <div className="min-w-0 flex-1 px-1">
          <SidebarRow
            selected={isSelected}
            selectionOnParent
            expandIcon="none"
            icon={<Ticket className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />}
            label={
              <CaseRowLabel title={ticket.title} caseId={ticket.ticket_id} />
            }
            onClick={() => onSelect?.(ticket)}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * Virtual-scrolled flat ticket list matching RepositoryVirtualCaseList chrome.
 */
function TicketsVirtualList({
  tickets = [],
  total = null,
  loading = false,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  selectedTicketFilePath = null,
  onSelectTicket,
  emptyMessage = "No tickets",
  listTitle = "Tickets",
  onNewTicket,
}) {
  const scrollRef = useRef(null);
  const loadMoreLockRef = useRef(false);
  const [contextMenu, setContextMenu] = useState(null);

  const shouldVirtualize = tickets.length >= VIRTUAL_CASE_LIST_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: tickets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CASE_ROW_ESTIMATE_PX,
    overscan: VIRTUAL_CASE_LIST_OVERSCAN,
    enabled: shouldVirtualize && tickets.length > 0,
  });

  const tryLoadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore || !onLoadMore) return;
    if (loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;
    Promise.resolve(onLoadMore()).finally(() => {
      loadMoreLockRef.current = false;
    });
  }, [hasMore, loading, loadingMore, onLoadMore]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - LOAD_MORE_THRESHOLD_PX) {
      tryLoadMore();
    }
  }, [tryLoadMore]);

  useEffect(() => {
    if (!loadingMore) loadMoreLockRef.current = false;
  }, [loadingMore]);

  const rangeLabel = useMemo(() => {
    if (typeof total !== "number") return null;
    if (total === 0) return "0";
    return `${tickets.length} / ${total}`;
  }, [tickets.length, total]);

  const contextMenuItems = useMemo(() => [], []);

  return (
    <div className={`flex h-full min-h-0 flex-col ${browseColumnNoSelect}`}>
      <RepositoryCaseListHeader
        title={listTitle}
        rangeLabel={rangeLabel}
        loadingMore={loadingMore}
        onNewCase={onNewTicket}
        newCaseTooltip="New ticket"
        newCaseDisabled={!onNewTicket}
      />
      <div ref={scrollRef} className={flexFillScroll} onScroll={handleScroll}>
        {loading && tickets.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading…
          </p>
        ) : tickets.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {emptyMessage}
          </p>
        ) : shouldVirtualize ? (
          <ul
            className="relative m-0 list-none px-1 py-1"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((vRow) => {
              const ticket = tickets[vRow.index];
              return (
                <div
                  key={ticket.file_path || vRow.key}
                  className="absolute left-0 top-0 w-full"
                  style={{
                    height: `${vRow.size}px`,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <TicketListRow
                    ticket={ticket}
                    isSelected={selectedTicketFilePath === ticket.file_path}
                    onSelect={onSelectTicket}
                    onContextMenu={(e, row) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, ticket: row });
                    }}
                  />
                </div>
              );
            })}
          </ul>
        ) : (
          <ul className="m-0 list-none space-y-0 px-1 py-1">
            {tickets.map((ticket) => (
              <TicketListRow
                key={ticket.file_path}
                ticket={ticket}
                isSelected={selectedTicketFilePath === ticket.file_path}
                onSelect={onSelectTicket}
                onContextMenu={(e, row) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, ticket: row });
                }}
              />
            ))}
          </ul>
        )}
      </div>
      {contextMenu && contextMenuItems.length > 0 ? (
        <ContextMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={contextMenuItems}
        />
      ) : null}
    </div>
  );
}

export default TicketsVirtualList;
