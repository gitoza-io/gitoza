import { parseMarkdownImageAlt } from "./parseMarkdownImageAlt";
import { MARKDOWN_IMAGE_ALT } from "./markdownImageSnippet";

/** Standalone markdown image line: ![alt](src) */
export const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/** Cached test asset filename (not a URL path). */
export const ASSET_NAME_RE = /^img_[a-z0-9]{6,32}\.(png|jpg|jpeg|webp|gif)$/i;

const MIN_IMAGE_WIDTH_PX = 150;

/**
 * @param {string} line
 * @returns {boolean}
 */
export function isAssetImageLine(line) {
  const trimmed = String(line ?? "").trim();
  const m = trimmed.match(IMAGE_LINE_RE);
  if (!m) return false;
  return ASSET_NAME_RE.test(String(m[2] ?? "").trim());
}

/**
 * @param {string} alt
 * @param {string} fileName
 * @returns {string}
 */
export function buildImageMarkdownLine(alt, fileName) {
  const safeAlt = String(alt ?? MARKDOWN_IMAGE_ALT).trim() || MARKDOWN_IMAGE_ALT;
  const safeName = String(fileName ?? "").trim();
  return `![${safeAlt}](${safeName})`;
}

/**
 * @param {string} label
 * @param {number | null | undefined} widthPx
 * @returns {string}
 */
export function formatMarkdownImageAlt(label, widthPx) {
  const base = String(label ?? "").trim() || MARKDOWN_IMAGE_ALT;
  if (widthPx == null || !Number.isFinite(widthPx) || widthPx < 1) return base;
  return `${base}|${Math.round(widthPx)}`;
}

/**
 * @param {string} rawLine
 * @param {number} widthPx
 * @returns {string}
 */
export function setImageLineWidth(rawLine, widthPx) {
  const line = String(rawLine ?? "");
  const trimmed = line.trim();
  const m = trimmed.match(IMAGE_LINE_RE);
  if (!m) return line;

  const { label } = parseMarkdownImageAlt(m[1]);
  const fileName = String(m[2] ?? "").trim();
  const newInner = buildImageMarkdownLine(formatMarkdownImageAlt(label, widthPx), fileName);

  const lead = line.match(/^\s*/)?.[0] ?? "";
  const trail = line.match(/\s*$/)?.[0] ?? "";
  const trimLead = lead.length;
  const trimTrail = trail.length;
  if (trimLead || trimTrail) {
    return `${lead}${newInner.trim()}${trail}`;
  }
  return newInner;
}

/**
 * @param {number} widthPx
 * @param {number} maxWidthPx
 * @returns {number}
 */
export function clampImageWidthPx(widthPx, maxWidthPx) {
  const max = Number.isFinite(maxWidthPx) && maxWidthPx > 0 ? maxWidthPx : Infinity;
  return Math.min(max, Math.max(MIN_IMAGE_WIDTH_PX, Math.round(widthPx)));
}

export { MIN_IMAGE_WIDTH_PX };
