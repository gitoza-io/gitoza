import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { documentIsDarkTheme } from "../utils/theme";

const SHOW_DELAY_MS = 600;
const HIDE_DELAY_MS = 100;
const GAP_PX = 8;
const VIEWPORT_MARGIN = 8;
const ARROW_EDGE_PAD = 10;

// Softer, less prominent — uses token surfaces where possible
const TOOLTIP_BASE_CLASS =
  "pointer-events-none z-[1000] rounded-ui px-2 py-1 text-xs font-medium shadow-md max-w-xs " +
  "bg-surface text-ink border border-border";

// Arrow: softer triangle (wider base, shorter tip) for a friendlier look; color matches tooltip
const ARROW_LENGTH = 5; // distance from tooltip edge to tip
const ARROW_HALF_BASE = 4; // half of base width (full base = 8px), gives ~64° tip angle
const ARROW_COLOR_LIGHT = "rgb(241 245 249)"; // surface light
const ARROW_COLOR_DARK = "rgb(45 45 45)"; // surface dark-plus

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Reusable tooltip: shows after hover delay, has a small arrow pointing at the trigger.
 * Rendered in a portal so it is not clipped by overflow. Closes on click (trigger or document).
 * Accessible (focus triggers tooltip).
 *
 * For bottom/top: measures real width, clamps to the viewport, and keeps the arrow on the trigger.
 *
 * @param {{ label: string; children: React.ReactNode; placement?: 'right' | 'top' | 'bottom' | 'bottom-end'; delayMs?: number }} props
 * - bottom-end: tooltip below trigger, right edge aligned with trigger's right; arrow on the right.
 */
function Tooltip({ label, children, placement = "right", delayMs = SHOW_DELAY_MS }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    arrowOffset: null,
    aligned: false,
  });
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const showTimerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const suppressShowUntilRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hideImmediate = useCallback(() => {
    clearTimers();
    setVisible(false);
    setPosition({ left: 0, top: 0, arrowOffset: null, aligned: false });
  }, [clearTimers]);

  const show = useCallback(() => {
    if (Date.now() < suppressShowUntilRef.current) return;
    clearTimers();
    showTimerRef.current = setTimeout(() => setVisible(true), delayMs);
  }, [clearTimers, delayMs]);

  const hide = useCallback(() => {
    clearTimers();
    hideTimerRef.current = setTimeout(hideImmediate, HIDE_DELAY_MS);
  }, [clearTimers, hideImmediate]);

  // Mount portal (hidden), measure width, clamp to viewport, point arrow at trigger.
  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tooltipRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const width = tooltipRef.current.offsetWidth || 0;
    if (width <= 0) return;

    const viewportWidth =
      typeof window !== "undefined"
        ? window.innerWidth || document.documentElement.clientWidth || 0
        : 0;
    if (viewportWidth <= 0) return;

    let left;
    let top;
    let arrowOffset = null;

    if (placement === "top") {
      top = rect.top - GAP_PX;
      left = clamp(
        centerX - width / 2,
        VIEWPORT_MARGIN,
        viewportWidth - VIEWPORT_MARGIN - width,
      );
      arrowOffset = clamp(
        centerX - left,
        ARROW_EDGE_PAD,
        Math.max(ARROW_EDGE_PAD, width - ARROW_EDGE_PAD),
      );
    } else if (placement === "bottom") {
      top = rect.bottom + GAP_PX;
      left = clamp(
        centerX - width / 2,
        VIEWPORT_MARGIN,
        viewportWidth - VIEWPORT_MARGIN - width,
      );
      arrowOffset = clamp(
        centerX - left,
        ARROW_EDGE_PAD,
        Math.max(ARROW_EDGE_PAD, width - ARROW_EDGE_PAD),
      );
    } else if (placement === "bottom-end") {
      top = rect.bottom + GAP_PX;
      left = clamp(
        rect.right,
        VIEWPORT_MARGIN + width,
        viewportWidth - VIEWPORT_MARGIN,
      );
    } else {
      top = centerY;
      left = clamp(
        rect.right + GAP_PX,
        VIEWPORT_MARGIN,
        viewportWidth - VIEWPORT_MARGIN - width,
      );
    }

    setPosition({ left, top, arrowOffset, aligned: true });
  }, [visible, placement, label]);

  const hideFromClick = useCallback(() => {
    hideImmediate();
    suppressShowUntilRef.current = Date.now() + 400;
  }, [hideImmediate]);

  useEffect(() => {
    if (!visible) return;
    const onDocClick = () => hideFromClick();
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [visible, hideFromClick]);

  const isDark = documentIsDarkTheme();
  const arrowColor = isDark ? ARROW_COLOR_DARK : ARROW_COLOR_LIGHT;
  const arrowOffset = position.arrowOffset;

  const arrowStyleRight = {
    position: "absolute",
    left: -ARROW_LENGTH,
    top: "50%",
    transform: "translateY(-50%)",
    width: 0,
    height: 0,
    borderTop: `${ARROW_HALF_BASE}px solid transparent`,
    borderBottom: `${ARROW_HALF_BASE}px solid transparent`,
    borderRight: `${ARROW_LENGTH}px solid ${arrowColor}`,
  };
  const arrowStyleTop = {
    position: "absolute",
    bottom: -ARROW_LENGTH,
    left: arrowOffset != null ? arrowOffset : "50%",
    transform: "translateX(-50%)",
    width: 0,
    height: 0,
    borderLeft: `${ARROW_HALF_BASE}px solid transparent`,
    borderRight: `${ARROW_HALF_BASE}px solid transparent`,
    borderTop: `${ARROW_LENGTH}px solid ${arrowColor}`,
  };
  const arrowStyleBottom = {
    position: "absolute",
    top: -ARROW_LENGTH,
    left: arrowOffset != null ? arrowOffset : "50%",
    transform: "translateX(-50%)",
    width: 0,
    height: 0,
    borderLeft: `${ARROW_HALF_BASE}px solid transparent`,
    borderRight: `${ARROW_HALF_BASE}px solid transparent`,
    borderBottom: `${ARROW_LENGTH}px solid ${arrowColor}`,
  };
  const arrowStyleBottomEnd = {
    position: "absolute",
    top: -ARROW_LENGTH,
    right: 8,
    left: "auto",
    width: 0,
    height: 0,
    borderLeft: `${ARROW_HALF_BASE}px solid transparent`,
    borderRight: `${ARROW_HALF_BASE}px solid transparent`,
    borderBottom: `${ARROW_LENGTH}px solid ${arrowColor}`,
  };
  const arrowStyle =
    placement === "top"
      ? arrowStyleTop
      : placement === "bottom"
        ? arrowStyleBottom
        : placement === "bottom-end"
          ? arrowStyleBottomEnd
          : arrowStyleRight;

  const transform =
    placement === "top"
      ? "translateY(-100%)"
      : placement === "bottom"
        ? "none"
        : placement === "bottom-end"
          ? "translate(-100%, 0)"
          : "translateY(-50%)";

  const tooltipContent =
    visible && typeof document !== "undefined"
      ? createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            className={`${TOOLTIP_BASE_CLASS} relative overflow-visible`}
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              transform,
              visibility: position.aligned ? "visible" : "hidden",
            }}
          >
            <span style={arrowStyle} aria-hidden="true" role="presentation" />
            {label}
          </span>,
          document.body,
        )
      : null;

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
        onClick={hideFromClick}
      >
        {children}
      </span>
      {tooltipContent}
    </>
  );
}

export default Tooltip;
