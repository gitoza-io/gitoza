import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import Tooltip from "./Tooltip";
import {
  getCases,
  getTickets,
  linkCaseRequirement,
  unlinkCaseRequirement,
  listRuns,
  linkRunRequirement,
  unlinkRunRequirement,
} from "../services/api";

const CASE_SEARCH_INPUT_CLS =
  "box-border h-8 min-h-[2rem] w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400/40 dark:border-slate-500 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-500/30";

export function ChildTickets({ ticketId, repoSlug, onOpenTicket }) {
  const [children, setChildren] = useState([]);

  useEffect(() => {
    if (!ticketId || !repoSlug) {
      setChildren([]);
      return undefined;
    }
    let cancelled = false;
    setChildren([]);
    getTickets(repoSlug, { parent: ticketId, limit: 100, offset: 0 })
      .then((res) => {
        if (!cancelled) setChildren(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        if (!cancelled) setChildren([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, repoSlug]);

  if (!ticketId) return null;
  // Hide while empty (including load) so section chrome does not spike scroll height.
  if (children.length === 0) return null;

  return (
    <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Children
      </h3>
      <ul className="mt-2 space-y-1">
        {children.map((c) => (
          <li key={c.file_path}>
            {onOpenTicket ? (
              <button
                type="button"
                onClick={() => onOpenTicket(c)}
                className="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="shrink-0 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                  {c.ticket_id}
                </span>
                <span className="truncate">{c.title || "Untitled"}</span>
              </button>
            ) : (
              <div className="rounded px-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                <span className="font-mono text-xs text-slate-500">{c.ticket_id}</span>
                <span className="ml-2">{c.title || "Untitled"}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LinkedCases({ ticketId, repoSlug, onNavigateToCase = null, editable = false }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busyPath, setBusyPath] = useState("");
  const [error, setError] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const searchGenRef = useRef(0);
  const anchorRef = useRef(null);
  const inputRef = useRef(null);
  const queryRef = useRef("");
  queryRef.current = query;

  const reload = () => {
    if (!ticketId || !repoSlug) {
      setCases([]);
      return;
    }
    setLoading(true);
    getCases(repoSlug, { requirement_id: ticketId, limit: 50, offset: 0 })
      .then((res) => {
        setCases(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        setCases([]);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!ticketId || !repoSlug) {
      setCases([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setCases([]);
    setLoading(true);
    getCases(repoSlug, { requirement_id: ticketId, limit: 50, offset: 0 })
      .then((res) => {
        if (!cancelled) setCases(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        if (!cancelled) setCases([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, repoSlug]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    setFocused(false);
  }, []);

  useEffect(() => {
    if (searchOpen && editable) inputRef.current?.focus();
  }, [searchOpen, editable]);

  useEffect(() => {
    if (!editable) closeSearch();
  }, [editable, closeSearch]);

  useEffect(() => {
    if (!searchOpen || !focused || !repoSlug) {
      setSuggestions([]);
      return undefined;
    }
    const q = query.trim();
    const gen = ++searchGenRef.current;
    const t = setTimeout(() => {
      const params = q ? { search: q, limit: 20, offset: 0 } : { limit: 10, offset: 0 };
      getCases(repoSlug, params)
        .then((res) => {
          if (searchGenRef.current !== gen) return;
          const linked = new Set(cases.map((c) => c.file_path));
          setSuggestions(
            (Array.isArray(res?.items) ? res.items : []).filter((c) => c.file_path && !linked.has(c.file_path)),
          );
        })
        .catch(() => {
          if (searchGenRef.current === gen) setSuggestions([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [query, repoSlug, focused, searchOpen, cases]);

  const showDropdown = searchOpen && open && focused && suggestions.length > 0;

  const updateDropdownPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 256),
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

  const handleLink = async (row) => {
    if (!row?.file_path || !ticketId) return;
    setBusyPath(row.file_path);
    setError("");
    try {
      await linkCaseRequirement(row.file_path, ticketId, repoSlug);
      closeSearch();
      reload();
    } catch (err) {
      setError(err?.message || "Failed to link case");
    } finally {
      setBusyPath("");
    }
  };

  const handleUnlink = async (row) => {
    if (!row?.file_path || !ticketId) return;
    setBusyPath(row.file_path);
    setError("");
    try {
      await unlinkCaseRequirement(row.file_path, ticketId, repoSlug);
      reload();
    } catch (err) {
      setError(err?.message || "Failed to unlink case");
    } finally {
      setBusyPath("");
    }
  };

  if (!ticketId) return null;
  // Read-only: hide while empty (including load) to avoid scroll-height flicker.
  if (!editable && cases.length === 0) return null;

  return (
    <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Tested by
        </h3>
        {editable ? (
          <button
            type="button"
            onClick={() => {
              setSearchOpen(true);
              inputRef.current?.focus();
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-slate-800"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        ) : null}
      </div>
      {editable && searchOpen ? (
        <div ref={anchorRef} className="mt-2 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => {
                setFocused(false);
                setOpen(false);
                if (!queryRef.current.trim()) closeSearch();
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Search cases…"
            aria-label="Link test cases"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            className={CASE_SEARCH_INPUT_CLS}
          />
        </div>
      ) : null}
      {showDropdown && dropdownStyle
        ? createPortal(
            <ul
              className="overflow-y-auto rounded-ui border border-slate-200 bg-white text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
              style={dropdownStyle}
              role="listbox"
            >
              {suggestions.map((c) => (
                <li key={c.file_path}>
                  <button
                    type="button"
                    disabled={busyPath === c.file_path}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleLink(c);
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                      {c.case_id}
                    </span>
                    <span className="truncate text-slate-600 dark:text-slate-300">
                      {c.title || "Untitled"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
      {error ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : cases.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No linked test cases.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {cases.map((c) => (
            <li key={c.file_path} className="flex items-center gap-1">
              {onNavigateToCase && c.file_path ? (
                <Tooltip label={c.file_path} placement="bottom">
                  <span className="inline-flex min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onNavigateToCase(c)}
                      className="flex w-full min-w-0 items-baseline gap-2 rounded px-2 py-1 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <span className="shrink-0 font-mono text-xs text-indigo-600 dark:text-indigo-400">
                        {c.case_id}
                      </span>
                      <span className="truncate">{c.title || "Untitled"}</span>
                    </button>
                  </span>
                </Tooltip>
              ) : (
                <div className="min-w-0 flex-1 rounded px-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                  <span className="font-mono text-xs text-slate-500">{c.case_id}</span>
                  <span className="ml-2">{c.title || "Untitled"}</span>
                </div>
              )}
              {editable ? (
                <button
                  type="button"
                  disabled={busyPath === c.file_path}
                  onClick={() => handleUnlink(c)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label={`Unlink ${c.case_id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LinkedRuns({ ticketId, repoSlug, onNavigateToRun = null, editable = false }) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const searchGenRef = useRef(0);
  const anchorRef = useRef(null);
  const inputRef = useRef(null);
  const queryRef = useRef("");
  queryRef.current = query;

  const reload = () => {
    if (!ticketId || !repoSlug) {
      setRuns([]);
      return;
    }
    setLoading(true);
    listRuns(repoSlug, { requirement_id: ticketId })
      .then((res) => {
        setRuns(Array.isArray(res) ? res : []);
      })
      .catch(() => {
        setRuns([]);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!ticketId || !repoSlug) {
      setRuns([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRuns([]);
    setLoading(true);
    listRuns(repoSlug, { requirement_id: ticketId })
      .then((res) => {
        if (!cancelled) setRuns(Array.isArray(res) ? res : []);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId, repoSlug]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    setFocused(false);
  }, []);

  useEffect(() => {
    if (searchOpen && editable) inputRef.current?.focus();
  }, [searchOpen, editable]);

  useEffect(() => {
    if (!editable) closeSearch();
  }, [editable, closeSearch]);

  useEffect(() => {
    if (!searchOpen || !focused || !repoSlug) {
      setSuggestions([]);
      return undefined;
    }
    const q = query.trim();
    const gen = ++searchGenRef.current;
    const t = setTimeout(() => {
      const params = q ? { search: q } : {};
      listRuns(repoSlug, params)
        .then((res) => {
          if (searchGenRef.current !== gen) return;
          const linked = new Set(runs.map((r) => r.run_id));
          setSuggestions(
            (Array.isArray(res) ? res : [])
              .filter((r) => r.run_id && !linked.has(r.run_id))
              .slice(0, q ? 20 : 10),
          );
        })
        .catch(() => {
          if (searchGenRef.current === gen) setSuggestions([]);
        });
    }, 200);
    return () => clearTimeout(t);
  }, [query, repoSlug, focused, searchOpen, runs]);

  const showDropdown = searchOpen && open && focused && suggestions.length > 0;

  const updateDropdownPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 256),
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

  const handleLink = async (row) => {
    if (!row?.run_id || !ticketId) return;
    setBusyId(row.run_id);
    setError("");
    try {
      await linkRunRequirement(row.run_id, ticketId, repoSlug);
      closeSearch();
      reload();
    } catch (err) {
      setError(err?.message || "Failed to link run");
    } finally {
      setBusyId("");
    }
  };

  const handleUnlink = async (row) => {
    if (!row?.run_id || !ticketId) return;
    setBusyId(row.run_id);
    setError("");
    try {
      await unlinkRunRequirement(row.run_id, ticketId, repoSlug);
      reload();
    } catch (err) {
      setError(err?.message || "Failed to unlink run");
    } finally {
      setBusyId("");
    }
  };

  if (!ticketId) return null;
  // Read-only: hide while empty (including load) to avoid scroll-height flicker.
  if (!editable && runs.length === 0) return null;

  return (
    <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Covered by runs
        </h3>
        {editable ? (
          <button
            type="button"
            onClick={() => {
              setSearchOpen(true);
              inputRef.current?.focus();
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-slate-800"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        ) : null}
      </div>
      {editable && searchOpen ? (
        <div ref={anchorRef} className="mt-2 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => {
                setFocused(false);
                setOpen(false);
                if (!queryRef.current.trim()) closeSearch();
              }, 150);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Search runs…"
            aria-label="Link test runs"
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            className={CASE_SEARCH_INPUT_CLS}
          />
        </div>
      ) : null}
      {showDropdown && dropdownStyle
        ? createPortal(
            <ul
              className="overflow-y-auto rounded-ui border border-slate-200 bg-white text-xs shadow-lg dark:border-slate-600 dark:bg-slate-900"
              style={dropdownStyle}
              role="listbox"
            >
              {suggestions.map((r) => (
                <li key={r.run_id}>
                  <button
                    type="button"
                    disabled={busyId === r.run_id}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleLink(r);
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="truncate text-slate-800 dark:text-slate-200">
                      {r.name || r.run_id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
      {error ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No linked test runs.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {runs.map((r) => (
            <li key={r.run_id} className="flex items-center gap-1">
              {onNavigateToRun && r.run_id ? (
                <button
                  type="button"
                  onClick={() => onNavigateToRun(r)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 rounded px-2 py-1 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span className="truncate">{r.name || r.run_id}</span>
                </button>
              ) : (
                <div className="min-w-0 flex-1 rounded px-2 py-1 text-sm text-slate-800 dark:text-slate-200">
                  <span>{r.name || r.run_id}</span>
                </div>
              )}
              {editable ? (
                <button
                  type="button"
                  disabled={busyId === r.run_id}
                  onClick={() => handleUnlink(r)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label={`Unlink ${r.name || r.run_id}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
