import { useEffect, useRef } from "react";
import { Tag, X } from "lucide-react";
import UpdatedByLine from "./UpdatedByLine";
import { getTagColorClass } from "../utils/tagColor";
import ApproveStatusBadge from "./ApproveStatusBadge";
import MarkdownInlineImage from "./MarkdownInlineImage";
import WikiPageLink from "./WikiPageLink";
import WikiTicketLink from "./WikiTicketLink";
import { classifyWikiLinkTarget } from "../utils/ticketLinks";
import MermaidBlock from "./MermaidBlock";
import { consumeFencedCodeBlock } from "../utils/markdownFencedCode";
import { highlightCodeBlock } from "../utils/highlightCodeBlock";
import {
  consumeMarkdownListBlock,
  groupMarkdownListSiblings,
} from "../utils/markdownListRender";
import {
  isTableSeparatorRow,
  parsePipeTableRow,
} from "../utils/gfmPipeTable";

// ---------------------------------------------------------------------------
// Lightweight Markdown → React renderer (no external dependency)
// Supports: h1-h3, blockquotes, fenced code blocks, inline code, task lists,
// ordered/unordered lists (including nested), GFM pipe tables, paragraphs,
// bold, italic, horizontal rules.
// ---------------------------------------------------------------------------

const LIST_UL_CLASS_BY_DEPTH = [
  "list-disc",
  "list-[circle]",
  "list-[square]",
];

function unorderedListClass(depth) {
  const marker = LIST_UL_CLASS_BY_DEPTH[Math.min(depth, LIST_UL_CLASS_BY_DEPTH.length - 1)];
  return `my-2 ${marker} space-y-1 pl-6 text-sm text-ink marker:text-slate-400 dark:text-slate-100 dark:marker:text-slate-500`;
}

function orderedListClass() {
  return "my-2 list-decimal space-y-1 pl-6 text-sm text-ink marker:text-slate-400 dark:text-slate-100 dark:marker:text-slate-500";
}

/**
 * @param {import("../utils/markdownListRender").MarkdownListNode[]} nodes
 * @param {number} depth
 * @param {object} inlineOpts
 * @param {() => string} k
 */
