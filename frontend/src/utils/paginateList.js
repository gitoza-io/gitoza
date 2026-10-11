/**
 * Client-side pagination for flat case lists.
 *
 * @template T
 * @param {T[]} items
 * @param {{ page?: number; pageSize?: number }} options
 * @returns {{
 *   items: T[];
 *   page: number;
 *   pageSize: number;
 *   total: number;
 *   totalPages: number;
 *   startIndex: number;
 *   endIndex: number;
 *   rangeLabel: string;
 * }}
 */
export function paginateList(items, { page = 1, pageSize = 50 } = {}) {
  const list = items ?? [];
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  const slice = list.slice(startIndex, endIndex);
  const rangeLabel =
    total === 0 ? "0 of 0" : `${startIndex + 1}–${endIndex} of ${total}`;

  return {
    items: slice,
    page: safePage,
    pageSize,
    total,
    totalPages,
    startIndex,
    endIndex,
    rangeLabel,
  };
}

/**
 * Paginate grouped case list entries: cases count toward page size; suite headers are
 * included when their section has visible cases on the page (repeated across page breaks).
 *
 * @param {Array<{ type: string, item?: object, directoryPath?: string, label?: string, depth?: number }>} entries
 * @param {{ page?: number; pageSize?: number }} options
 * @returns {{
 *   entries: typeof entries;
 *   items: object[];
 *   page: number;
 *   pageSize: number;
 *   total: number;
 *   totalPages: number;
 *   startIndex: number;
 *   endIndex: number;
 *   rangeLabel: string;
 * }}
 */
export function paginateGroupedCaseListEntries(entries, { page = 1, pageSize = 50 } = {}) {
  const allEntries = entries ?? [];
  const caseItems = allEntries.filter((e) => e.type === "case").map((e) => e.item);
  const casePaginated = paginateList(caseItems, { page, pageSize });
  const pagePathSet = new Set(casePaginated.items.map((c) => c.file_path));

  const visibleEntries = [];
  const headerStack = [];
  let lastRenderedStacks = [];

  for (const entry of allEntries) {
    if (entry.type === "suiteHeader") {
      while (headerStack.length > entry.depth) headerStack.pop();
      headerStack[entry.depth] = entry;
      headerStack.length = entry.depth + 1;
      continue;
    }
    if (entry.type !== "case" || !pagePathSet.has(entry.item.file_path)) continue;

    const currentStacks = headerStack.slice();
    let emitFrom = currentStacks.length;
    if (lastRenderedStacks.length === 0) {
      emitFrom = 0;
    } else {
      for (let i = 0; i < currentStacks.length; i++) {
        const cur = currentStacks[i];
        const last = lastRenderedStacks[i];
        if (!last || last.directoryPath !== cur.directoryPath) {
          emitFrom = i;
          break;
        }
      }
    }

    for (let i = emitFrom; i < currentStacks.length; i++) {
      visibleEntries.push(currentStacks[i]);
    }
    visibleEntries.push(entry);
    lastRenderedStacks = currentStacks;
  }

  return {
    ...casePaginated,
    entries: visibleEntries,
    items: casePaginated.items,
  };
}

/**
 * Build compact page numbers with ellipsis for pagination UI.
 * @param {number} currentPage
 * @param {number} totalPages
 * @returns {Array<number | "ellipsis">}
 */
export function buildPaginationSequence(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("ellipsis");
    out.push(sorted[i]);
  }
  return out;
}
