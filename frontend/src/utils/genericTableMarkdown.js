/**
 * Default blank 3×3 GFM pipe table (header + 2 body rows) for toolbar Insert table.
 * Used by Markdown-mode insert and round-trip tests.
 */
export const GENERIC_TABLE_MARKDOWN = [
  "| Column 1 | Column 2 | Column 3 |",
  "|----------|----------|----------|",
  "|  |  |  |",
  "|  |  |  |",
].join("\n");

/**
 * Snippet to insert at the cursor (leading/trailing newlines for separation).
 * @returns {string}
 */
export function genericTableSnippet() {
  return `\n${GENERIC_TABLE_MARKDOWN}\n`;
}
