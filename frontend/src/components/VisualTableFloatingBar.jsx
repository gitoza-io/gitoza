import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BetweenHorizonalEnd,
  BetweenVerticalEnd,
  Trash2,
} from "lucide-react";
import Tooltip from "./Tooltip";
import { usePersistentViewActive } from "./PersistentView";

const btnCls =
  "inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100";

/**
 * Resolve the DOM table (or wrapper) under the current selection.
 * @param {import('@tiptap/core').Editor} editor
 * @returns {HTMLElement | null}
 */
function getActiveTableElement(editor) {
  if (!editor?.view) return null;
  const { from } = editor.state.selection;
  try {
    const dom = editor.view.domAtPos(from);
    const node = dom.node instanceof Element ? dom.node : dom.node?.parentElement;
    if (!node || typeof node.closest !== "function") return null;
    return (
      node.closest(".tableWrapper") ||
      node.closest("table") ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Bottom edge of sticky/fixed chrome above the editor (e.g. markdown toolbar).
 * Used so the float can flip below the table instead of covering that chrome.
 * @param {HTMLElement} fromEl
 * @returns {number}
 */
function getStickyChromeBottom(fromEl) {
  let bottom = 8;
  let node = fromEl;
  while (node && node !== document.body) {
    const parent = node.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling === node) break;
      if (!(sibling instanceof HTMLElement)) continue;
      const pos = window.getComputedStyle(sibling).position;
      if (pos === "sticky" || pos === "fixed") {
        const r = sibling.getBoundingClientRect();
        if (r.bottom > bottom) bottom = r.bottom;
      }
    }
    const pos = window.getComputedStyle(node).position;
    if (pos === "sticky" || pos === "fixed") {
      const r = node.getBoundingClientRect();
      if (r.bottom > bottom && r.bottom <= fromEl.getBoundingClientRect().top) {
        bottom = r.bottom;
      }
    }
    node = parent;
  }
  return bottom;
}

/**
 * @param {{ label: string, children: import('react').ReactNode }} props
 */
function FloatTip({ label, children }) {
  return (
    <Tooltip label={label} placement="bottom">
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}

/**
 * Floating structure controls shown while the cursor is inside a TipTap table.
 * @param {{
 *   editor: import('@tiptap/core').Editor | null,
 *   disabled?: boolean,
 * }} props
 */
export default function VisualTableFloatingBar({ editor, disabled = false }) {
  const viewActive = usePersistentViewActive();
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState(null);

  const hide = useCallback(() => {
    setVisible(false);
    setStyle(null);
  }, []);

  const update = useCallback(() => {
    if (!viewActive || !editor || disabled || editor.isDestroyed) {
      hide();
      return;
    }
    if (!editor.isActive("table") || !editor.view?.dom?.isConnected) {
      hide();
      return;
    }
    const el = getActiveTableElement(editor);
    if (!el) {
      hide();
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      hide();
      return;
    }
    const barApproxHeight = 36;
    const gap = 2;
    const minTop = getStickyChromeBottom(editor.view.dom) + gap;
    let top = rect.top - barApproxHeight - gap;
    // Prefer flush above the table; if that would cover sticky chrome, flip below.
    if (top < minTop) {
      top = rect.bottom + gap;
    }
    setStyle({
      position: "fixed",
      top,
      left: Math.max(8, rect.left),
      zIndex: 50,
    });
    setVisible(true);
  }, [editor, disabled, viewActive, hide]);

  useEffect(() => {
    if (!editor) {
      hide();
      return undefined;
    }
    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      hide();
    };
  }, [editor, update, hide]);

  if (!visible || !style || !editor) return null;

  const run = (command) => {
    editor.chain().focus()[command]().run();
  };

  return createPortal(
    <div
      className="visual-md-table-float flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 shadow-md dark:border-slate-600 dark:bg-slate-800"
      style={style}
      role="toolbar"
      aria-label="Table structure"
      onMouseDown={(e) => {
        // Keep cell selection; do not let the bar steal focus before the command.
        e.preventDefault();
      }}
    >
      <FloatTip label="Add row below">
        <button
          type="button"
          className={btnCls}
          aria-label="Add row below"
          onClick={() => run("addRowAfter")}
        >
          <BetweenHorizonalEnd className="h-3.5 w-3.5" />
          Row
        </button>
      </FloatTip>
      <FloatTip label="Add column after">
        <button
          type="button"
          className={btnCls}
          aria-label="Add column after"
          onClick={() => run("addColumnAfter")}
        >
          <BetweenVerticalEnd className="h-3.5 w-3.5" />
          Col
        </button>
      </FloatTip>
      <span
        className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600"
        aria-hidden
      />
      <FloatTip label="Delete row">
        <button
          type="button"
          className={btnCls}
          aria-label="Delete row"
          onClick={() => run("deleteRow")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Del row
        </button>
      </FloatTip>
      <FloatTip label="Delete column">
        <button
          type="button"
          className={btnCls}
          aria-label="Delete column"
          onClick={() => run("deleteColumn")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Del col
        </button>
      </FloatTip>
    </div>,
    document.body,
  );
}
