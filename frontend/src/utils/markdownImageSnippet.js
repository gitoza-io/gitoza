/** Default alt for injected case-body image embeds (`![image](img_….png)`). */
export const MARKDOWN_IMAGE_ALT = "image";

/**
 * Markdown image embed (leading `!` — not a hyperlink) using asset id only (no paths).
 * @param {string} fileName e.g. img_a1b2c3d4.png
 * @param {string} [alt]
 * @returns {string} e.g. `\n\n![image](img_a1b2c3d4.png)\n\n`
 */
export function markdownImageSnippet(fileName, alt = MARKDOWN_IMAGE_ALT) {
  const safeName = String(fileName ?? "").trim();
  const safeAlt = (String(alt ?? MARKDOWN_IMAGE_ALT).trim() || MARKDOWN_IMAGE_ALT);
  return `\n![${safeAlt}](${safeName})\n`;
}
