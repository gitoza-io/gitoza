import { useEffect, useState } from "react";
import { resolveWikiPageById } from "../utils/ticketLinks";
import Tooltip from "./Tooltip";

/**
 * Clickable [[wiki:page_id]] link; resolves lazily and styles unresolved targets.
 */
export default function WikiPageLink({
  pageId,
  label = null,
  repoSlug = null,
  onOpenWikiPage = null,
}) {
  const [row, setRow] = useState(undefined); // undefined = loading, null = missing
  const id = (pageId || "").trim();
  const display = (label || "").trim() || id;

  useEffect(() => {
    if (!id || !repoSlug) {
      setRow(null);
      return undefined;
    }
    let cancelled = false;
    resolveWikiPageById(repoSlug, id).then((r) => {
      if (!cancelled) setRow(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id, repoSlug]);

  if (!id) return null;

  const resolved = row && row.file_path;
  const loading = row === undefined;
  const tipTitle = row?.title || id;

  if (!onOpenWikiPage || !resolved) {
    const tip = loading || resolved ? null : `Unresolved wiki page: ${id}`;
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
    <Tooltip label={tipTitle} placement="bottom">
      <span className="inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onOpenWikiPage(row);
          }}
          className="font-mono text-[0.9em] text-indigo-600 underline decoration-indigo-400/60 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {display}
        </button>
      </span>
    </Tooltip>
  );
}