function renderMarkdownListNodes(nodes, depth, inlineOpts, k) {
  if (!nodes?.length) return null;
  const groups = groupMarkdownListSiblings(nodes);
  return groups.map((group) => {
    if (group.kind === "task") {
      return (
        <ul key={k()} className="my-2 space-y-1.5 pl-1 text-sm">
          {group.items.map((item, j) => {
            const checked = item.task === "checked";
            return (
              <li
                key={j}
                className="flex flex-col gap-1 leading-relaxed text-ink dark:text-slate-100"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                      checked
                        ? "border-indigo-500 bg-indigo-500 text-white dark:border-indigo-400 dark:bg-indigo-500"
                        : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                    }`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <span
                    className={
                      checked ? "text-slate-500 line-through dark:text-slate-400" : ""
                    }
                  >
                    {inlineFormat(item.content, inlineOpts)}
                  </span>
                </div>
                {item.children.length > 0
                  ? renderMarkdownListNodes(item.children, depth + 1, inlineOpts, k)
                  : null}
              </li>
            );
          })}
        </ul>
      );
    }

    const Tag = group.kind === "ol" ? "ol" : "ul";
    const className =
      group.kind === "ol" ? orderedListClass() : unorderedListClass(depth);
    return (
      <Tag key={k()} className={className}>
        {group.items.map((item, j) => (
          <li
            key={j}
            className="leading-relaxed"
            value={
              group.kind === "ol" &&
              typeof item.number === "number" &&
              item.number > 0
                ? item.number
                : undefined
            }
          >
            {inlineFormat(item.content, inlineOpts)}
            {item.children.length > 0
              ? renderMarkdownListNodes(item.children, depth + 1, inlineOpts, k)
              : null}
          </li>
        ))}
      </Tag>
    );
  });
}

export function renderMarkdown(text, options = {}) {
  const {
    repoSlug = null,
    onWikiLinkClick = null,
    onWikiPageLinkClick = null,
    enableWikiLinks = false,
  } = options;
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  let key = 0;

  const k = () => `md-${key++}`;
  const inlineOpts = { repoSlug, onWikiLinkClick, onWikiPageLinkClick, enableWikiLinks };

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (line.trim() === "") { i++; continue; }

    // Fenced code block (must run before horizontal rules so --- inside fences is preserved)
    const fence = consumeFencedCodeBlock(lines, i);
    if (fence) {
      if (fence.lang === "mermaid") {
        elements.push(<MermaidBlock key={k()} chart={fence.code} />);
        i = fence.nextIndex;
        continue;
      }
      const html = highlightCodeBlock(fence.code, fence.lang);
      elements.push(
        <pre
          key={k()}
          className="my-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-900/50"
        >
          <code
            className={`hljs block font-mono text-xs leading-relaxed${fence.lang ? ` language-${fence.lang}` : ""}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>,
      );
      i = fence.nextIndex;
      continue;
    }

    // Standalone image (asset id in parens, not a URL path)
    const imageLine = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imageLine) {
      elements.push(
        <MarkdownInlineImage
          key={k()}
          alt={imageLine[1]}
          fileName={imageLine[2]}
          repoSlug={repoSlug}
        />,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      elements.push(<hr key={k()} className="my-5 border-slate-200 dark:border-slate-700/60" />);
      i++; continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const cls = level === 1
        ? "mb-3 mt-6 text-lg font-bold text-slate-950 dark:text-slate-50"
        : level === 2
          ? "mb-2 mt-5 text-base font-semibold text-slate-950 dark:text-slate-100"
          : "mb-1.5 mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100";
      elements.push(<div key={k()} className={cls}>{inlineFormat(content, inlineOpts)}</div>);
      i++; continue;
    }

    // Blockquote block (collect consecutive > lines)
    if (line.trimStart().startsWith(">")) {
      const bqLines = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        bqLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      elements.push(
        <blockquote key={k()} className="my-3 rounded-r-lg border-l-4 border-indigo-400 bg-indigo-50/60 py-2.5 pl-4 pr-3 text-sm text-slate-700 dark:border-indigo-500/60 dark:bg-indigo-500/10 dark:text-slate-300">
          {bqLines.map((l, j) => <p key={j} className="leading-relaxed">{inlineFormat(l, inlineOpts)}</p>)}
        </blockquote>
      );
      continue;
    }

    // Ordered / unordered / task lists (including nested)
    const listBlock = consumeMarkdownListBlock(lines, i);
    if (listBlock) {
      const rendered = renderMarkdownListNodes(listBlock.roots, 0, inlineOpts, k);
      if (Array.isArray(rendered)) elements.push(...rendered);
      else if (rendered) elements.push(rendered);
      i = listBlock.nextIndex;
      continue;
    }

    // GFM pipe table
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
        elements.push(
          <div key={k()} className="my-3 overflow-x-auto border border-slate-500 dark:border-slate-500">
            <table className="min-w-full border-collapse text-sm text-ink dark:text-slate-100">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/80">
                  {headerCells.map((h, hi) => (
                    <th
                      key={hi}
                      className="border border-slate-500 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink dark:border-slate-500 dark:text-slate-100"
                    >
                      {inlineFormat(h, inlineOpts)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="border border-slate-500 px-3 py-2 align-top text-sm dark:border-slate-500"
                      >
                        {inlineFormat(cell, inlineOpts)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }
    }

    // Paragraph (default)
    elements.push(
      <p key={k()} className="my-2 text-sm leading-relaxed text-ink dark:text-slate-100">{inlineFormat(line, inlineOpts)}</p>
    );
    i++;
  }

  return elements;
}

/**
 * Next inline delimiter by leftmost start: wiki / code / bold / italic.
 * @param {string} text
 * @param {boolean} enableWikiLinks
 * @returns {{ kind: string, start: number, end: number, content?: string, rawId?: string, label?: string } | null}
 */
function findNextInlineDelimiter(text, enableWikiLinks) {
  /** @type {{ kind: string, start: number, end: number, content?: string, rawId?: string, label?: string } | null} */
  let best = null;
  const consider = (cand) => {
    if (!cand) return;
    if (!best || cand.start < best.start) best = cand;
  };

  if (enableWikiLinks) {
    const m = text.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/);
    if (m && m.index != null) {
      consider({
        kind: "wiki",
        start: m.index,
        end: m.index + m[0].length,
        rawId: m[1].trim(),
        label: (m[2] || "").trim(),
      });
    }
  }

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

/** Format inline Markdown: bold, italic, inline code, optional [[ticket]] / [[wiki:…]] links. */
function inlineFormat(text, options = {}) {
  if (!text) return text;
  const {
    repoSlug = null,
    onWikiLinkClick = null,
    onWikiPageLinkClick = null,
    enableWikiLinks = false,
  } = options;
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const next = findNextInlineDelimiter(remaining, enableWikiLinks);
    if (!next) {
      parts.push(remaining);
      break;
    }
    if (next.start > 0) {
      parts.push(remaining.slice(0, next.start));
    }

    if (next.kind === "wiki") {
      const { kind, id } = classifyWikiLinkTarget(next.rawId);
      const label = next.label || id;
      if (kind === "wiki") {
        parts.push(
          <WikiPageLink
            key={`wp-${key++}`}
            pageId={id}
            label={label}
            repoSlug={repoSlug}
            onOpenWikiPage={onWikiPageLinkClick}
          />,
        );
      } else {
        parts.push(
          <WikiTicketLink
            key={`w-${key++}`}
            ticketId={id}
            label={label}
            repoSlug={repoSlug}
            onOpenTicket={onWikiLinkClick}
          />,
        );
      }
    } else if (next.kind === "code") {
      parts.push(
        <code
          key={`ic-${key++}`}
          className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-700/60 dark:text-slate-300"
        >
          {next.content}
        </code>,
      );
    } else if (next.kind === "bold") {
      parts.push(
        <strong key={`b-${key++}`} className="font-semibold">
          {inlineFormat(next.content, options)}
        </strong>,
      );
    } else if (next.kind === "italic") {
      parts.push(<em key={`i-${key++}`}>{inlineFormat(next.content, options)}</em>);
    }

    remaining = remaining.slice(next.end);
  }
  return parts.length === 1 ? parts[0] : parts;
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

export const priorityColors = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-amber-600 dark:text-amber-400",
  low: "text-blue-600 dark:text-blue-400",
};

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

function TestCaseDetailModal({ testCase, onClose, reviewEnabled = true }) {
  const overlayRef = useRef(null);
  const panelRef = useRef(null);

  // Close on overlay click (not panel click)
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose?.();
  };

  // Close on Escape
  useEffect(() => {
    if (!testCase) return;
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [testCase, onClose]);

  if (!testCase) return null;

  const tags = testCase.tags ?? [];
  const priorityKey = (testCase.priority || "").toLowerCase();

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex justify-end animate-overlay-fadein"
    >
      {/* Panel — slides in from right */}
      <div
        ref={panelRef}
        className="flex h-full w-full max-w-2xl flex-col rounded-l-ui border-l border-slate-200 bg-white shadow-2xl animate-drawer-slidein dark:border-slate-800 dark:bg-slate-950"
      >
        {/* ── Sticky Header ── */}
        <header className="sticky top-0 z-10 shrink-0 border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/95">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 font-mono text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
                  {testCase.case_id || "—"}
                </span>
                <ApproveStatusBadge status={testCase.approve_status} reviewEnabled={reviewEnabled} />
              </div>
              <h2 className="mt-1.5 text-lg font-semibold leading-snug text-slate-900 dark:text-slate-100">
                {testCase.title || "Untitled Test Case"}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              aria-label="Close detail panel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* ── Scrollable Content ── */}
        <div className="main-content-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">

          {/* ─ Metadata Strip ─ */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {/* Priority */}
            {testCase.priority && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Priority</span>
                <span className={`font-semibold ${priorityColors[priorityKey] || "text-slate-600 dark:text-slate-300"}`}>
                  {capitalize(testCase.priority)}
                </span>
              </div>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Tag className="h-3 w-3 text-slate-400 dark:text-slate-500" />
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getTagColorClass(tag)}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ─ Divider ─ */}
          <hr className="my-5 border-slate-100 dark:border-slate-800/60" />

          {/* ─ Markdown Body ─ */}
          {testCase.body ? (
            <article className="prose-rex">
              {renderMarkdown(testCase.body)}
            </article>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
              No body content for this test case.
            </p>
          )}
        </div>

        {/* ── Footer — Updated by · relative time ── */}
        {(testCase.updated_at || testCase.updated_by) && (
          <footer className="shrink-0 border-t border-slate-100 px-6 py-3 dark:border-slate-800/80">
            <UpdatedByLine updatedAt={testCase.updated_at} updatedBy={testCase.updated_by} />
          </footer>
        )}
      </div>
    </div>
  );
}

export default TestCaseDetailModal;
