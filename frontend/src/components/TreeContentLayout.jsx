import { useCallback, useEffect, useRef, useState } from "react";
import { TreeAreaHoverProvider } from "../contexts/TreeAreaHoverContext";
import SidebarSection from "./SidebarSection";
import { TreeScrollContainer } from "../contexts/TreeScrollContext";
import { flexFillScroll } from "../utils/layoutClasses";

const STORAGE_KEY = "treeContentLayout.sidebarWidth";
const MIN_SIDEBAR_WIDTH = 140;
const MIN_DETAIL_WIDTH = 200;
const DEFAULT_SIDEBAR_WIDTH = 220;
const DEFAULT_WIDE_SIDEBAR_WIDTH = 380;
/** Matches `w-1` on the resize handle. */
const DIVIDER_WIDTH = 4;

function readStoredWidth() {
  try {
    const w = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (Number.isFinite(w) && w >= MIN_SIDEBAR_WIDTH) return w;
  } catch (_) {}
  return DEFAULT_SIDEBAR_WIDTH;
}

function maxSidebarWidthForContainer(containerWidth) {
  if (containerWidth <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(MIN_SIDEBAR_WIDTH, containerWidth - DIVIDER_WIDTH - MIN_DETAIL_WIDTH);
}

/**
 * Shared "left tree + right content" layout used by Test Repository and Test Run.
 * Single definition of the frame; each page supplies sidebar and main content.
 * The divider between tree and content is resizable up to the available width (both panels keep minimum widths).
 *
 * Sidebar header can be supplied in two ways:
 * - sidebarHeader: custom header node (fixed above the tree, only tree scrolls).
 * - sidebarTitle + sidebarToolbar: layout builds a fixed header via SidebarSection (same behavior).
 * When either form is used, only sidebarContent scrolls; otherwise the whole sidebar scrolls.
 *
 * @param {React.ReactNode} [sidebarHeader] - Optional custom fixed header above the tree. If provided, only sidebarContent scrolls.
 * @param {string} [sidebarTitle] - Optional section title for the sidebar. When set (with or without sidebarToolbar), layout renders SidebarSection as fixed header; ignored if sidebarHeader is provided.
 * @param {React.ReactNode} [sidebarTitleSuffix] - Optional node rendered immediately after the title on the left (e.g. tabs next to "Review").
 * @param {React.ReactNode} [sidebarToolbar] - Optional toolbar (filters, buttons) for the sidebar. Used with sidebarTitle when no sidebarHeader is provided.
 * @param {React.ReactNode} sidebarContent - Left column content (tree, list, or search panel). Scrolls with header if no header; scrolls in its own area if a header is set.
 * @param {React.ReactNode} [sidebarFooter] - Optional fixed footer below the tree (e.g. workspace switcher). Always visible at the bottom of the sidebar.
 * @param {React.ReactNode} children - Right panel content.
 */
function TreeContentLayout({
  sidebarHeader = null,
  sidebarTitle = null,
  sidebarTitleSuffix = null,
  sidebarTitleRight = null,
  sidebarToolbar = null,
  sidebarContent,
  sidebarFooter = null,
  /** When true, use a wider default sidebar (e.g. Test Repository two-pane browse). */
  wideSidebar = false,
  children,
}) {
  const resolvedHeader =
    sidebarHeader ??
    (sidebarTitle != null && sidebarTitle !== ""
      ? <SidebarSection title={sidebarTitle} titleSuffix={sidebarTitleSuffix} titleRight={sidebarTitleRight} toolbar={sidebarToolbar} />
      : null);
  const hasHeader = resolvedHeader != null;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = readStoredWidth();
    if (stored !== DEFAULT_SIDEBAR_WIDTH) return stored;
    return wideSidebar ? DEFAULT_WIDE_SIDEBAR_WIDTH : DEFAULT_SIDEBAR_WIDTH;
  });
  const [layoutWidth, setLayoutWidth] = useState(0);
  const containerRef = useRef(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const maxSidebarWidth = maxSidebarWidthForContainer(layoutWidth);

  const clampWidth = useCallback(
    (w) => Math.min(maxSidebarWidth, Math.max(MIN_SIDEBAR_WIDTH, w)),
    [maxSidebarWidth]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => setLayoutWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (layoutWidth <= 0) return;
    setSidebarWidth((w) => clampWidth(w));
  }, [layoutWidth, clampWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
    } catch (_) {}
  }, [sidebarWidth]);

  const startDrag = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (e) => {
        const delta = e.clientX - startX.current;
        setSidebarWidth((prev) => clampWidth(startWidth.current + delta));
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
    [sidebarWidth, clampWidth]
  );

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0 flex-1 gap-0 overflow-hidden bg-white dark:bg-slate-950"
    >
      <aside
        className="flex h-full shrink-0 flex-col overflow-hidden"
        style={{ width: sidebarWidth }}
      >
        <TreeAreaHoverProvider>
          {hasHeader ? (
            <>
              <div className="shrink-0 space-y-1 border-b border-slate-200 pl-0 pr-2 py-2 dark:border-slate-700">
                {resolvedHeader}
              </div>
              <TreeScrollContainer className={`${flexFillScroll} pl-0 pr-2 pt-0 pb-2`}>
                {sidebarContent}
              </TreeScrollContainer>
            </>
          ) : (
            <TreeScrollContainer className={`${flexFillScroll} pl-0 pr-2 pt-0 pb-2`}>
              {sidebarContent}
            </TreeScrollContainer>
          )}
        </TreeAreaHoverProvider>
        {sidebarFooter != null && (
          <div data-sidebar-footer className="shrink-0 border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
            {sidebarFooter}
          </div>
        )}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={sidebarWidth}
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maxSidebarWidth}
        className="w-1 flex-shrink-0 cursor-col-resize touch-none border-l border-slate-300 hover:border-indigo-400 dark:border-slate-600 dark:hover:border-indigo-500"
        onMouseDown={startDrag}
        title="Drag to resize"
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export default TreeContentLayout;
