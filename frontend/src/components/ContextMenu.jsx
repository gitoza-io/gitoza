import { useEffect, useRef, useState } from "react";

/**
 * Shared context menu shell: portal (positioned + overlay) and item building.
 * Layer 1: reusable UI for right-click menus across Run, Case tree, Sidebar tree.
 */

const PORTAL_CLASS =
  "fixed z-[100] min-w-[10rem] rounded-ui border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900";

const ITEM_BASE_CLASS =
  "flex w-full items-center gap-2.5 rounded-ui px-3 py-1.5 text-left text-sm transition";
const ITEM_DEFAULT_CLASS =
  "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-300 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300";
const ITEM_DANGER_CLASS =
  "text-slate-700 hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-500/20 dark:hover:text-red-300";

const SEPARATOR_CLASS = "my-1 border-t border-slate-200 dark:border-slate-700";

/** Single menu item: icon + label, optional right-aligned hint, optional variant "danger", optional disabled + title (tooltip). */
export function ContextMenuItem({
  icon: Icon,
  label,
  hint,
  onClick,
  variant = "default",
  disabled = false,
  title,
}) {
  const className =
    variant === "danger" ? `${ITEM_BASE_CLASS} ${ITEM_DANGER_CLASS}` : `${ITEM_BASE_CLASS} ${ITEM_DEFAULT_CLASS}`;
  const disabledClass = "cursor-not-allowed opacity-50";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={title}
      className={disabled ? `${className} ${disabledClass}` : className}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {hint ? (
        <span className="ml-3 shrink-0 text-xs text-slate-400 dark:text-slate-500">{hint}</span>
      ) : null}
    </button>
  );
}

/** Renders a separator between menu items. */
export function ContextMenuSeparator() {
  return <div className={SEPARATOR_CLASS} role="separator" />;
}

/**
 * Portal: positions the menu at (x, y), keeps it in viewport.
 * Backdrop is pointer-events-none so right-click can reach tree rows (VS Code-style retarget).
 * Dismisses on primary mousedown outside, Escape, or scroll.
 * @param {number} x - clientX
 * @param {number} y - clientY
 * @param {() => void} onClose - called when menu should close
 * @param {React.ReactNode} children - menu content
 * @param {string} [className] - optional extra class for the menu panel
 */
export function ContextMenuPortal({ x, y, onClose, children, className = "" }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      x: x + rect.width > vw ? vw - rect.width - 8 : x,
      y: y + rect.height > vh ? vh - rect.height - 8 : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onMouseDown = (e) => {
      const panel = ref.current;
      if (!panel || e.button !== 0) return;
      if (panel.contains(e.target)) return;
      onClose?.();
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    const onScroll = () => onClose?.();

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[99]" aria-hidden />
      <div
        ref={ref}
        className={`pointer-events-auto ${PORTAL_CLASS} ${className}`.trim()}
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        role="menu"
      >
        {children}
      </div>
    </>
  );
}

/**
 * Full context menu: overlay + portal + list of items.
 * @param {boolean} open - whether menu is visible
 * @param {number} [x] - clientX when open
 * @param {number} [y] - clientY when open
 * @param {() => void} onClose - close handler
 * @param {({ icon?: React.ComponentType, label?: string, hint?: string, onClick?: () => void, variant?: 'default'|'danger' }|{ type: 'separator' })[]} [items] - menu items; use { type: 'separator' } for a divider
 * @param {React.ReactNode} [children] - optional custom content after items
 */
export function ContextMenu({ open, x = 0, y = 0, onClose, items = [], children }) {
  if (!open) return null;
  return (
    <ContextMenuPortal x={x} y={y} onClose={onClose}>
      {items.map((item, i) =>
        item.type === "separator" ? (
          <ContextMenuSeparator key={i} />
        ) : (
          <ContextMenuItem
            key={i}
            icon={item.icon}
            label={item.label}
            hint={item.hint}
            onClick={() => {
              if (!item.disabled) {
                item.onClick?.();
                onClose?.();
              }
            }}
            variant={item.variant ?? "default"}
            disabled={item.disabled}
            title={item.title}
          />
        )
      )}
      {children}
    </ContextMenuPortal>
  );
}

export default ContextMenu;
