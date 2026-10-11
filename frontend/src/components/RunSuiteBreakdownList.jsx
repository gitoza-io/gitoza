import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  SUITE_BREAKDOWN_MAX_HEIGHT_PX,
  SUITE_BREAKDOWN_ROW_ESTIMATE_PX,
  SUITE_BREAKDOWN_ROW_GAP_PX,
  VIRTUAL_SUITE_BREAKDOWN_OVERSCAN,
  VIRTUAL_SUITE_BREAKDOWN_THRESHOLD,
} from "../constants/virtualSuiteBreakdown";

/**
 * Right-aligned stats on the same row as suite / priority / tag name (matches ResultStackBar).
 */
export function BreakdownStatsInline({ stats }) {
  const { totalCases, passed, failed, skipped, pending } = stats;
  const full = `${totalCases} cases, ${passed} pass, ${failed} fail, ${skipped} skip, ${pending} not started`;
  return (
    <span
      className="shrink-0 text-right text-xs tabular-nums leading-tight text-slate-600 dark:text-slate-400 whitespace-nowrap"
      title={full}
    >
      <span className="font-semibold text-slate-800 dark:text-slate-200">{totalCases}</span>
      <span className="text-slate-500 dark:text-slate-500"> cases</span>
      <span className="font-medium text-emerald-600 dark:text-emerald-400"> · {passed} pass</span>
      <span className="font-medium text-red-600 dark:text-red-400"> · {failed} fail</span>
      <span> · {skipped} skip</span>
      <span> · {pending} not started</span>
    </span>
  );
}

