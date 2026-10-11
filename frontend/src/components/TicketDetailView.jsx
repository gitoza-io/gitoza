import { useEffect, useState } from "react";
import { renderMarkdown, priorityColors } from "./TestCaseDetailModal";
import UpdatedByLine from "./UpdatedByLine";
import { getTagColorClass } from "../utils/tagColor";
import { MetadataFieldRead } from "./MetadataField";
import { CustomFieldRead, sortCustomFieldEntries } from "./CaseCustomFields";
import TicketIdChip from "./TicketIdChip";
import { ChildTickets, LinkedCases, LinkedRuns } from "./TicketRelatedLists";
import { formatReleaseLabel, resolveReleaseById } from "../utils/releaseLinks";
import { formatTicketStatusLabel } from "../utils/ticketStatus";

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function ReleaseChip({ releaseId, repoSlug, onNavigateToRelease = null }) {
  const [row, setRow] = useState(undefined);
  const id = (releaseId || "").trim();

  useEffect(() => {
    if (!id || !repoSlug) {
      setRow(null);
      return undefined;
    }
    let cancelled = false;
    resolveReleaseById(repoSlug, id).then((r) => {
      if (!cancelled) setRow(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id, repoSlug]);

  if (!id) return null;

  const resolved = row && row.release_id;
  const loading = row === undefined;
  const label = resolved ? formatReleaseLabel(row) : id;

  let content;
  if (resolved && onNavigateToRelease) {
    content = (
      <button
        type="button"
        onClick={() => onNavigateToRelease(id)}
        className="text-xs text-indigo-600 underline decoration-indigo-400/60 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        {label}
      </button>
    );
  } else {
    content = (
      <span
        className={`text-xs ${
          loading
            ? "text-slate-400"
            : resolved
              ? "text-slate-800 dark:text-slate-100"
              : "font-mono text-amber-700 dark:text-amber-400"
        }`}
      >
        {label}
      </span>
    );
  }

  return <MetadataFieldRead label="Release">{content}</MetadataFieldRead>;
}

/**
 * Read-only ticket detail — same layout as CaseDetailView (header metadata + markdown body).
 */
function TicketDetailView({
  ticket,
  ticketIdRowExtra = null,
  scrollEndContent = null,
  repoSlug = null,
  onOpenTicket = null,
  onNavigateToCase = null,
  onNavigateToRun = null,
  onNavigateToRelease = null,
  onOpenWikiPage = null,
}) {
  if (!ticket) return null;

  const tags = ticket.tags ?? [];
  const customFieldEntries = sortCustomFieldEntries(ticket.params);
  const priorityKey = (ticket.priority || "").toLowerCase();
  const typeLabel = ticket.type || ticket.ticket_type || "task";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-slate-200 px-3 py-3 dark:border-slate-700">
        <h2 className="text-lg font-bold leading-snug text-slate-900 dark:text-slate-100">
          {ticket.title || "Untitled ticket"}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <div className="flex items-center gap-0.5">
            <span className="font-mono text-sm font-normal tracking-wide text-slate-800 dark:text-slate-100">
              {ticket.ticket_id || "—"}
            </span>
            {ticketIdRowExtra}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3">
        <div className="flex flex-wrap items-stretch gap-2">
          {typeLabel ? (
            <MetadataFieldRead label="Type" value={capitalize(typeLabel)} />
          ) : null}
          {ticket.status ? (
            <MetadataFieldRead label="Status" value={formatTicketStatusLabel(ticket.status)} />
          ) : null}
          {ticket.priority ? (
            <MetadataFieldRead
              label="Priority"
              value={capitalize(ticket.priority)}
              valueClassName={priorityColors[priorityKey] || "text-slate-900 dark:text-slate-100"}
            />
          ) : null}
          {ticket.assigned_to ? (
            <MetadataFieldRead label="Assigned to" value={ticket.assigned_to} />
          ) : null}
          {ticket.sprint ? (
            <MetadataFieldRead label="Sprint" value={ticket.sprint} />
          ) : null}
          {ticket.release ? (
            <ReleaseChip
              releaseId={ticket.release}
              repoSlug={repoSlug}
              onNavigateToRelease={onNavigateToRelease}
            />
          ) : null}
          {ticket.parent ? (
            <TicketIdChip
              label="Parent"
              ticketId={ticket.parent}
              repoSlug={repoSlug}
              onOpenTicket={onOpenTicket}
            />
          ) : null}
          {tags.length > 0 ? (
            <MetadataFieldRead label="Tags">
              <div className="flex flex-wrap items-center gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${getTagColorClass(tag)}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </MetadataFieldRead>
          ) : null}
          {customFieldEntries.map(([key, val]) => (
            <CustomFieldRead key={key} fieldKey={key} value={val} />
          ))}
        </div>
        <div className="mt-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          {ticket.body ? (
            <article className="prose-rex">
              {renderMarkdown(ticket.body, {
                repoSlug,
                enableWikiLinks: true,
                onWikiLinkClick: onOpenTicket,
                onWikiPageLinkClick: onOpenWikiPage,
              })}
            </article>
          ) : (
            <p className="py-4 text-center text-sm text-slate-400 dark:text-slate-500">
              No body content for this ticket.
            </p>
          )}
          <ChildTickets
            ticketId={ticket.ticket_id}
            repoSlug={repoSlug}
            onOpenTicket={onOpenTicket}
          />
          <LinkedCases
            ticketId={ticket.ticket_id}
            repoSlug={repoSlug}
            onNavigateToCase={onNavigateToCase}
          />
          <LinkedRuns
            ticketId={ticket.ticket_id}
            repoSlug={repoSlug}
            onNavigateToRun={onNavigateToRun}
          />
          {scrollEndContent ? <div className="mt-6">{scrollEndContent}</div> : null}
        </div>
      </div>

      {ticket.updated_at || ticket.updated_by ? (
        <footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
          <UpdatedByLine updatedAt={ticket.updated_at} updatedBy={ticket.updated_by} />
        </footer>
      ) : null}
    </div>
  );
}

export default TicketDetailView;
