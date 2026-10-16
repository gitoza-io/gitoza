import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ClipboardCopy,
  Maximize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import mermaid from "mermaid";
import { documentIsDarkTheme } from "../utils/theme";

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const ZOOM_STEP = 1.2;
/** Viewport padding so the fitted diagram is not flush with window edges. */
const FIT_PADDING_PX = 64;

const TOOLBAR_BTN_CLASS =
  "rounded-md bg-slate-900/80 p-1.5 text-white shadow-sm transition hover:bg-slate-900 dark:bg-slate-700/90 dark:hover:bg-slate-600";

const VIEWER_BTN_CLASS =
  "rounded-full border border-slate-300 bg-white/95 p-2 text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-100 dark:hover:bg-slate-700";

function isDarkTheme() {
  return documentIsDarkTheme();
}

function mermaidThemeVariables(isDark) {
  if (isDark) {
    const themeId =
      typeof document !== "undefined"
        ? document.documentElement.dataset.theme
        : "dark-plus";
    const isHc = themeId === "high-contrast";
    return {
      darkMode: true,
      background: isHc ? "#000000" : "#1e1e1e",
      primaryColor: isHc ? "#141414" : "#252526",
      primaryTextColor: isHc ? "#ffffff" : "#cccccc",
      primaryBorderColor: isHc ? "#ffffff" : "#3c3c3c",
      secondaryColor: isHc ? "#1a1a1a" : "#2d2d2d",
      secondaryTextColor: isHc ? "#ffffff" : "#cccccc",
      secondaryBorderColor: isHc ? "#ffffff" : "#3c3c3c",
      tertiaryColor: isHc ? "#141414" : "#252526",
      tertiaryTextColor: isHc ? "#ffffff" : "#cccccc",
      tertiaryBorderColor: isHc ? "#ffffff" : "#3c3c3c",
      lineColor: isHc ? "#66b0ff" : "#818cf8",
      textColor: isHc ? "#ffffff" : "#cccccc",
      mainBkg: isHc ? "#141414" : "#252526",
      nodeBorder: isHc ? "#ffffff" : "#3c3c3c",
      nodeTextColor: isHc ? "#ffffff" : "#cccccc",
      clusterBkg: isHc ? "#0a0a0a" : "#1e1e1e",
      clusterBorder: isHc ? "#ffffff" : "#3c3c3c",
      titleColor: isHc ? "#ffffff" : "#cccccc",
      edgeLabelBackground: isHc ? "#1a1a1a" : "#2d2d2d",
      defaultLinkColor: isHc ? "#66b0ff" : "#818cf8",
      noteBkgColor: isHc ? "#001a33" : "#1e1b4b",
      noteTextColor: "#ffffff",
      noteBorderColor: isHc ? "#66b0ff" : "#6366f1",
    };
  }

  return {
    darkMode: false,
    background: "#f4f4f5",
    // Gray node fills (unchanged spirit)
    primaryColor: "#e4e4e7",
    // Near-black type for readability
    primaryTextColor: "#09090b",
    primaryBorderColor: "#71717a",
    secondaryColor: "#ececef",
    secondaryTextColor: "#09090b",
    secondaryBorderColor: "#d4d4d8",
    tertiaryColor: "#fafafa",
    tertiaryTextColor: "#09090b",
    tertiaryBorderColor: "#d4d4d8",
    // Accent 1: indigo connectors (only color on the main graph)
    lineColor: "#6366f1",
    textColor: "#09090b",
    mainBkg: "#e4e4e7",
    nodeBorder: "#71717a",
    nodeTextColor: "#09090b",
    clusterBkg: "#fafafa",
    clusterBorder: "#d4d4d8",
    titleColor: "#09090b",
    edgeLabelBackground: "#ececef",
    defaultLinkColor: "#6366f1",
    // Accent 2: whisper-indigo notes (still calm, not yellow/pink)
    noteBkgColor: "#eef2ff",
    noteTextColor: "#09090b",
    noteBorderColor: "#a5b4fc",
  };
}

function initMermaid(isDark) {
  mermaid.initialize({
    startOnLoad: false,
    // `base` is required for themeVariables customization.
    theme: "base",
    securityLevel: "strict",
    fontFamily: "inherit",
    flowchart: {
      // Orthogonal right-angle connectors with soft corners (not straight diagonals).
      curve: "rounded",
      // Extra spacing so bent edges are less likely to overlap.
      nodeSpacing: 50,
      rankSpacing: 60,
    },
    themeVariables: mermaidThemeVariables(isDark),
  });
}

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/** In-memory SVG cache so revisiting the same chart+theme paints immediately. */
const svgCache = new Map();

