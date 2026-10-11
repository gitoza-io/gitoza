/**
 * Shared layout class names for flex fill and scroll areas.
 * Use so layout behavior is consistent and editable in one place.
 */
export const flexFillHidden = "min-h-0 flex-1 overflow-hidden";
/** Primary scroll regions: thin scrollbar (main-content-scroll in index.css), limit overscroll rubber-band. */
export const flexFillScroll =
  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain main-content-scroll";
/** Browse tree and case-list columns: prevent accidental text selection during drag/context menu. */
export const browseColumnNoSelect = "select-none";
