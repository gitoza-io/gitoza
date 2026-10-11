import { consumeFencedCodeBlock } from "./markdownFencedCode";
import { unescapeMarkdownWikiLinks } from "./ticketLinks";

/** Characters TipTap's `escapeMarkdownSyntax` backslash-escapes. */
const TIPTAP_ESCAPED_RE = /\\([\\`*_[\]~])/g;

/**
 * Restore TipTap-escaped inline syntax and HTML entities in a non-code chunk.
 * @param {string} text
 * @returns {string}
 */
function unescapeSyntaxAndEntities(text) {
  return text
    .replace(TIPTAP_ESCAPED_RE, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * True when `index` is a character preceded by an odd number of backslashes.
 * @param {string} line
 * @param {number} index
 * @returns {boolean}
 */
function isEscapedAt(line, index) {
  let n = 0;
  let j = index - 1;
  while (j >= 0 && line[j] === "\\") {
    n += 1;
    j -= 1;
  }
  return n % 2 === 1;
}

/**
 * Index of the next backtick that is not backslash-escaped, or -1.
 * @param {string} line
 * @param {number} from
 * @returns {number}
 */
function indexOfUnescapedBacktick(line, from) {
  let i = from;
  while (i < line.length) {
    if (line[i] === "`" && !isEscapedAt(line, i)) return i;
    i += 1;
  }
  return -1;
}

/**
 * Index just past a closing backtick run of length `n`, or -1 if none.
 * @param {string} line
 * @param {number} from
 * @param {number} n
 * @returns {number}
 */
function findClosingBackticks(line, from, n) {
  let i = from;
  while (i < line.length) {
    if (line[i] !== "`") {
      i += 1;
      continue;
    }
    let m = 0;
    while (i + m < line.length && line[i + m] === "`") m += 1;
    if (m === n) return i + m;
    i += m;
  }
  return -1;
}

/**
 * Unescape TipTap syntax outside inline code spans (`…`, `` … ``, …).
 * Backslash-escaped backticks (`\``) are literal, not code delimiters.
 * @param {string} line
 * @returns {string}
 */
function unescapeOutsideInlineCode(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`" && !isEscapedAt(line, i)) {
      let n = 0;
      while (i + n < line.length && line[i + n] === "`") n += 1;
      const close = findClosingBackticks(line, i + n, n);
      if (close === -1) {
        out += unescapeSyntaxAndEntities(line.slice(i));
        break;
      }
      out += line.slice(i, close);
      i = close;
      continue;
    }
    const next = indexOfUnescapedBacktick(line, i);
    const chunk = next === -1 ? line.slice(i) : line.slice(i, next);
    out += unescapeSyntaxAndEntities(chunk);
    if (next === -1) break;
    i = next;
  }
  return out;
}

/**
 * Undo TipTap Markdown serializer escapes so Normal mode does not rewrite
 * source (`_` → `\_`, `&` → `&amp;`, `[[wiki]]` → `\[\[wiki\]\]`, …).
 * Fenced code and inline code spans are left unchanged.
 *
 * @param {string | null | undefined} md
 * @returns {string}
 */
export function unescapeTipTapMarkdown(md) {
  if (md == null || typeof md !== "string" || md.length === 0) {
    return md == null ? "" : md;
  }

  const withWiki = unescapeMarkdownWikiLinks(md);
  const lines = withWiki.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const fence = consumeFencedCodeBlock(lines, i);
    if (fence) {
      out.push(...lines.slice(i, fence.nextIndex));
      i = fence.nextIndex;
      continue;
    }
    out.push(unescapeOutsideInlineCode(lines[i]));
    i += 1;
  }
  return out.join("\n");
}
