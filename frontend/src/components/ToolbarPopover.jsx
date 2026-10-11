import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Generic popover for toolbar buttons (Sort, Search, etc.).
 * Renders the popup panel in a Portal on document.body with high z-index
 * so it is never clipped or covered by sticky rows or sidebar overflow.
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether the popover is visible.
 * @param {() => void} props.onClose - Called when the popover should close (backdrop click, Escape).
 * @param {React.ReactNode} props.children - Popover content.
 * @param {React.RefObject<HTMLElement>} props.anchorRef - Ref to the trigger element for positioning.
 * @param {'left'|'right'} [props.align='right'] - Horizontal alignment relative to anchor.
 */
function ToolbarPopover({ open, onClose, children, anchorRef, align = "right" }) {
  const panelRef = useRef(null);
  const [style, setStyle] = useState(null);

  const updatePosition = useCallback(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setStyle({
      position: "fixed",
      top: rect.bottom + 4,
      ...(align === "right"
        ? { right: window.innerWidth - rect.right }
        : { left: rect.left }),
    });
  }, [anchorRef, align]);

  useEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !style) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="fixed z-50 min-w-[10rem]"
        style={style}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export default ToolbarPopover;
