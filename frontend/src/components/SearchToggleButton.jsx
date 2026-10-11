import { ArrowLeft, Search } from "lucide-react";
import Tooltip from "./Tooltip";
import { TOOLBAR_BTN_BASE, TOOLBAR_BTN_SELECTED } from "../constants/toolbarStyles";

/**
 * Shared search / back-to-tree toggle button for tree sidebars.
 * Shows gray highlight when open or when there are active search chips (so users know where to click to go back).
 *
 * @param {boolean} isOpen - Whether search (or alternate view) is currently open
 * @param {boolean} [hasActiveChips=false] - Whether there are active search chips; when true, button is also highlighted
 * @param {() => void} onClick - Called when the button is clicked (open search or close and go back)
 * @param {string} ariaLabelWhenClosed - aria-label when closed (e.g. "Search cases", "Search runs", "Search")
 */
function SearchToggleButton({
  isOpen,
  hasActiveChips = false,
  onClick,
  ariaLabelWhenClosed,
}) {
  const selected = isOpen || hasActiveChips;
  return (
    <Tooltip label={isOpen ? "Back to tree" : "Filter"} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        className={`${TOOLBAR_BTN_BASE} ${selected ? TOOLBAR_BTN_SELECTED : ""}`}
        aria-label={isOpen ? "Back to tree" : ariaLabelWhenClosed}
      >
        {isOpen ? <ArrowLeft className="h-4 w-4" /> : <Search className="h-4 w-4" />}
      </button>
    </Tooltip>
  );
}

export default SearchToggleButton;
