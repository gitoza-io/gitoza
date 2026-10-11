import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchEntitiesForLink } from "../utils/ticketLinks";

const POPOVER_WIDTH = 288;
const POPOVER_MAX_HEIGHT = 280;

/**
 * Toolbar popover: search tickets and wiki pages; pick one for a body link insert.
 */
export default function EntityLinkPicker({
  open = false,
  anchorRef = null,
  onClose,
  repoSlug = null,
  excludeTicketId = null,
  excludePageId = null,
  onSelect,
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(0);
  const [popoverStyle, setPopoverStyle] = useState(null);
  const searchGenRef = useRef(0);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSuggestions([]);
      setHighlight(0);
      setPopoverStyle(null);
      return undefined;
    }
    return undefined;
  }, [open]);

  const updatePosition = useCallback(() => {
    const el = anchorRef?.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - POPOVER_WIDTH - 8,
    );
    const top = rect.bottom + 4;
    setPopoverStyle({
      position: "fixed",
      top,
      left,
      width: POPOVER_WIDTH,
      maxHeight: POPOVER_MAX_HEIGHT,
      zIndex: 60,
    });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePosition]);

  // Focus after portal mounts (popoverStyle is set); focusing on open alone races the null render.
  useEffect(() => {
    if (!open || !popoverStyle) return undefined;
    const t = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(t);
  }, [open, popoverStyle]);

  useEffect(() => {
    if (!open || !repoSlug) {
      setSuggestions([]);
      return undefined;
    }
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      setHighlight(0);
      return undefined;
    }
    const gen = ++searchGenRef.current;
    const t = setTimeout(() => {
      searchEntitiesForLink(repoSlug, q, {
        excludeTicketId,
        excludePageId,
        limitPerKind: 6,
      }).then((items) => {
        if (searchGenRef.current !== gen) return;
        setSuggestions(items);
        setHighlight(0);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [open, query, repoSlug, excludeTicketId, excludePageId]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      const panel = panelRef.current;
      const anchor = anchorRef?.current;
      if (panel?.contains(e.target) || anchor?.contains(e.target)) return;
      onClose?.();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  const pick = useCallback(
    (row) => {
      if (!row?.kind || !row?.id) return;
      onSelect?.(row);
      onClose?.();
    },
    [onSelect, onClose],
  );

  const onInputKeyDown = useCallback(
    (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (suggestions.length === 0) return;
        setHighlight((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (suggestions.length === 0) return;
        setHighlight((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = suggestions[highlight];
        if (row) pick(row);
      }
    },
    [suggestions, highlight, pick],
  );

  if (!open || !popoverStyle) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={popoverStyle}
      className="flex flex-col overflow-hidden rounded-ui border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-900"
      role="dialog"
      aria-label="Insert link"
    >
      <div className="border-b border-slate-200 p-2 dark:border-slate-700">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Ticket or wiki page…"
          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400/40 dark:border-slate-500 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-400"
          aria-autocomplete="list"
          aria-controls="entity-link-list"
          aria-expanded={suggestions.length > 0}
        />
      </div>
      {suggestions.length > 0 ? (
        <ul
          id="entity-link-list"
          className="min-h-0 flex-1 overflow-y-auto text-xs"
          role="listbox"
        >
          {suggestions.map((item, index) => {
            const active = index === highlight;
            const kindLabel = item.kind === "wiki" ? "Wiki" : "Ticket";
            return (
              <li key={`${item.kind}:${item.id}`} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left ${
                    active
                      ? "bg-indigo-50 dark:bg-indigo-500/20"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(item);
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-100 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {kindLabel}
                    </span>
                    <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                      {item.id}
                    </span>
                  </span>
                  <span className="w-full truncate text-slate-600 dark:text-slate-300">
                    {item.title || item.id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : query.trim() ? (
        <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">No matches</p>
      ) : (
        <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
          Type a ticket or wiki page id or title
        </p>
      )}
    </div>,
    document.body,
  );
}
