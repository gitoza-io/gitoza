import { useEffect, useMemo, useState } from "react";
import { resolveTicketById } from "../utils/ticketLinks";
import Tooltip from "./Tooltip";

/**
 * Read-only list of ticket soft-links: mono ID + title.
 * Resolved + onOpenTicket: clickable. Unresolved: amber non-clickable ID.
 */
export default function TicketIdTitleList({
  ticketIds = [],
  repoSlug = null,
  onOpenTicket = null,
}) {
  const ids = useMemo(
    () =>
      (Array.isArray(ticketIds) ? ticketIds : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    [ticketIds],
  );
  const idsKey = ids.join("\0");

  /** @type {[{ id: string, row: object|null|undefined }]} */
  const [entries, setEntries] = useState(() =>
    ids.map((id) => ({ id, row: undefined })),
  );

  useEffect(() => {
    if (ids.length === 0 || !repoSlug) {
      setEntries(ids.map((id) => ({ id, row: null })));
      return undefined;
    }
    let cancelled = false;
    setEntries(ids.map((id) => ({ id, row: undefined })));
    Promise.all(ids.map((id) => resolveTicketById(repoSlug, id))).then((rows) => {
      if (cancelled) return;
      setEntries(ids.map((id, i) => ({ id, row: rows[i] ?? null })));
    });
    return () => {
      cancelled = true;
    };
    // idsKey stands in for ids content; avoid re-resolve on array identity churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, repoSlug]);

  if (ids.length === 0) return null;

  return (
    <ul className="mt-1 space-y-1">
      {entries.map(({ id, row }) => {
        const resolved = row && row.file_path;
        const loading = row === undefined;

        if (resolved && onOpenTicket) {
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onOpenTicket(row)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="shrink-0 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                  {id}
                </span>
                <span className="truncate">{row.title || "Untitled"}</span>
              </button>
            </li>
          );
        }

        if (resolved) {
          return (
            <li key={id} className="rounded px-2 py-1 text-sm text-slate-800 dark:text-slate-200">
              <span className="font-mono text-xs text-slate-500">{id}</span>
              <span className="ml-2 truncate">{row.title || "Untitled"}</span>
            </li>
          );
        }

        const idSpan = (
          <span
            className={`font-mono text-xs ${
              loading ? "text-slate-400" : "text-amber-700 dark:text-amber-400"
            }`}
          >
            {id}
          </span>
        );

        return (
          <li key={id} className="rounded px-2 py-1">
            {!loading && !resolved ? (
              <Tooltip label={`Unresolved ticket: ${id}`} placement="bottom">
                <span className="inline-flex">{idSpan}</span>
              </Tooltip>
            ) : (
              idSpan
            )}
          </li>
        );
      })}
    </ul>
  );
}
