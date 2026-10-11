/**
 * GFM pipe-table row parsing that does not treat `|` inside `[[wikilinks]]`
 * as column separators. Also helpers to escape those pipes for TipTap/marked.
 */

import { consumeFencedCodeBlock } from "./markdownFencedCode";
import { WIKI_LINK_RE } from "./ticketLinks";

const WIKI_SENTINEL = (i) => `\u0000WIKI${i}\u0000`;
const PIPE_SENTINEL = "\u0000PIPE\u0000";
const WIKI_RESTORE_RE = /\u0000WIKI(\d+)\u0000/g;

/**
 * Protect Obsidian-style wiki links, then GFM `\|`, so `|` splits are safe.
 * @param {string} s
 * @returns {{ masked: string, bag: string[] }}
 */
function protectForPipeSplit(s) {
  const bag = [];
  const withWiki = String(s).replace(new RegExp(WIKI_LINK_RE.source, "g"), (m) => {
    const i = bag.length;
    bag.push(m);
    return WIKI_SENTINEL(i);
  });
  const masked = withWiki.replace(/\\\|/g, PIPE_SENTINEL);
  return { masked, bag };
}

/**
 * @param {string} s
 * @param {string[]} bag
 * @returns {string}
 */
function restoreAfterPipeSplit(s, bag) {
  return s
    .replace(WIKI_RESTORE_RE, (_, i) => bag[Number(i)] ?? "")
    .replaceAll(PIPE_SENTINEL, "|");
}

/**
 * Parse one GFM pipe-table row into cell strings.
 * `|` inside `[[id|label]]` and escaped `\|` are not column breaks.
 * @param {string} line
 * @returns {string[] | null}
 */
export function parsePipeTableRow(line) {
  const t = String(line ?? "").trim();
  if (!t.startsWith("|")) return null;
  const inner = t.endsWith("|") ? t.slice(1, -1) : t.slice(1);
  const { masked, bag } = protectForPipeSplit(inner);
  return masked.split("|").map((c) => restoreAfterPipeSplit(c.trim(), bag));
}

/**
 * GFM alignment row: | --- | :--- | ---: |
 * @param {string} line
 * @returns {boolean}
 */
export function isTableSeparatorRow(line) {
  const cells = parsePipeTableRow(line);
  if (!cells || cells.length === 0) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/**
 * Escape `|` → `\|` inside a single wikilink match (skip already-escaped).
 * @param {string} match
 * @returns {string}
 */
function escapePipesInWikiMatch(match) {
  let out = "";
  for (let i = 0; i < match.length; i++) {
    if (match[i] === "|" && (i === 0 || match[i - 1] !== "\\")) {
      out += "\\|";
    } else {
      out += match[i];
    }
  }
  return out;
}

/**
 * Escape `|` inside `[[…]]` on one non-fence line for marked/GFM table parse.
 * @param {string} line
 * @returns {string}
 */
function escapeWikiLinkPipesOnLine(line) {
  return String(line).replace(new RegExp(WIKI_LINK_RE.source, "g"), escapePipesInWikiMatch);
}

/**
 * Prepare markdown for TipTap/marked: escape `|` inside wikilinks so GFM
 * tables do not split cells. Fenced code blocks are left unchanged.
 * Does not rewrite on-disk storage by itself — call only before parse.
 * @param {string | null | undefined} md
 * @returns {string}
 */
export function escapeWikiLinkPipesForGfm(md) {
  if (md == null || typeof md !== "string" || md.length === 0) {
    return md == null ? "" : md;
  }
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const fence = consumeFencedCodeBlock(lines, i);
    if (fence) {
      out.push(...lines.slice(i, fence.nextIndex));
      i = fence.nextIndex;
      continue;
    }
    out.push(escapeWikiLinkPipesOnLine(lines[i]));
    i += 1;
  }
  return out.join("\n");
}
