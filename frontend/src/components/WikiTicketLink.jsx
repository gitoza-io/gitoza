import { useEffect, useState } from "react";
import { resolveTicketById } from "../utils/ticketLinks";
import Tooltip from "./Tooltip";

/**
 * Clickable [[ticket_id]] link; resolves lazily and styles unresolved targets.
 */
export default function WikiTicketLink({
  ticketId,
  label = null,
  repoSlug = null,
  onOpenTicket = null,
}) {
  const [row, setRow] = useState(undefined); // undefined = loading, null = missing
  const id = (ticketId || "").trim();
  const display = (label || "").trim() || id;

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

  if (!onOpenTicket || !resolved) {
    const tip =
      loading || resolved ? null : `Unresolved ticket: ${id}`;
    const span = (
      <span
        className={`font-mono text-[0.9em] ${
          loading
            ? "text-slate-400"
            : "text-amber-700 underline decoration-dotted dark:text-amber-400"
        }`}
      >
        {display}
      </span>
    );
    if (!tip) return span;
    return (
      <Tooltip label={tip} placement="bottom">
        <span className="inline-flex">{span}</span>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={row.title || id} placement="bottom">
      <span className="inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onOpenTicket(row);
          }}
          className="font-mono text-[0.9em] text-indigo-600 underline decoration-indigo-400/60 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {display}
        </button>
      </span>
    </Tooltip>
  );
}
