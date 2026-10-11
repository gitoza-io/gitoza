import { useEffect, useState } from "react";
import { MetadataFieldRead } from "./MetadataField";
import { resolveTicketById } from "../utils/ticketLinks";
import Tooltip from "./Tooltip";

/**
 * Read-only metadata chip for a soft ticket-id link (parent, requirement, etc.).
 * Resolved + onOpenTicket: clickable indigo link. Unresolved: amber text.
 */
export default function TicketIdChip({
  label = "Parent",
  ticketId = "",
  repoSlug = null,
  onOpenTicket = null,
  showLabel = true,
}) {
  const [row, setRow] = useState(undefined);
  const id = (ticketId || "").trim();

  useEffect(() => {
    if (!id || !repoSlug) {
      setRow(null);
      return undefined;
    }
    let cancelled = false;
    resolveTicketById(repoSlug, id).then((r) => {
      if (!cancelled) setRow(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id, repoSlug]);

  if (!id) return null;

  const resolved = row && row.file_path;
  const loading = row === undefined;

  let content;
  if (resolved && onOpenTicket) {
    content = (
      <Tooltip label={row.title || id} placement="bottom">
        <span className="inline-flex">
          <button
            type="button"
            onClick={() => onOpenTicket(row)}
            className="font-mono text-xs text-indigo-600 underline decoration-indigo-400/60 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            {id}
          </button>
        </span>
      </Tooltip>
    );
  } else {
    const span = (
      <span
        className={`font-mono text-xs ${
          loading ? "text-slate-400" : "text-amber-700 dark:text-amber-400"
        }`}
      >
        {id}
      </span>
    );
    content =
      !loading && !resolved ? (
        <Tooltip label={`Unresolved ticket: ${id}`} placement="bottom">
          <span className="inline-flex">{span}</span>
        </Tooltip>
      ) : (
        span
      );
  }

  if (showLabel) {
    return <MetadataFieldRead label={label}>{content}</MetadataFieldRead>;
  }
  return content;
}
