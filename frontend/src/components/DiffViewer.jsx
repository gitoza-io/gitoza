import { useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DIFF_LINE_ESTIMATE_PX,
  VIRTUAL_DIFF_VIEWER_OVERSCAN,
  VIRTUAL_DIFF_VIEWER_THRESHOLD,
} from "../constants/virtualDiffViewer";

const MONO_FONT = "'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace";
const DIFF_LINE_HEIGHT = 20; // px — line spacing for readability

function diffLineClasses(line) {
  const isAdd = line.startsWith("+") && !line.startsWith("+++");
  const isDel = line.startsWith("-") && !line.startsWith("---");
  return {
    isAdd,
    isDel,
    className: `block w-full px-4 py-0.5 whitespace-pre-wrap break-words ${
      isAdd ? "bg-emerald-500/20 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : ""
    } ${isDel ? "bg-red-500/20 text-red-800 dark:bg-red-900/40 dark:text-red-200" : ""} ${
      !isAdd && !isDel ? "bg-slate-50 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300" : ""
    }`,
  };
}

function DiffLineRow({ line, measureRef = null }) {
  const { className } = diffLineClasses(line);
  return (
    <div
      ref={measureRef}
      data-diff-line
      className={className}
      style={{ lineHeight: `${DIFF_LINE_HEIGHT}px` }}
    >
      {line || "\u00A0"}
    </div>
  );
}

function DiffLineList({ lines }) {
  return (
    <div
      className="w-full text-xs"
      style={{ fontFamily: MONO_FONT, lineHeight: `${DIFF_LINE_HEIGHT}px` }}
    >
      {lines.map((line, i) => (
        <DiffLineRow key={i} line={line} />
      ))}
    </div>
  );
}

function VirtualizedDiffLineList({ lines, parentScrollRef }) {
  const shouldVirtualize =
    lines.length >= VIRTUAL_DIFF_VIEWER_THRESHOLD && parentScrollRef != null;

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentScrollRef?.current ?? null,
    estimateSize: () => DIFF_LINE_ESTIMATE_PX,
    overscan: VIRTUAL_DIFF_VIEWER_OVERSCAN,
    enabled: shouldVirtualize,
  });

  if (!shouldVirtualize) {
    return <DiffLineList lines={lines} />;
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      className="relative w-full text-xs"
      style={{ fontFamily: MONO_FONT, lineHeight: `${DIFF_LINE_HEIGHT}px`, height: totalSize }}
    >
      {virtualItems.map((virtualRow) => {
        const line = lines[virtualRow.index];
        const measureRef = (el) => {
          if (el) virtualizer.measureElement(el);
        };
        return (
          <div
            key={virtualRow.index}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <DiffLineRow line={line} measureRef={measureRef} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Diff viewer: wrapped lines, full-width +/- highlighting, monospace, no height transitions.
 * Used in ConfirmChangesView.
 *
 * @param {{ content: string; parentScrollRef?: import('react').RefObject<HTMLElement | null> }} props
 */
export function DiffViewer({ content, parentScrollRef = null }) {
  const lines = useMemo(() => (content ? content.split("\n") : []), [content]);

  if (!content) {
    return (
      <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400" style={{ fontFamily: MONO_FONT }}>
        No diff for this file.
      </p>
    );
  }

  return <VirtualizedDiffLineList lines={lines} parentScrollRef={parentScrollRef} />;
}

export { MONO_FONT };
