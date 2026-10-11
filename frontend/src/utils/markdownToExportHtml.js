/**
 * Markdown → static HTML for print/PDF export.
 * Mirrors TestCaseDetailModal.renderMarkdown + inline rules (headings, lists, tasks,
 * nested lists, blockquote, fenced code blocks, hr, bold/italic/code).
 *
 * @module utils/markdownToExportHtml
 */

import { consumeFencedCodeBlock } from "./markdownFencedCode";
import { highlightCodeBlock } from "./highlightCodeBlock";
import {
  consumeMarkdownListBlock,
  groupMarkdownListSiblings,
} from "./markdownListRender";
import {
  isTableSeparatorRow,
  parsePipeTableRow,
} from "./gfmPipeTable";

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Next inline delimiter by leftmost start: code / bold / italic (no wiki in export).
 * @param {string} text
 * @returns {{ kind: string, start: number, end: number, content: string } | null}
 */
function findNextInlineDelimiter(text) {
  /** @type {{ kind: string, start: number, end: number, content: string } | null} */
  let best = null;
  const consider = (cand) => {
    if (!cand) return;
    if (!best || cand.start < best.start) best = cand;
  };

  const codeOpen = text.indexOf("`");
  if (codeOpen >= 0) {
    const codeClose = text.indexOf("`", codeOpen + 1);
    if (codeClose > codeOpen + 1) {
      consider({
        kind: "code",
        start: codeOpen,
        end: codeClose + 1,
        content: text.slice(codeOpen + 1, codeClose),
      });
    }
  }

  const boldOpen = text.indexOf("**");
  if (boldOpen >= 0) {
    const boldClose = text.indexOf("**", boldOpen + 2);
    if (boldClose > boldOpen + 2) {
      consider({
        kind: "bold",
        start: boldOpen,
        end: boldClose + 2,
        content: text.slice(boldOpen + 2, boldClose),
      });
    }
  }

  const italicMatch = text.match(/(?<!\*)\*([^*]+)\*(?!\*)/);
  if (italicMatch && italicMatch.index != null) {
    consider({
      kind: "italic",
      start: italicMatch.index,
      end: italicMatch.index + italicMatch[0].length,
      content: italicMatch[1],
    });
  }

  return best;
}

/**
 * @param {string} text
 * @returns {string}
 */
function inlineFormatToHtml(text) {
  if (text == null || text === "") return "";
  let remaining = text;
  let out = "";

  while (remaining.length > 0) {
    const next = findNextInlineDelimiter(remaining);
    if (!next) {
      out += escapeHtml(remaining);
      break;
    }
    if (next.start > 0) {
      out += escapeHtml(remaining.slice(0, next.start));
    }
    if (next.kind === "code") {
      out += `<code class="export-md-code">${escapeHtml(next.content)}</code>`;
    } else if (next.kind === "bold") {
      out += `<strong class="export-md-strong">${inlineFormatToHtml(next.content)}</strong>`;
    } else if (next.kind === "italic") {
      out += `<em class="export-md-em">${inlineFormatToHtml(next.content)}</em>`;
    }
    remaining = remaining.slice(next.end);
  }
  return out;
}

/**
 * @param {import("./markdownListRender").MarkdownListNode[]} nodes
 * @param {number} depth
 * @returns {string}
 */
function listNodesToHtml(nodes, depth = 0) {
  if (!nodes?.length) return "";
  const markerClass =
    depth === 0
      ? "export-md-ul-disc"
      : depth === 1
        ? "export-md-ul-circle"
        : "export-md-ul-square";
  return groupMarkdownListSiblings(nodes)
    .map((group) => {
      if (group.kind === "task") {
        const lis = group.items
          .map((item) => {
            const checked = item.task === "checked";
            const box = checked
              ? '<span class="export-md-taskbox export-md-taskbox-checked">✓</span>'
              : '<span class="export-md-taskbox"></span>';
            const textCls = checked ? " export-md-task-done" : "";
            const nested = listNodesToHtml(item.children, depth + 1);
            return `<li class="export-md-task-li">${box}<span class="export-md-task-text${textCls}">${inlineFormatToHtml(item.content)}</span>${nested}</li>`;
          })
          .join("");
        return `<ul class="export-md-ul export-md-task-ul">${lis}</ul>`;
      }
      const tag = group.kind === "ol" ? "ol" : "ul";
      const cls = group.kind === "ol" ? "export-md-ol" : markerClass;
      const lis = group.items
        .map((item) => {
          const nested = listNodesToHtml(item.children, depth + 1);
          const valueAttr =
            group.kind === "ol" &&
            typeof item.number === "number" &&
            item.number > 0
              ? ` value="${item.number}"`
              : "";
          return `<li class="export-md-li"${valueAttr}>${inlineFormatToHtml(item.content)}${nested}</li>`;
        })
        .join("");
      return `<${tag} class="${cls}">${lis}</${tag}>`;
    })
    .join("");
}

/**
 * @param {string} text
 * @returns {string}
 */
export function markdownToExportHtml(text) {
  if (!text || !String(text).trim()) {
    return '<p class="export-md-p export-md-muted">No body content for this test case.</p>';
  }
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = consumeFencedCodeBlock(lines, i);
    if (fence) {
      const langAttr = fence.lang ? ` data-language="${escapeHtml(fence.lang)}"` : "";
      const highlighted = highlightCodeBlock(fence.code, fence.lang);
      blocks.push(
        `<pre class="export-md-pre"><code class="export-md-pre-code hljs"${langAttr}>${highlighted}</code></pre>`,
      );
      i = fence.nextIndex;
      continue;
    }
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push('<hr class="export-md-hr" />');
      i++;
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const cls = level === 1 ? "export-md-h1" : level === 2 ? "export-md-h2" : "export-md-h3";
      blocks.push(`<div class="${cls}">${inlineFormatToHtml(content)}</div>`);
      i++;
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const bqLines = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        bqLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const inner = bqLines
        .map((l) => `<p class="export-md-bq-p">${inlineFormatToHtml(l)}</p>`)
        .join("");
      blocks.push(`<blockquote class="export-md-bq">${inner}</blockquote>`);
      continue;
    }
    const listBlock = consumeMarkdownListBlock(lines, i);
    if (listBlock) {
      blocks.push(listNodesToHtml(listBlock.roots, 0));
      i = listBlock.nextIndex;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
      const headerCells = parsePipeTableRow(line);
      if (headerCells && headerCells.length > 0 && isTableSeparatorRow(nextLine)) {
        i += 2;
        const bodyRows = [];
        while (i < lines.length) {
          const rowLine = lines[i];
          if (rowLine.trim() === "") break;
          if (!rowLine.trim().startsWith("|")) break;
          const rowCells = parsePipeTableRow(rowLine);
          if (rowCells) bodyRows.push(rowCells);
          i++;
        }
        const ths = headerCells
          .map((h) => `<th class="export-md-th">${inlineFormatToHtml(h)}</th>`)
          .join("");
        const trs = bodyRows
          .map(
            (row) =>
              `<tr class="export-md-tr">${row.map((c) => `<td class="export-md-td">${inlineFormatToHtml(c)}</td>`).join("")}</tr>`,
          )
          .join("");
        blocks.push(
          `<div class="export-md-table-wrap"><table class="export-md-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`,
        );
        continue;
      }
    }
    blocks.push(`<p class="export-md-p">${inlineFormatToHtml(line)}</p>`);
    i++;
  }

  return blocks.join("\n");
}
