import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { useConfirm } from "./ConfirmProvider";
import { createRun, listRuns, patchRun } from "../services/api";
import { ResultStackBar } from "./RunSuiteBreakdownList";

const SEARCH_INPUT_CLS =
  "box-border h-8 min-h-[2rem] w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400/40 dark:border-slate-500 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-500/30";

function idsEqualRelease(a, b) {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

function runResultCounts(run) {
  const total = Number(run?.total_cases) || 0;
  const passed = Number(run?.passed) || 0;
  const failed = Number(run?.failed) || 0;
  const skipped = Number(run?.skipped) || 0;
  const pending = Math.max(0, total - passed - failed - skipped);
  return { total, passed, failed, skipped, pending };
}

/**
 * Overall execution phase for the run row (pass / fail / not run / in progress).
 */
function runExecutionPhase({ total, passed, failed, pending, status }) {
  const s = String(status || "").trim().toLowerCase();
  if (total <= 0 || s === "not_started" || (passed === 0 && failed === 0 && pending === total)) {
    return { key: "not_run", label: "Not run" };
  }
  if (s === "in_progress" || pending > 0) {
    return { key: "in_progress", label: "In progress" };
  }
  if (failed > 0 || s === "failed") {
    return { key: "fail", label: "Fail" };
  }
  return { key: "pass", label: "Pass" };
}

const PHASE_PILL = {
  pass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  fail: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
  not_run: "bg-slate-100 text-slate-600 dark:bg-slate-600/30 dark:text-slate-400",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
};

const COUNT_BADGE = {
  pass: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-400/30",
  fail: "bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:bg-rose-500/20 dark:text-rose-300 dark:ring-rose-400/30",
  not_run:
    "bg-slate-500/10 text-slate-600 ring-slate-400/30 dark:bg-slate-500/20 dark:text-slate-300 dark:ring-slate-500/40",
  in_progress:
    "bg-amber-500/15 text-amber-800 ring-amber-500/25 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-400/30",
};

function CountBadge({ tone, label, count, title }) {
  if (count <= 0) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ring-1 ring-inset ${COUNT_BADGE[tone]}`}
      title={title || `${count} ${label}`}
    >
      <span className="opacity-70">{label}</span>
      <span>{count}</span>
    </span>
  );
}

/** Same-line execution summary: phase pill + stack bar + count badges. */
function RunExecutionInline({ run }) {
  const counts = runResultCounts(run);
  const { total, passed, failed, skipped, pending } = counts;
  const phase = runExecutionPhase({ ...counts, status: run?.status });
  // Remaining open cases while a run is active read as "in progress"; otherwise "not run".
  const openTone = phase.key === "in_progress" ? "in_progress" : "not_run";
  const openLabel = phase.key === "in_progress" ? "Open" : "Not run";

  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2"
      title={`${phase.label}: ${passed} pass, ${failed} fail, ${pending} ${openLabel.toLowerCase()}${skipped ? `, ${skipped} skip` : ""} of ${total}`}
    >
      <span
        className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline ${PHASE_PILL[phase.key]}`}
      >
        {phase.label}
      </span>
      <div className="w-14 shrink-0 sm:w-20">
        {total > 0 ? (
          <ResultStackBar
            passed={passed}
            failed={failed}
            skipped={skipped}
            pending={pending}
            thin
          />
        ) : (
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="img"
            aria-label="No cases in run"
          />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <CountBadge tone="pass" label="Pass" count={passed} title={`${passed} passed`} />
        <CountBadge tone="fail" label="Fail" count={failed} title={`${failed} failed`} />
        <CountBadge
          tone={openTone}
          label={phase.key === "in_progress" ? "Open" : "Not run"}
          count={pending}
          title={`${pending} ${openLabel.toLowerCase()}`}
        />
        <CountBadge tone="not_run" label="Skip" count={skipped} title={`${skipped} skipped`} />
      </div>
    </div>
  );
}

/**
 * Reverse list of test runs linked to a release via run.release.
 * Supports link / unlink / create + navigate.
 */
export default function ReleaseLinkedRuns({
  releaseId,
  repoSlug,
  editable = false,
  onNavigateToRun = null,
  onAfterChange = null,
}) {
  const confirm = useConfirm();
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const searchGenRef = useRef(0);
  const anchorRef = useRef(null);
  const inputRef = useRef(null);
  const queryRef = useRef("");
  queryRef.current = query;

  const reload = useCallback(() => {
    if (!releaseId || !repoSlug) {
      setRuns([]);
      return;
    }
    setLoading(true);
    listRuns(repoSlug, { release: releaseId })
      .then((res) => {
        setRuns(Array.isArray(res) ? res : []);
      })
      .catch(() => {
        setRuns([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [releaseId, repoSlug]);

  useEffect(() => {
    if (!releaseId || !repoSlug) {
      setRuns([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setRuns([]);
    setLoading(true);
    listRuns(repoSlug, { release: releaseId })
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
  }, [releaseId, repoSlug]);

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
    if (!row?.run_id || !releaseId) return;
    const otherRelease = (row.release || "").trim();
    if (otherRelease && !idsEqualRelease(otherRelease, releaseId)) {
      const ok = await confirm({
        title: "Move test run?",
        description: `"${row.name || row.run_id}" is linked to another release (${otherRelease}). Link it to this release instead?`,
        confirmLabel: "Move",
      });
      if (!ok) return;
    }
    setBusyId(row.run_id);
    setError("");
    try {
      await patchRun(row.run_id, { release: releaseId }, repoSlug);
      closeSearch();
      reload();
      onAfterChange?.();
    } catch (err) {
      setError(err?.message || "Failed to link run");
    } finally {
      setBusyId("");
    }
  };

  const handleUnlink = async (row) => {
    if (!row?.run_id) return;
    setBusyId(row.run_id);
    setError("");
    try {
      await patchRun(row.run_id, { release: "" }, repoSlug);
      reload();
      onAfterChange?.();
    } catch (err) {
      setError(err?.message || "Failed to unlink run");
    } finally {
      setBusyId("");
    }
  };

  const handleCreate = async () => {
    if (!releaseId || !repoSlug || creating) return;
    setCreating(true);
    setError("");
    try {
      const created = await createRun(
        { name: "New test run", release: releaseId },
        repoSlug,
      );
      const runId = (created?.run_id || "").trim();
      onAfterChange?.();
      if (runId && onNavigateToRun) {
        onNavigateToRun(created);
      } else {
        reload();
      }
    } catch (err) {
      setError(err?.message || "Failed to create test run");
    } finally {
      setCreating(false);
    }
  };

  if (!releaseId) return null;

  return (
    <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Test runs
        </h3>
        {editable ? (
          <>
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
            <button
              type="button"
              disabled={creating}
              onClick={handleCreate}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:text-indigo-400 dark:hover:bg-slate-800"
            >
              {creating ? "Creating…" : "New test run"}
            </button>
          </>
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
            className={SEARCH_INPUT_CLS}
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
              {suggestions.map((r) => {
                const other = (r.release || "").trim();
                const showBadge = other && !idsEqualRelease(other, releaseId);
                return (
                  <li key={r.run_id}>
                    <button
                      type="button"
                      disabled={busyId === r.run_id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleLink(r);
                      }}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-200">
                        {r.name || r.run_id}
                      </span>
                      <RunExecutionInline run={r} />
                      {showBadge ? (
                        <span className="shrink-0 font-mono text-[10px] text-amber-700 dark:text-amber-400">
                          {other}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
      {error ? <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p> : null}
      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          No run is added or linked.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {runs.map((r) => {
            const rowInner = (
              <>
                <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-slate-800 dark:text-slate-200">
                  {r.name || r.run_id}
                </span>
                <RunExecutionInline run={r} />
              </>
            );
            return (
              <li key={r.run_id} className="flex items-center gap-1">
                {onNavigateToRun && r.run_id ? (
                  <button
                    type="button"
                    onClick={() => onNavigateToRun(r)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {rowInner}
                  </button>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5">
                    {rowInner}
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
