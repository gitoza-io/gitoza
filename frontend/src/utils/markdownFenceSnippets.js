/**
 * Fenced code / Mermaid snippets for Markdown toolbar inserts.
 * Cursor offsets place the caret on the empty middle line (or after wrapped content).
 */

export const CODE_FENCE_OPEN = "\n```\n";
export const CODE_FENCE_CLOSE = "\n```\n";
export const MERMAID_FENCE_OPEN = "\n```mermaid\n";
export const MERMAID_FENCE_CLOSE = "\n```\n";

/**
 * Empty fenced code block (leading/trailing newlines for separation).
 * @returns {string}
 */
export function codeFenceSnippet() {
  return `${CODE_FENCE_OPEN}${CODE_FENCE_CLOSE}`;
}

/**
 * Cursor offset into {@link codeFenceSnippet} (start of empty body line).
 * @returns {number}
 */
export function codeFenceCursorOffset() {
  return CODE_FENCE_OPEN.length;
}

/**
 * Empty Mermaid fence.
 * @returns {string}
 */
export function mermaidFenceSnippet() {
  return `${MERMAID_FENCE_OPEN}${MERMAID_FENCE_CLOSE}`;
}

/**
 * Cursor offset into {@link mermaidFenceSnippet}.
 * @returns {number}
 */
export function mermaidFenceCursorOffset() {
  return MERMAID_FENCE_OPEN.length;
}

/**
 * Wrap selected text in a code fence, or return an empty fence pair.
 * @param {string} [selected]
 * @returns {{ text: string, cursorOffset: number }}
 */
export function wrapInCodeFence(selected = "") {
  const body = String(selected ?? "");
  if (!body) {
    const text = codeFenceSnippet();
    return { text, cursorOffset: codeFenceCursorOffset() };
  }
  const text = `${CODE_FENCE_OPEN}${body}${CODE_FENCE_CLOSE}`;
  return { text, cursorOffset: CODE_FENCE_OPEN.length + body.length };
}

/**
 * Wrap selected text in a Mermaid fence, or return an empty Mermaid fence pair.
 * @param {string} [selected]
 * @returns {{ text: string, cursorOffset: number }}
 */
export function wrapInMermaidFence(selected = "") {
  const body = String(selected ?? "");
  if (!body) {
    const text = mermaidFenceSnippet();
    return { text, cursorOffset: mermaidFenceCursorOffset() };
  }
  const text = `${MERMAID_FENCE_OPEN}${body}${MERMAID_FENCE_CLOSE}`;
  return { text, cursorOffset: MERMAID_FENCE_OPEN.length + body.length };
}
