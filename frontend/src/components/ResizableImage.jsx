import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Trash2 } from "lucide-react";
import { useResolvedAssetUrl } from "../hooks/useResolvedAssetUrl";
import { isTauri } from "../utils/tauriEnv";
import { parseMarkdownImageAlt } from "../utils/parseMarkdownImageAlt";
import { clampImageWidthPx, MIN_IMAGE_WIDTH_PX } from "../utils/markdownImageLine";

const FLUID_IMG_CLASS =
  "max-h-96 w-auto max-w-full rounded-md object-contain";
const SIZED_IMG_CLASS =
  "h-auto max-w-full rounded-md object-contain";

/**
 * Inline image with optional Obsidian-style corner resize handle (editor live preview).
 *
 * @param {{
 *   repoSlug: string | null | undefined,
 *   fileName: string,
 *   alt?: string | null,
 *   optimisticAbsolutePath?: string | null,
 *   resizable?: boolean,
 *   disabled?: boolean,
 *   onWidthChange?: (widthPx: number) => void,
 *   onRemove?: () => void,
 *   className?: string,
 * }} props
 */
export default function ResizableImage({
  repoSlug,
  fileName,
  alt = null,
  optimisticAbsolutePath = null,
  resizable = true,
  disabled = false,
  onWidthChange,
  onRemove,
  className = "",
}) {
  const wrapperRef = useRef(null);
  const dragStartRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragWidthPx, setDragWidthPx] = useState(null);
  const [maxContainerWidth, setMaxContainerWidth] = useState(Infinity);

  const { label, widthPx } = parseMarkdownImageAlt(alt);
  const imgAlt = label || "Test case image";

  const { url, loading, error } = useResolvedAssetUrl(
    repoSlug,
    fileName,
    optimisticAbsolutePath,
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const updateMax = () => {
      const parent = el.parentElement;
      const w = parent?.clientWidth ?? el.clientWidth;
      setMaxContainerWidth(w > 0 ? w : Infinity);
    };

    updateMax();
    const ro = new ResizeObserver(updateMax);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);

    return () => ro.disconnect();
  }, []);

  const displayWidthPx =
    dragWidthPx ?? (widthPx != null ? widthPx : null);

  const commitWidth = useCallback(
    (rawPx, { final: isFinal } = { final: false }) => {
      const clamped = clampImageWidthPx(rawPx, maxContainerWidth);
      setDragWidthPx(clamped);
      if (isFinal && typeof onWidthChange === "function") {
        onWidthChange(clamped);
      }
      return clamped;
    },
    [maxContainerWidth, onWidthChange],
  );

  const endDrag = useCallback(() => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    if (start?.lastWidth != null) {
      commitWidth(start.lastWidth, { final: true });
    }
    setDragWidthPx(null);
  }, [commitWidth]);

  const handlePointerMove = useCallback(
    (e) => {
      const start = dragStartRef.current;
      if (!start) return;
      const delta = e.clientX - start.clientX;
      const next = start.startWidth + delta;
      const clamped = commitWidth(next, { final: false });
      dragStartRef.current = { ...start, lastWidth: clamped };
    },
    [commitWidth],
  );

  const handlePointerUp = useCallback(() => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    endDrag();
  }, [handlePointerMove, endDrag]);

  const handleHandlePointerDown = useCallback(
    (e) => {
      if (disabled || !resizable) return;
      e.preventDefault();
      e.stopPropagation();

      const el = wrapperRef.current?.querySelector("img");
      const rect = el?.getBoundingClientRect();
      const startWidth = displayWidthPx ?? rect?.width ?? MIN_IMAGE_WIDTH_PX;

      setIsDragging(true);
      dragStartRef.current = {
        clientX: e.clientX,
        startWidth,
        lastWidth: startWidth,
      };
      setDragWidthPx(clampImageWidthPx(startWidth, maxContainerWidth));

      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [
      disabled,
      resizable,
      displayWidthPx,
      maxContainerWidth,
      handlePointerMove,
      handlePointerUp,
    ],
  );

  if (!fileName) return null;

  const canRemove = typeof onRemove === "function" && !disabled;
  const showRemoveButton = canRemove && isHovered;

  const removeButton = showRemoveButton ? (
    <button
      type="button"
      onClick={onRemove}
      className="absolute right-2 top-2 z-10 rounded-full bg-slate-900/60 p-1 text-white hover:bg-slate-900/80"
      aria-label="Remove screenshot"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  ) : null;

  if (!isTauri()) {
    return (
      <div
        className={`relative inline-block max-w-full ${className}`.trim()}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {removeButton}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Screenshot: {fileName} (desktop app required to preview)
        </p>
      </div>
    );
  }

  const imgStyle =
    displayWidthPx != null ? { width: `${displayWidthPx}px` } : undefined;
  const imgClassName =
    displayWidthPx != null ? SIZED_IMG_CLASS : FLUID_IMG_CLASS;

  const showHandle = resizable && !disabled && (isHovered || isDragging) && url;

  return (
    <div
      ref={wrapperRef}
      className={`group relative inline-block max-w-full ${className}`.trim()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        if (!dragStartRef.current) setIsHovered(false);
      }}
    >
      {removeButton}
      {loading ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading image…
        </span>
      ) : error ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300">
          <ImageIcon className="h-4 w-4 shrink-0" />
          {error}
        </span>
      ) : url ? (
        <>
          <div
            className={
              showHandle
                ? "rounded-md ring-1 ring-slate-300/60 dark:ring-slate-600"
                : ""
            }
          >
            <img
              src={url}
              alt={imgAlt}
              className={imgClassName}
              style={imgStyle}
              draggable={false}
            />
          </div>
          {showHandle ? (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize image"
              className="absolute bottom-1 right-1 z-10 h-3 w-3 cursor-se-resize rounded-sm bg-primary dark:bg-primary-dark"
              onPointerDown={handleHandlePointerDown}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
