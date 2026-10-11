/**
 * Shared toolbar button styles for tree/sidebar actions (search, archived toggle, etc.).
 * Use TOOLBAR_BTN_SELECTED when the button represents "current mode" or "click to go back".
 */

export const TOOLBAR_BTN_BASE =
  "rounded-ui h-7 w-7 flex items-center justify-center leading-none text-muted hover:bg-list-hover hover:text-ink disabled:opacity-40 disabled:pointer-events-none";

/** Gray highlight for selected/active state (e.g. search open, archived view, back to tree). */
export const TOOLBAR_BTN_SELECTED =
  "bg-list-selected text-ink";