function mermaidCacheKey(source, isDark) {
  return `${isDark ? "dark" : "light"}|${source}`;
}

/**
 * Shared off-screen host so mermaid.render never appends a visible temp node to body.
 * Each render gets its own child container to avoid concurrent-render races.
 */
let mermaidRenderHost = null;

function getMermaidRenderHost() {
  if (typeof document === "undefined") return null;
  if (!mermaidRenderHost || !mermaidRenderHost.isConnected) {
    mermaidRenderHost = document.createElement("div");
    mermaidRenderHost.setAttribute("aria-hidden", "true");
    mermaidRenderHost.style.cssText =
      "position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;";
    document.body.appendChild(mermaidRenderHost);
  }
  return mermaidRenderHost;
}

/**
 * Natural pixel size of a Mermaid SVG (ignores CSS max-width shrink-to-fit).
 */
function getSvgNaturalSize(svgEl) {
  if (!svgEl) return null;

  const vb = svgEl.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { width: vb.width, height: vb.height };
  }

  const attrW = parseFloat(svgEl.getAttribute("width"));
  const attrH = parseFloat(svgEl.getAttribute("height"));
  if (Number.isFinite(attrW) && Number.isFinite(attrH) && attrW > 0 && attrH > 0) {
    return { width: attrW, height: attrH };
  }

  try {
    const bbox = svgEl.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
  } catch {
    /* getBBox can throw if not in DOM */
  }

  return null;
}

/**
 * Renders a Mermaid diagram from fenced ```mermaid source.
 * Falls back to the source text when the diagram fails to parse.
 * Supports Cursor-style expand with fit-to-window zoom and pan.
 */