/** Tailwind `sm` breakpoint (640px). */
function useMediaQueryMinWidth(px) {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatches(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return matches;
}

/**
 * One row with title + stats when space allows; if the title would ellipsis, stack stats on a
 * second line so the full title can wrap (used for suite path, priority, tag rows).
 */
export function BreakdownRowHeader({ title, stats }) {
  const smUp = useMediaQueryMinWidth(640);
  const rowRef = useRef(null);
  const labelRef = useRef(null);
  const statsRef = useRef(null);
  const naturalLabelWRef = useRef(0);
  const stackedRef = useRef(false);
  const [stacked, setStacked] = useState(false);

  stackedRef.current = stacked;

  useEffect(() => {
    naturalLabelWRef.current = 0;
    setStacked(false);
  }, [title]);

  const layout = useCallback(() => {
    if (!smUp) return;
    const row = rowRef.current;
    const labelEl = labelRef.current;
    const statsEl = statsRef.current;
    if (!row || !labelEl || !statsEl) return;
    const gap = 8;
    const rowW = row.clientWidth;
    const statsW = statsEl.getBoundingClientRect().width;

    if (!stackedRef.current) {
      if (labelEl.scrollWidth > labelEl.clientWidth + 1) {
        naturalLabelWRef.current = labelEl.scrollWidth;
        setStacked(true);
      }
    } else {
      const natural = naturalLabelWRef.current;
      if (natural + statsW + gap <= rowW + 1) {
        setStacked(false);
      }
    }
  }, [smUp]);

  useLayoutEffect(() => {
    if (!smUp) return;
    layout();
  }, [smUp, stacked, title, layout]);

  useEffect(() => {
    if (!smUp) return;
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(layout);
    ro.observe(row);
    return () => ro.disconnect();
  }, [smUp, layout]);

  if (!smUp) {
    return (
      <div className="mb-1.5 flex flex-col gap-1">
        <span className="break-words text-sm font-medium text-slate-800 dark:text-slate-100">{title}</span>
        <div className="self-end">
          <BreakdownStatsInline stats={stats} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className={`mb-1.5 flex min-w-0 gap-2 ${stacked ? "flex-col items-stretch" : "flex-row items-baseline justify-between"}`}
    >
      <span
        ref={labelRef}
        className={`text-sm font-medium text-slate-800 dark:text-slate-100 ${
          stacked ? "break-words" : "min-w-0 flex-1 truncate"
        }`}
      >
        {title}
      </span>
      <span ref={statsRef} className={`shrink-0 ${stacked ? "self-end" : ""}`}>
        <BreakdownStatsInline stats={stats} />
      </span>
    </div>
  );
}

/** Horizontal stacked bar: passed / failed / skipped / pending (same palette as donut). */
export function ResultStackBar({ passed, failed, skipped, pending, thin }) {
  const total = passed + failed + skipped + pending;
  if (total <= 0) return null;
  const pct = (n) => `${(100 * n) / total}%`;
  const h = thin ? "h-1.5" : "h-2.5";
  return (
    <div
      className={`flex w-full max-w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700 ${h}`}
      role="img"
      aria-label={`Results: ${passed} passed, ${failed} failed, ${skipped} skipped, ${pending} pending of ${total}`}
    >
      {passed > 0 && (
        <div className="bg-emerald-500 dark:bg-emerald-500" style={{ width: pct(passed) }} title={`${passed} passed`} />
      )}
      {failed > 0 && (
        <div className="bg-rose-500 dark:bg-rose-600" style={{ width: pct(failed) }} title={`${failed} failed`} />
      )}
      {skipped > 0 && (
        <div className="bg-slate-400 dark:bg-slate-500" style={{ width: pct(skipped) }} title={`${skipped} skipped`} />
      )}
      {pending > 0 && (
        <div className="bg-slate-300 dark:bg-slate-600" style={{ width: pct(pending) }} title={`${pending} pending`} />
      )}
    </div>
  );
}

const rowShellClassName =
  "rounded-none border border-slate-100 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700/60 dark:bg-slate-800/40";

function SuiteBreakdownRowContent({ label, stats }) {
  return (
    <>
      <BreakdownRowHeader title={label} stats={stats} />
      <ResultStackBar
        passed={stats.passed}
        failed={stats.failed}
        skipped={stats.skipped}
        pending={stats.pending}
      />
    </>
  );
}

function SuiteBreakdownRow({ row, measureRef = null, asListItem = true }) {
  const Tag = asListItem ? "li" : "div";
  return (
    <Tag ref={measureRef} className={`${rowShellClassName} ${asListItem ? "list-none" : ""}`}>
      <SuiteBreakdownRowContent label={row.label} stats={row.stats} />
    </Tag>
  );
}

/**
 * Scrollable suite/project breakdown list with optional virtualization for large runs.
 */
function RunSuiteBreakdownList({
  rows = [],
  loading = false,
  emptyMessage = "No suite rows for this run.",
  loadingMessage = "…",
  maxHeightPx = SUITE_BREAKDOWN_MAX_HEIGHT_PX,
  /** When set, the parent element scrolls (e.g. Dashboard right column) instead of this list. */
  parentScrollRef = null,
}) {
  const innerScrollRef = useRef(null);
  const usesParentScroll = parentScrollRef != null;
  const shouldVirtualize = rows.length >= VIRTUAL_SUITE_BREAKDOWN_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () =>
      usesParentScroll ? parentScrollRef.current : innerScrollRef.current,
    estimateSize: () => SUITE_BREAKDOWN_ROW_ESTIMATE_PX + SUITE_BREAKDOWN_ROW_GAP_PX,
    overscan: VIRTUAL_SUITE_BREAKDOWN_OVERSCAN,
    gap: SUITE_BREAKDOWN_ROW_GAP_PX,
    enabled: shouldVirtualize && rows.length > 0,
  });

  if (loading && !rows.length) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">{loadingMessage}</p>;
  }

  if (!rows.length) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">{emptyMessage}</p>;
  }

  const hasExplicitMaxHeight = maxHeightPx != null && Number.isFinite(maxHeightPx);
  const effectiveMaxHeightPx = usesParentScroll
    ? null
    : hasExplicitMaxHeight
      ? maxHeightPx
      : shouldVirtualize
        ? SUITE_BREAKDOWN_MAX_HEIGHT_PX
        : null;
  const scrollStyle =
    effectiveMaxHeightPx != null ? { maxHeight: effectiveMaxHeightPx } : undefined;
  const scrollClassName =
    effectiveMaxHeightPx != null ? "main-content-scroll overflow-y-auto overscroll-y-contain" : undefined;

  if (!shouldVirtualize) {
    const list = (
      <ul className="space-y-2">
        {rows.map((row) => (
          <SuiteBreakdownRow key={row.key} row={row} />
        ))}
      </ul>
    );
    if (usesParentScroll) return list;
    return (
      <div ref={innerScrollRef} className={scrollClassName} style={scrollStyle}>
        {list}
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const virtualList = (
    <div className="relative w-full" style={{ height: totalSize }}>
      {virtualItems.map((virtualRow) => {
        const row = rows[virtualRow.index];
        const measureRef = (el) => {
          if (el) virtualizer.measureElement(el);
        };
        return (
          <div
            key={row.key}
            data-index={virtualRow.index}
            ref={measureRef}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
            role="listitem"
          >
            <SuiteBreakdownRow row={row} measureRef={null} asListItem={false} />
          </div>
        );
      })}
    </div>
  );

  if (usesParentScroll) {
    return (
      <div role="list">
        {virtualList}
      </div>
    );
  }

  return (
    <div ref={innerScrollRef} className={scrollClassName} style={scrollStyle} role="list">
      {virtualList}
    </div>
  );
}

export default RunSuiteBreakdownList;
