/**
 * Parses markdown image alt text with optional pipe-separated width.
 * e.g. ![label|600](file) → { label: "label", widthPx: 600 }
 *
 * @param {string | null | undefined} alt
 * @returns {{ label: string, widthPx: number | null }}
 */
export function parseMarkdownImageAlt(alt) {
  const raw = String(alt ?? "").trim();
  if (!raw) return { label: "", widthPx: null };

  const pipeIdx = raw.indexOf("|");
  if (pipeIdx === -1) return { label: raw, widthPx: null };

  const label = raw.slice(0, pipeIdx).trim();
  const widthStr = raw.slice(pipeIdx + 1).trim();
  const widthPx = /^\d+$/.test(widthStr) ? parseInt(widthStr, 10) : null;
  return { label, widthPx };
}
