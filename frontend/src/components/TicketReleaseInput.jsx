import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  decideLinkedIdCommit,
  findExactSuggestionId,
  idsEqual,
} from "../utils/entityLinkCommit";
import { formatReleaseSuggestionLabel, resolveReleaseById, searchReleasesForLink } from "../utils/releaseLinks";

const RELEASE_INPUT_CLS =
  "box-border h-8 min-h-[2rem] w-36 shrink-0 rounded border bg-white px-2 py-1 font-mono text-xs outline-none focus:ring-1 dark:bg-slate-950";

function releaseRowId(row) {
  return row?.release_id || "";
}

/**
 * Release id field with search autocomplete and soft unresolved hint.
 * On focus, lists releases (scoped to ticket project when provided) so the user
 * can pick without typing — same click-first pattern as AssigneeInput.
 * Typing is buffered; only resolved release ids are committed.
 * Stores composite release_id (`project/stem`); suggestions show one line (id, optional name).
 */
export default function TicketReleaseInput({
  value = "",
  onChange,
  onBlur: onBlurProp,
  repoSlug = null,
  /** Ticket project folder name; scopes the empty-query browse list. */
  project = null,
  disabled = false,
  className = "",
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(0);
  const [resolved, setResolved] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const anchorRef = useRef(null);
  const searchGenRef = useRef(0);
  const blurTimerRef = useRef(null);
  const draftRef = useRef(draft);
  const valueRef = useRef(value);
  const suggestionsRef = useRef(suggestions);
  const highlightRef = useRef(highlight);
  const onChangeRef = useRef(onChange);
  const onBlurPropRef = useRef(onBlurProp);

  draftRef.current = draft;
  valueRef.current = value;
  suggestionsRef.current = suggestions;
  highlightRef.current = highlight;
  onChangeRef.current = onChange;
  onBlurPropRef.current = onBlurProp;

  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  const query = (focused ? draft : value).trim();
  const draftDirty = !idsEqual(draft, value);
  const showUnresolved = Boolean(query) && !resolving && resolved === null;
  const hintWillNotSave = showUnresolved && focused && draftDirty;

  useEffect(() => {
    if (!query || !repoSlug) {
      setResolved(null);
      setResolving(false);
      return undefined;
    }
    let cancelled = false;
    setResolving(true);
    const t = setTimeout(() => {
      resolveReleaseById(repoSlug, query).then((row) => {
        if (!cancelled) {
          setResolved(row);
          setResolving(false);
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, repoSlug]);

  useEffect(() => {
    if (!focused || !repoSlug || disabled) {
      setSuggestions([]);
      setHighlight(0);
      return undefined;
    }
    const gen = ++searchGenRef.current;
    const t = setTimeout(() => {
      searchReleasesForLink(repoSlug, query, {
        limit: 10,
        project: project || null,
      }).then((items) => {
        if (searchGenRef.current === gen) {
          setSuggestions(items);
          setHighlight(0);
        }
      });
    }, 200);
    return () => clearTimeout(t);
  }, [focused, query, repoSlug, project, disabled]);

  const showDropdown = open && focused && suggestions.length > 0 && !disabled;

  const updateDropdownPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: "16rem",
      height: "12rem",
      zIndex: 50,
    });
  }, []);

  useEffect(() => {
    if (!showDropdown) {
      setDropdownStyle(null);
      return undefined;
    }
    updateDropdownPosition();
    const onScroll = () => updateDropdownPosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [showDropdown, updateDropdownPosition]);

  const finish = useCallback((unfocus) => {
    setOpen(false);
    setHighlight(0);
    if (unfocus) setFocused(false);
  }, []);

  const applyPick = useCallback((id) => {
    const next = String(id ?? "").trim();
    if (!next) return false;
    onChangeRef.current?.(next);
    setDraft(next);
    setOpen(false);
    setHighlight(0);
    return true;
  }, []);

  const applyDecision = useCallback(
    (decision, { unfocus = false } = {}) => {
      if (decision.action === "commit") {
        applyPick(decision.id);
        finish(unfocus);
        return;
      }
      if (decision.action === "clear") {
        setDraft("");
        onChangeRef.current?.("");
        finish(unfocus);
        return;
      }
      setDraft(valueRef.current ?? "");
      finish(unfocus);
    },
    [applyPick, finish],
  );

  const commitFromQuery = useCallback(
    async ({ pickHighlight = false, unfocus = false } = {}) => {
      if (pickHighlight) {
        const row = suggestionsRef.current[highlightRef.current];
        const highlightedId = String(releaseRowId(row) || "").trim();
        if (highlightedId) {
          applyPick(highlightedId);
          finish(unfocus);
          return;
        }
      }
      const q = String(draftRef.current ?? "").trim();
      const committed = String(valueRef.current ?? "").trim();
      const exactId = findExactSuggestionId(q, suggestionsRef.current, releaseRowId);
      let resolvedId = exactId;
      if (!resolvedId && q && repoSlug) {
        const row = await resolveReleaseById(repoSlug, q);
        resolvedId = String(releaseRowId(row) || "").trim() || null;
      }
      applyDecision(
        decideLinkedIdCommit({
          query: q,
          committedValue: committed,
          exactSuggestionId: exactId,
          resolvedId,
        }),
        { unfocus },
      );
    },
    [applyDecision, applyPick, finish, repoSlug],
  );

  const revertDraft = useCallback(() => {
    setDraft(valueRef.current ?? "");
    setOpen(false);
    setHighlight(0);
  }, []);

  /** Persist a clear (or keep/revert) without waiting on async resolve. */
  const commitSyncFromDraft = useCallback(
    ({ unfocus = false } = {}) => {
      const q = String(draftRef.current ?? "").trim();
      const committed = String(valueRef.current ?? "").trim();
      if (!q) {
        applyDecision(
          decideLinkedIdCommit({ query: "", committedValue: committed }),
          { unfocus },
        );
        return true;
      }
      const exactId = findExactSuggestionId(q, suggestionsRef.current, releaseRowId);
      if (exactId) {
        applyDecision(
          decideLinkedIdCommit({
            query: q,
            committedValue: committed,
            exactSuggestionId: exactId,
            resolvedId: exactId,
          }),
          { unfocus },
        );
        return true;
      }
      if (idsEqual(q, committed)) {
        applyDecision({ action: "keep" }, { unfocus });
        return true;
      }
      return false;
    },
    [applyDecision],
  );

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      // Eye / ticket switch unmounts before the 150ms blur timer; commit clear now
      // so the parent draft (and autosave flush) sees the removal.
      const q = String(draftRef.current ?? "").trim();
      const committed = String(valueRef.current ?? "").trim();
      if (!q && committed) {
        onChangeRef.current?.("");
      }
    };
  }, []);

  const releaseInput = (
    <input
      type="text"
      value={focused ? draft : value}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        // Push empty to parent immediately so debounced autosave / Eye flush
        // do not race the blur timer.
        if (!String(next).trim() && String(valueRef.current ?? "").trim()) {
          onChangeRef.current?.("");
        }
      }}
      onFocus={() => {
        if (blurTimerRef.current) {
          clearTimeout(blurTimerRef.current);
          blurTimerRef.current = null;
        }
        setDraft(valueRef.current ?? "");
        setFocused(true);
        setOpen(true);
      }}
      onBlur={() => {
        // Sync clear (and exact suggestion) before Eye/nav click handlers flush.
        // Dropdown picks use mousedown preventDefault so blur does not fire.
        if (commitSyncFromDraft({ unfocus: true })) {
          onBlurPropRef.current?.();
          return;
        }
        blurTimerRef.current = setTimeout(() => {
          blurTimerRef.current = null;
          void commitFromQuery({ unfocus: true }).then(() => {
            onBlurPropRef.current?.();
          });
        }, 150);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (suggestions.length === 0) return;
          setOpen(true);
          setHighlight((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (suggestions.length === 0) return;
          setOpen(true);
          setHighlight((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          void commitFromQuery({ pickHighlight: showDropdown, unfocus: false });
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          revertDraft();
        }
      }}
      placeholder="Select release…"
      className={`${RELEASE_INPUT_CLS} w-44 ${
        showUnresolved
          ? "border-amber-400 text-slate-800 focus:border-amber-500 focus:ring-amber-400/40 dark:border-amber-500/60 dark:text-slate-100 dark:focus:border-amber-500"
          : "border-slate-300 text-slate-800 focus:border-indigo-500 focus:ring-indigo-400/40 dark:border-slate-500 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-500/30"
      }`}
      aria-autocomplete="list"
      aria-expanded={showDropdown}
      aria-controls={showDropdown ? "ticket-release-link-list" : undefined}
    />
  );

  return (
    <div className={`relative w-44 shrink-0 ${className}`}>
      <div ref={anchorRef} className="w-44">
        {releaseInput}
      </div>
      {showUnresolved ? (
        <p
          className="pointer-events-none absolute left-0 top-full z-20 mt-0.5 max-w-[14rem] whitespace-nowrap rounded bg-white/95 px-1 py-0.5 text-[10px] text-amber-600 shadow-sm dark:bg-slate-900/95 dark:text-amber-400"
          role="status"
        >
          {hintWillNotSave
            ? "No release with this id — will not be saved"
            : "No release with this id (link will stay unresolved)"}
        </p>
      ) : null}
      {showDropdown && dropdownStyle
        ? createPortal(
            <ul
              id="ticket-release-link-list"
              className="overflow-y-auto rounded-ui border border-slate-200 bg-white text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
              style={dropdownStyle}
              role="listbox"
            >
              {suggestions.map((r, index) => {
                const active = index === highlight;
                return (
                  <li key={r.file_path || r.release_id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={`w-full truncate px-2 py-1.5 text-left font-mono text-[11px] ${
                        active
                          ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400"
                          : "text-indigo-600 hover:bg-slate-100 dark:text-indigo-400 dark:hover:bg-slate-800"
                      }`}
                      onMouseEnter={() => setHighlight(index)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyPick(r.release_id || "");
                      }}
                    >
                      {formatReleaseSuggestionLabel(r)}
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
