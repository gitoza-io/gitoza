import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ImageIcon, Loader2, X } from "lucide-react";
import { useResolvedAssetUrl } from "../hooks/useResolvedAssetUrl";
import { isTauri } from "../utils/tauriEnv";
import { parseMarkdownImageAlt } from "../utils/parseMarkdownImageAlt";
import { saveAssetFileWithDialog } from "../utils/saveWithDialog";

const FLUID_IMG_CLASS =
  "max-h-96 w-auto max-w-full rounded-md object-contain";
const SIZED_IMG_CLASS =
  "h-auto max-w-full rounded-md object-contain";

const LIGHTBOX_ACTION_CLASS =
  "rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70";

/**
 * @param {{
 *   repoSlug: string | null | undefined,
 *   fileName: string | null | undefined,
 *   alt?: string | null,
 *   optimisticAbsolutePath?: string | null,
 *   editable?: boolean,
 *   onRemove?: () => void,
 *   className?: string,
 * }} props
 */
export default function TestAssetPreview({
  repoSlug,
  fileName,
  alt = null,
  optimisticAbsolutePath = null,
  editable = false,
  onRemove,
  className = "",
}) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { label, widthPx } = parseMarkdownImageAlt(alt);
  const imgAlt = label || "Test case image";

  const { url, absolutePath, loading, error } = useResolvedAssetUrl(
    repoSlug,
    fileName,
    optimisticAbsolutePath,
  );

  useEffect(() => {
    if (!isZoomed) return;
    const onKey = (e) => {
      if (e.key === "Escape") setIsZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isZoomed]);

  const handleDownload = useCallback(async () => {
    if (!absolutePath || !fileName || downloading) return;
    setDownloading(true);
    try {
      await saveAssetFileWithDialog(absolutePath, fileName);
    } finally {
      setDownloading(false);
    }
  }, [absolutePath, downloading, fileName]);

  if (!fileName) return null;

  if (!isTauri()) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Screenshot: {fileName} (desktop app required to preview)
      </p>
    );
  }

  if (editable) {
    return (
      <div
        className={`relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50 ${className}`}
      >
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="absolute right-2 top-2 z-10 rounded-full bg-slate-900/60 p-1 text-white hover:bg-slate-900/80"
            aria-label="Remove screenshot"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        {loading ? (
          <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading image…
          </div>
        ) : error ? (
          <div className="flex min-h-[80px] items-center gap-2 px-3 py-4 text-sm text-amber-700 dark:text-amber-300">
            <ImageIcon className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : url ? (
          <img
            src={url}
            alt={imgAlt}
            className="max-h-80 w-full object-contain"
          />
        ) : null}
        <p className="border-t border-slate-200 px-2 py-1 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {fileName}
        </p>
      </div>
    );
  }

  const imgStyle = widthPx != null ? { width: `${widthPx}px` } : undefined;
  const imgClassName = widthPx != null ? SIZED_IMG_CLASS : FLUID_IMG_CLASS;

  const lightbox =
    isZoomed && url
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
            onClick={() => setIsZoomed(false)}
          >
            <div
              className="absolute right-4 top-4 flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={LIGHTBOX_ACTION_CLASS}
                aria-label="Download image"
                disabled={!absolutePath || downloading}
                onClick={handleDownload}
              >
                {downloading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
              </button>
              <button
                type="button"
                className={LIGHTBOX_ACTION_CLASS}
                aria-label="Close image preview"
                onClick={() => setIsZoomed(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={url}
              alt={imgAlt}
              className="max-h-full max-w-full animate-fade-in select-none object-contain"
              draggable={false}
              onClick={(e) => e.stopPropagation()}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
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
        <img
          src={url}
          alt={imgAlt}
          className={`${imgClassName} cursor-pointer ${className}`.trim()}
          style={imgStyle}
          onClick={() => setIsZoomed(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsZoomed(true);
            }
          }}
          role="button"
          tabIndex={0}
        />
      ) : null}
      {lightbox}
    </>
  );
}
