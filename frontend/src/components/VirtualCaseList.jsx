import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTreeScrollContext } from "../contexts/TreeScrollContext";
import { useVirtualCaseListRegistry } from "../contexts/VirtualCaseListRegistryContext";
import {
  CASE_ROW_ESTIMATE_PX,
  VIRTUAL_CASE_LIST_OVERSCAN,
  VIRTUAL_CASE_LIST_THRESHOLD,
} from "../constants/virtualCaseList";
import {
  computeScrollMargin,
  debounce,
  estimateVirtualListHeight,
  preserveScrollTop,
} from "../utils/virtualCaseListScroll";

/**
 * Per-folder virtual case list sharing the sidebar scroll parent via scrollMargin.
 *
 * @param {{
 *   cases: Array<object>;
 *   listId?: string;
 *   enabled?: boolean;
 *   renderRow: (
 *     caseRow: object,
 *     index: number,
 *     ctx: { virtual: boolean; measureRef: ((el: HTMLElement | null) => void) | null }
 *   ) => React.ReactElement;
 * }} props
 */
function VirtualCaseList({ cases = [], listId, enabled: enabledProp = true, renderRow }) {
  const scrollContext = useTreeScrollContext();
  const registry = useVirtualCaseListRegistry();
  const listContainerRef = useRef(null);
  const scrollMarginRef = useRef(0);
  const hasMeasuredMarginRef = useRef(false);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [marginReady, setMarginReady] = useState(false);

  const wantsVirtualize =
    enabledProp !== false &&
    cases.length >= VIRTUAL_CASE_LIST_THRESHOLD &&
    Boolean(scrollContext?.scrollElementRef);

  const applyScrollMargin = useCallback(
    (next) => {
      const scrollEl = scrollContext?.scrollElementRef?.current ?? null;
      if (next === scrollMarginRef.current && hasMeasuredMarginRef.current) return;
      preserveScrollTop(scrollEl, () => {
        scrollMarginRef.current = next;
        hasMeasuredMarginRef.current = true;
        setScrollMargin(next);
        setMarginReady(true);
      });
    },
    [scrollContext],
  );

  const remeasure = useCallback(() => {
    const listEl = listContainerRef.current;
    const scrollEl = scrollContext?.scrollElementRef?.current ?? null;
    if (!listEl || !scrollEl) {
      setMarginReady(false);
      return false;
    }
    applyScrollMargin(computeScrollMargin(listEl, scrollEl));
    return true;
  }, [scrollContext, applyScrollMargin]);

  const debouncedRemeasureRef = useRef(null);
  if (!debouncedRemeasureRef.current) {
    debouncedRemeasureRef.current = debounce(() => remeasure(), 50);
  }

  const setListContainerRef = useCallback(
    (el) => {
      listContainerRef.current = el;
      if (el && wantsVirtualize) {
        remeasure();
      } else if (!el) {
        setMarginReady(false);
        scrollMarginRef.current = 0;
        hasMeasuredMarginRef.current = false;
      }
    },
    [wantsVirtualize, remeasure],
  );

  useLayoutEffect(() => {
    if (!wantsVirtualize) {
      setMarginReady(false);
      scrollMarginRef.current = 0;
      hasMeasuredMarginRef.current = false;
      return;
    }
    remeasure();
  }, [wantsVirtualize, remeasure, cases.length]);

  useEffect(() => {
    if (!wantsVirtualize || typeof ResizeObserver === "undefined") return;
    const listEl = listContainerRef.current;
    if (!listEl) return;

    const debounced = debouncedRemeasureRef.current;
    const ro = new ResizeObserver(() => debounced());
    ro.observe(listEl);

    return () => {
      ro.disconnect();
      debounced.cancel?.();
    };
  }, [wantsVirtualize, marginReady, cases.length]);

  useEffect(() => {
    return () => debouncedRemeasureRef.current?.cancel?.();
  }, []);

  const shouldVirtualize = wantsVirtualize && marginReady;

  const virtualizer = useVirtualizer({
    count: cases.length,
    getScrollElement: () => scrollContext?.scrollElementRef?.current ?? null,
    estimateSize: () => CASE_ROW_ESTIMATE_PX,
    overscan: VIRTUAL_CASE_LIST_OVERSCAN,
    scrollMargin,
    enabled: shouldVirtualize,
  });

  useEffect(() => {
    if (!shouldVirtualize || !listId || !registry?.register) return;
    const api = {
      scrollToIndex: (index, options) => virtualizer.scrollToIndex(index, options),
    };
    return registry.register(listId, api);
  }, [shouldVirtualize, listId, registry, virtualizer]);

  if (!cases.length) return null;

  if (!wantsVirtualize) {
    return (
      <>
        {cases.map((c, index) => (
          <span key={c.file_path ?? index} style={{ display: "contents" }}>
            {renderRow(c, index, { virtual: false, measureRef: null })}
          </span>
        ))}
      </>
    );
  }

  const estimatedHeight = estimateVirtualListHeight(cases.length, CASE_ROW_ESTIMATE_PX);
  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const totalSize = shouldVirtualize
    ? Math.max(virtualizer.getTotalSize(), estimatedHeight)
    : estimatedHeight;
  const margin = shouldVirtualize ? (virtualizer.options.scrollMargin ?? 0) : 0;

  return (
    <li
      ref={setListContainerRef}
      className="relative m-0 list-none p-0"
      style={{ height: totalSize }}
      aria-busy={!shouldVirtualize}
    >
      {virtualItems.map((virtualRow) => {
        const c = cases[virtualRow.index];
        const measureRef = (el) => {
          if (el) virtualizer.measureElement(el);
        };
        return (
          <div
            key={c.file_path ?? virtualRow.key}
            data-index={virtualRow.index}
            ref={measureRef}
            className="absolute left-0 top-0 w-full"
            style={{
              transform: `translateY(${virtualRow.start - margin}px)`,
            }}
          >
            {renderRow(c, virtualRow.index, { virtual: true, measureRef: null })}
          </div>
        );
      })}
    </li>
  );
}

export default VirtualCaseList;
