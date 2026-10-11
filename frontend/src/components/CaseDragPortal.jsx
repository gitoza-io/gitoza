import { createPortal } from "react-dom";
import { Files, GripVertical } from "lucide-react";

/**
 * Floating chip shown while pointer-dragging cases onto a folder.
 */
function CaseDragPortal({ pointerDragUI }) {
  if (!pointerDragUI || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[400] max-w-[min(100vw-24px,20rem)]"
      style={{
        left: pointerDragUI.x,
        top: pointerDragUI.y,
        transform: "translate(14px, 12px)",
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5 rounded-ui border-2 border-indigo-500 bg-white px-3 py-2.5 shadow-xl dark:border-indigo-400 dark:bg-slate-900">
        <div className="flex shrink-0 items-center gap-1 text-indigo-600 dark:text-indigo-400" aria-hidden>
          <GripVertical className="h-5 w-5" />
          {pointerDragUI.paths.length > 1 ? <Files className="h-4 w-4" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
            {pointerDragUI.summaryLine}
          </p>
          {pointerDragUI.detailLine ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
              {pointerDragUI.detailLine}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default CaseDragPortal;
