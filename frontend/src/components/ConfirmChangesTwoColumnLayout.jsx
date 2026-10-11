import { useCallback, useEffect, useRef, useState } from "react";
import { browseColumnNoSelect } from "../utils/layoutClasses";

const DEFAULT_SIDEBAR_WIDTH_KEY = "confirmChanges.col.sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 200;
const MIN_DETAIL_WIDTH = 280;
const DIVIDER_WIDTH = 4;

function readStoredWidth(key, fallback) {
  try {
    const w = parseInt(localStorage.getItem(key), 10);
    if (Number.isFinite(w) && w > 0) return w;
  } catch (_) {}
  return fallback;
}

/**
 * Two-column Confirm Changes layout: changelist sidebar | diff detail.
 */
function ConfirmChangesTwoColumnLayout({
  sidebarColumn,
  detailColumn,
  storageKeys,
}) {
  const sidebarWidthKey = storageKeys?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH_KEY;
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    readStoredWidth(sidebarWidthKey, DEFAULT_SIDEBAR_WIDTH),
  );
  const [layoutWidth, setLayoutWidth] = useState(0);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => setLayoutWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxSidebarWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    layoutWidth - DIVIDER_WIDTH - MIN_DETAIL_WIDTH,
  );

  useEffect(() => {
    if (layoutWidth <= 0) return;
    setSidebarWidth((w) => Math.min(maxSidebarWidth, Math.max(MIN_SIDEBAR_WIDTH, w)));
  }, [layoutWidth, maxSidebarWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(sidebarWidthKey, String(sidebarWidth));
    } catch (_) {}
  }, [sidebarWidth, sidebarWidthKey]);

  const startSidebarDrag = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev) => {
        const delta = ev.clientX - startX;
        setSidebarWidth(Math.min(maxSidebarWidth, Math.max(MIN_SIDEBAR_WIDTH, startW + delta)));
      };
      const onEnd = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onEnd);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
    },
    [sidebarWidth, maxSidebarWidth],
  );

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-white dark:bg-slate-950"
    >
      <aside
        className={`flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-slate-200 dark:border-slate-700 ${browseColumnNoSelect}`}
        style={{ width: sidebarWidth }}
      >
        {sidebarColumn}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        className="w-1 shrink-0 cursor-col-resize touch-none border-l border-slate-300 hover:border-indigo-400 dark:border-slate-600 dark:hover:border-indigo-500"
        onMouseDown={startSidebarDrag}
        title="Resize changelist column"
      />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{detailColumn}</main>
    </div>
  );
}

export default ConfirmChangesTwoColumnLayout;
