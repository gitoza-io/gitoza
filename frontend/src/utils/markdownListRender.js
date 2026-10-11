import { LIST_INDENT_UNIT } from "./markdownListEdit";

const LIST_LINE_RE = /^(\s*)([-*+]|\d+[.)])\s(.*)$/;

/**
 * @typedef {{
 *   ordered: boolean,
 *   number: number | null,
 *   content: string,
 *   task: "checked" | "unchecked" | null,
 *   depth: number,
 *   children: MarkdownListNode[],
 * }} MarkdownListNode
 */

/**
 * @param {string} line
 * @returns {{ indentCols: number, ordered: boolean, number: number | null, content: string } | null}
 */
export function parseMarkdownListLine(line) {
  const m = LIST_LINE_RE.exec(line);
  if (!m) return null;
  const indentRaw = (m[1] ?? "").replace(/\t/g, LIST_INDENT_UNIT);
  const indentCols = indentRaw.length;
  const marker = m[2] ?? "";
  const ordered = /^\d+[.)]$/.test(marker);
  const number = ordered ? parseInt(marker.slice(0, -1), 10) : null;
  return {
    indentCols,
    ordered,
    number: Number.isFinite(number) ? number : null,
    content: m[3] ?? "",
  };
}

/**
 * @param {string} content
 * @returns {"checked" | "unchecked" | null}
 */
function parseTaskState(content) {
  if (/^\[[xX]\]\s/.test(content)) return "checked";
  if (/^\[\s\]\s/.test(content)) return "unchecked";
  return null;
}

/**
 * @param {string} content
 * @param {"checked" | "unchecked" | null} task
 */
function stripTaskMarker(content, task) {
  if (!task) return content;
  return content.replace(/^\[[ xX]\]\s/, "");
}

/**
 * Build a nested list tree from consecutive list lines.
 * Depth is indent columns / indent unit length (2 spaces).
 *
 * @param {string[]} lines
 * @param {number} startIndex
 * @returns {{ roots: MarkdownListNode[], nextIndex: number } | null}
 */
export function consumeMarkdownListBlock(lines, startIndex) {
  if (startIndex >= lines.length) return null;
  if (!parseMarkdownListLine(lines[startIndex])) return null;

  const flat = [];
  let i = startIndex;
  while (i < lines.length) {
    const parsed = parseMarkdownListLine(lines[i]);
    if (!parsed) break;
    const depth = Math.floor(parsed.indentCols / LIST_INDENT_UNIT.length);
    const task = parseTaskState(parsed.content);
    flat.push({
      ordered: parsed.ordered,
      number: parsed.number,
      content: stripTaskMarker(parsed.content, task),
      task,
      depth,
      children: [],
    });
    i += 1;
  }

  if (flat.length === 0) return null;

  /** @type {MarkdownListNode[]} */
  const roots = [];
  /** @type {{ node: MarkdownListNode | null, depth: number, children: MarkdownListNode[] }[]} */
  const stack = [{ node: null, depth: -1, children: roots }];

  for (const item of flat) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    /** @type {MarkdownListNode} */
    const node = {
      ordered: item.ordered,
      number: item.number,
      content: item.content,
      task: item.task,
      depth: item.depth,
      children: [],
    };
    parent.children.push(node);
    stack.push({ node, depth: item.depth, children: node.children });
  }

  return { roots, nextIndex: i };
}

/**
 * Group consecutive siblings that share the same ordered/task-list style.
 * Task lists (any node with task != null in the run) stay in one task group.
 *
 * @param {MarkdownListNode[]} nodes
 * @returns {{ kind: "task" | "ul" | "ol", items: MarkdownListNode[] }[]}
 */
export function groupMarkdownListSiblings(nodes) {
  /** @type {{ kind: "task" | "ul" | "ol", items: MarkdownListNode[] }[]} */
  const groups = [];
  for (const node of nodes) {
    const kind = node.task != null ? "task" : node.ordered ? "ol" : "ul";
    const last = groups[groups.length - 1];
    if (last && last.kind === kind) {
      last.items.push(node);
    } else {
      groups.push({ kind, items: [node] });
    }
  }
  return groups;
}
