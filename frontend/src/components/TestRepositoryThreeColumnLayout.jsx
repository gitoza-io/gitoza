import { useCallback, useEffect, useRef, useState } from "react";
import { browseColumnNoSelect } from "../utils/layoutClasses";

const DEFAULT_TREE_WIDTH_KEY = "testRepo.col.treeWidth";
const DEFAULT_LIST_WIDTH_KEY = "testRepo.col.listWidth";
const DEFAULT_TREE_WIDTH = 200;
const DEFAULT_LIST_WIDTH = 260;
const MIN_TREE_WIDTH = 140;
const MIN_LIST_WIDTH = 200;
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
 * Three-column Test Repository layout: tree navigator | case list | detail.
 */
function TestRepositoryThreeColumnLayout({
  treeColumn,
  caseListColumn,
  detailColumn,
  storageKeys,
  /** When false, hide the case list column and its resize handle (detail expands). */
  caseListVisible = true,
}) {
  const treeWidthKey = storageKeys?.treeWidth ?? DEFAULT_TREE_WIDTH_KEY;
  const listWidthKey = storageKeys?.listWidth ?? DEFAULT_LIST_WIDTH_KEY;
  const [treeWidth, setTreeWidth] = useState(() => readStoredWidth(treeWidthKey, DEFAULT_TREE_WIDTH));
  const [listWidth, setListWidth] = useState(() => readStoredWidth(listWidthKey, DEFAULT_LIST_WIDTH));
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

  const dividerCount = caseListVisible ? 2 : 1;
  const maxListWidth = Math.max(
    MIN_LIST_WIDTH,
    layoutWidth - treeWidth - DIVIDER_WIDTH * dividerCount - MIN_DETAIL_WIDTH,
  );
  const maxTreeWidth = caseListVisible
    ? Math.max(
        MIN_TREE_WIDTH,
        layoutWidth - listWidth - DIVIDER_WIDTH * dividerCount - MIN_DETAIL_WIDTH,
      )
    : Math.max(MIN_TREE_WIDTH, layoutWidth - DIVIDER_WIDTH - MIN_DETAIL_WIDTH);

  useEffect(() => {
    if (layoutWidth <= 0) return;
    setTreeWidth((w) => Math.min(maxTreeWidth, Math.max(MIN_TREE_WIDTH, w)));
    setListWidth((w) => Math.min(maxListWidth, Math.max(MIN_LIST_WIDTH, w)));
  }, [layoutWidth, maxTreeWidth, maxListWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(treeWidthKey, String(treeWidth));
      localStorage.setItem(listWidthKey, String(listWidth));
    } catch (_) {}
  }, [treeWidth, listWidth, treeWidthKey, listWidthKey]);

  const startTreeDrag = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = treeWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev) => {
        const delta = ev.clientX - startX;
        setTreeWidth(Math.min(maxTreeWidth, Math.max(MIN_TREE_WIDTH, startW + delta)));
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
    [treeWidth, maxTreeWidth],
  );

  const startListDrag = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = listWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev) => {
        const delta = ev.clientX - startX;
        setListWidth(Math.min(maxListWidth, Math.max(MIN_LIST_WIDTH, startW + delta)));
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
    [listWidth, maxListWidth],
  );

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-white dark:bg-slate-950"
    >
      <aside
        className={`flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-slate-200 dark:border-slate-700 ${browseColumnNoSelect}`}
        style={{ width: treeWidth }}
      >
        {treeColumn}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        className="w-1 shrink-0 cursor-col-resize touch-none border-l border-slate-300 hover:border-indigo-400 dark:border-slate-600 dark:hover:border-indigo-500"
        onMouseDown={startTreeDrag}
        title="Resize tree column"
      />
      {caseListVisible ? (
        <>
          <section
            className={`flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/20 ${browseColumnNoSelect}`}
            style={{ width: listWidth }}
          >
            {caseListColumn}
          </section>
          <div
            role="separator"
            aria-orientation="vertical"
            className="w-1 shrink-0 cursor-col-resize touch-none border-l border-slate-300 hover:border-indigo-400 dark:border-slate-600 dark:hover:border-indigo-500"
            onMouseDown={startListDrag}
            title="Resize case list column"
          />
        </>
      ) : null}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{detailColumn}</main>
    </div>
  );
}

export default TestRepositoryThreeColumnLayout;
