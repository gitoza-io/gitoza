import { Plus } from "lucide-react";
import Tooltip from "./Tooltip";
import { TOOLBAR_BTN_BASE } from "../constants/toolbarStyles";

/**
 * Reusable icon-only "add" button for toolbars (Test Repository, Test Runs).
 * Styled to match filter/sort buttons. Use for "Create project" or "Create new run".
 *
 * @param {{ tooltip: string; onClick: () => void; ariaLabel?: string }} props
 */
function TitleBarAddButton({ tooltip, onClick, ariaLabel }) {
  const label = ariaLabel ?? tooltip;
  return (
    <Tooltip label={tooltip} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={TOOLBAR_BTN_BASE}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </Tooltip>
  );
}

export default TitleBarAddButton;
