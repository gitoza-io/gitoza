import TurndownService from "turndown";

export const MARKDOWN_EDITOR_MODE_KEY = "gitoza.markdownEditorMode";
export const MARKDOWN_EDITOR_MODES = Object.freeze({
  normal: "normal",
  markdown: "markdown",
});

const STRUCTURE_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "PRE",
  "BLOCKQUOTE",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "HR",
]);

/** @type {TurndownService | null} */
let turndownSingleton = null;

/**
 * @returns {TurndownService}
 */
function getTurndown() {
  if (turndownSingleton) return turndownSingleton;
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });

  // Flatten tables to plain lines (renderMarkdown has no table support).
  service.addRule("gitozaTable", {
    filter: ["table"],
    replacement(_content, node) {
      const rows = Array.from(node.querySelectorAll("tr"));
      const lines = rows.map((tr) => {
        const cells = Array.from(tr.querySelectorAll("th, td")).map((c) =>
          (c.textContent || "").replace(/\s+/g, " ").trim(),
        );
        return cells.filter(Boolean).join(" | ");
      });
      return `\n\n${lines.filter(Boolean).join("\n")}\n\n`;
    },
  });

  turndownSingleton = service;
  return service;
}

/**
 * @param {unknown} value
 * @returns {"normal" | "markdown"}
 */
export function normalizeMarkdownEditorMode(value) {
  return value === MARKDOWN_EDITOR_MODES.markdown
    ? MARKDOWN_EDITOR_MODES.markdown
    : MARKDOWN_EDITOR_MODES.normal;
}

/**
 * @returns {"normal" | "markdown"}
 */
export function loadMarkdownEditorMode() {
  try {
    if (typeof localStorage === "undefined") return MARKDOWN_EDITOR_MODES.normal;
    return normalizeMarkdownEditorMode(localStorage.getItem(MARKDOWN_EDITOR_MODE_KEY));
  } catch {
    return MARKDOWN_EDITOR_MODES.normal;
  }
}

/**
 * @param {"normal" | "markdown"} mode
 */
export function saveMarkdownEditorMode(mode) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(MARKDOWN_EDITOR_MODE_KEY, normalizeMarkdownEditorMode(mode));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * True when plain text already looks like Markdown (prefer over HTML→MD).
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
export function looksLikeMarkdown(text) {
  const s = String(text ?? "");
  if (!s.trim()) return false;

  if (isGfmPipeTableMarkdown(s)) return true;

  const lines = s.split(/\r?\n/);
  let signals = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^#{1,6}\s+\S/.test(t)) signals += 2;
    else if (/^(`{3,}|~{3,})/.test(t)) signals += 2;
    else if (/^>\s?\S?/.test(t)) signals += 1;
    else if (/^([-*+]|\d+\.)\s+\S/.test(t)) signals += 1;
    else if (/^[-*_]{3,}\s*$/.test(t)) signals += 1;
    else if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(t)) signals += 1;
    else if (/\[[^\]]+\]\([^)]+\)/.test(t)) signals += 1;
    if (signals >= 2) return true;
  }
  return signals >= 2;
}

/**
 * Detect a GFM pipe table (header + separator + ≥1 body row, or ≥2 rows + separator).
 * Used to prefer clipboard plain over HTML paste in Normal (TipTap) mode.
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
export function isGfmPipeTableMarkdown(text) {
  const s = String(text ?? "");
  if (!s.trim()) return false;

  const TABLE_ROW = /^\|.+\|/;
  const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

  let tableRows = 0;
  let tableSeps = 0;
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (TABLE_SEP.test(t)) tableSeps += 1;
    else if (TABLE_ROW.test(t)) tableRows += 1;
    if (tableRows >= 2 && tableSeps >= 1) return true;
  }
  return false;
}

/**
 * @param {string | null | undefined} html
 * @returns {boolean}
 */
export function htmlHasStructure(html) {
  const raw = String(html ?? "").trim();
  if (!raw) return false;

  if (typeof DOMParser === "undefined") {
    return /<(h[1-6]|ul|ol|li|pre|blockquote|table|tr|th|td|hr)\b/i.test(raw);
  }

  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const body = doc.body;
    if (!body) return false;

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
    let el = walker.nextNode();
    let paragraphCount = 0;
    while (el) {
      const tag = el.nodeName;
      if (STRUCTURE_TAGS.has(tag)) return true;
      if (tag === "P") {
        paragraphCount += 1;
        if (paragraphCount >= 2) return true;
      }
      if (tag === "BR" && body.children.length > 1) return true;
      el = walker.nextNode();
    }
    return false;
  } catch {
    return /<(h[1-6]|ul|ol|li|pre|blockquote|table)\b/i.test(raw);
  }
}

/**
 * @param {string | null | undefined} html
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  const raw = String(html ?? "").trim();
  if (!raw) return "";
  try {
    return getTurndown().turndown(raw).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}

/**
 * Choose clipboard text to insert into the Markdown body.
 * @param {{
 *   mode?: string,
 *   plain?: string | null,
 *   html?: string | null,
 * }} opts
 * @returns {string}
 */
export function choosePastePayload({ mode, plain, html } = {}) {
  const plainText = plain == null ? "" : String(plain);
  const htmlText = html == null ? "" : String(html);
  const editorMode = normalizeMarkdownEditorMode(mode);

  if (editorMode === MARKDOWN_EDITOR_MODES.markdown) {
    return plainText;
  }

  if (looksLikeMarkdown(plainText)) {
    return plainText;
  }

  if (htmlText && htmlHasStructure(htmlText)) {
    const md = htmlToMarkdown(htmlText);
    if (md) return md;
  }

  return plainText;
}