function MermaidBlock({ chart }) {
  const reactId = useId().replace(/:/g, "");
  const [dark, setDark] = useState(isDarkTheme);
  const [svg, setSvg] = useState(() => {
    const source = String(chart ?? "").trim();
    if (!source) return "";
    return svgCache.get(mermaidCacheKey(source, isDarkTheme())) || "";
  });
  const [error, setError] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

  const copyTimerRef = useRef(null);
  const dragRef = useRef(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef(null);
  const contentRef = useRef(null);
  const fitScaleRef = useRef(1);
  const shouldFitOnOpenRef = useRef(false);

  scaleRef.current = scale;
  translateRef.current = translate;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(isDarkTheme()));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Layout effect: apply cache / clear stale SVG before paint; render into a hidden host.
  useLayoutEffect(() => {
    let cancelled = false;
    const source = String(chart ?? "").trim();
    if (!source) {
      setSvg("");
      setError(null);
      return undefined;
    }

    const key = mermaidCacheKey(source, dark);
    const cached = svgCache.get(key);
    if (cached) {
      setSvg(cached);
      setError(null);
      return undefined;
    }

    // Avoid showing a previous diagram (or body-temp flash) while the new one renders.
    setSvg("");
    setError(null);

    const host = getMermaidRenderHost();
    if (!host) return undefined;

    const container = document.createElement("div");
    host.appendChild(container);

    initMermaid(dark);
    const renderId = `gitoza-mermaid-${reactId}-${dark ? "dark" : "light"}`;
    mermaid
      .render(renderId, source, container)
      .then((result) => {
        svgCache.set(key, result.svg);
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSvg("");
          setError(err?.message || "Invalid Mermaid diagram");
        }
      })
      .finally(() => {
        container.remove();
      });

    return () => {
      cancelled = true;
    };
  }, [chart, dark, reactId]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const fitToWindow = useCallback(() => {
    const canvas = canvasRef.current;
    const content = contentRef.current;
    if (!canvas || !content) return;

    const svgEl = content.querySelector("svg");
    const natural = getSvgNaturalSize(svgEl);
    if (!natural) return;

    // Mermaid often sets max-width:100%; clear it so natural size is used for layout.
    if (svgEl) {
      svgEl.style.maxWidth = "none";
      svgEl.style.width = `${natural.width}px`;
      svgEl.style.height = `${natural.height}px`;
    }

    const availW = Math.max(1, canvas.clientWidth - FIT_PADDING_PX * 2);
    const availH = Math.max(1, canvas.clientHeight - FIT_PADDING_PX * 2);
    const next = clampScale(
      Math.min(availW / natural.width, availH / natural.height),
    );

    fitScaleRef.current = next;
    setScale(next);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const openViewer = useCallback(() => {
    shouldFitOnOpenRef.current = true;
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setIsOpen(true);
  }, []);

  const closeViewer = useCallback(() => {
    setIsOpen(false);
    setDragging(false);
    dragRef.current = null;
    shouldFitOnOpenRef.current = false;
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !shouldFitOnOpenRef.current) return undefined;
    shouldFitOnOpenRef.current = false;
    // Double-rAF so portal layout + SVG paint settle before measuring.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        fitToWindow();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isOpen, fitToWindow]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeViewer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeViewer]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onResize = () => {
      // Keep fit-to-window behavior when the user has not zoomed away from fit.
      if (Math.abs(scaleRef.current - fitScaleRef.current) < 0.001) {
        fitToWindow();
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, fitToWindow]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const canvas = canvasRef.current;
    const prevScale = scaleRef.current;
    const nextScale = clampScale(prevScale * factor);
    if (nextScale === prevScale || !canvas) {
      setScale(nextScale);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const { x, y } = translateRef.current;
    const ratio = nextScale / prevScale;
    setScale(nextScale);
    setTranslate({
      x: cx - (cx - x) * ratio,
      y: cy - (cy - y) * ratio,
    });
  }, []);

  // Non-passive wheel listener so preventDefault can block page scroll while zooming.
  useEffect(() => {
    if (!isOpen) return undefined;
    const el = canvasRef.current;
    if (!el) return undefined;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen, onWheel]);

  const onCopy = useCallback(
    async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const source = String(chart ?? "").trim();
      if (!source) return;
      try {
        await navigator.clipboard.writeText(source);
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        /* ignore */
      }
    },
    [chart],
  );

  const zoomBy = useCallback((factor) => {
    setScale((prev) => clampScale(prev * factor));
  }, []);

  const resetView = useCallback(() => {
    fitToWindow();
  }, [fitToWindow]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: translateRef.current.x,
      origY: translateRef.current.y,
    };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setTranslate({
      x: drag.origX + (e.clientX - drag.startX),
      y: drag.origY + (e.clientY - drag.startY),
    });
  }, []);

  const onPointerUp = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  }, []);

  if (error) {
    return (
      <pre className="my-3 overflow-x-auto rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-xs leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
        {error}
        {"\n\n"}
        {chart}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div
        className="my-3 h-16 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50"
        aria-hidden
      />
    );
  }

  const viewer =
    isOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Mermaid diagram viewer"
            className="fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-slate-950"
            onClick={closeViewer}
          >
            <div
              className="absolute right-4 top-4 z-10 flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={VIEWER_BTN_CLASS}
                aria-label="Zoom out"
                disabled={scale <= MIN_SCALE}
                onClick={() => zoomBy(1 / ZOOM_STEP)}
              >
                <ZoomOut className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className={VIEWER_BTN_CLASS}
                aria-label="Zoom in"
                disabled={scale >= MAX_SCALE}
                onClick={() => zoomBy(ZOOM_STEP)}
              >
                <ZoomIn className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className={VIEWER_BTN_CLASS}
                aria-label="Fit to window"
                onClick={resetView}
              >
                <RotateCcw className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className={VIEWER_BTN_CLASS}
                aria-label="Close diagram viewer"
                onClick={closeViewer}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div
              ref={canvasRef}
              className={`flex h-full w-full touch-none items-center justify-center overflow-hidden ${
                dragging ? "cursor-grabbing" : "cursor-grab"
              }`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                ref={contentRef}
                className="select-none animate-fade-in"
                style={{
                  transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                  transformOrigin: "center center",
                }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="group relative my-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-900/50">
        <div
          className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={TOOLBAR_BTN_CLASS}
            aria-label={copied ? "Copied" : "Copy Mermaid source"}
            onClick={onCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            ) : (
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            className={TOOLBAR_BTN_CLASS}
            aria-label="Expand diagram"
            onClick={(e) => {
              e.stopPropagation();
              openViewer();
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        <div
          role="button"
          tabIndex={0}
          aria-label="Expand Mermaid diagram"
          className="cursor-pointer"
          onClick={openViewer}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openViewer();
            }
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {viewer}
    </>
  );
}

export default MermaidBlock;
