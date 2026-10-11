import { getTickets, getWikiPages } from "../services/api";

/** Obsidian-style wikilink: [[id]] or [[id|label]]. */
export const WIKI_LINK_RE = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Classify a wikilink target: `wiki:W-…` vs ticket id.
 * @param {string} rawId
 * @returns {{ kind: 'wiki' | 'ticket', id: string }}
 */
export function classifyWikiLinkTarget(rawId) {
  const raw = (rawId || "").trim();
  const lower = raw.toLowerCase();
  if (lower.startsWith("wiki:")) {
    return { kind: "wiki", id: raw.slice(5).trim() };
  }
  return { kind: "ticket", id: raw };
}

/**
 * Build an Obsidian-style wiki link for a ticket.
 * @param {string} ticketId
 * @param {string} [label]
 * @returns {string} e.g. `[[T-1|Fix login]]` or `[[T-1]]`
 */
export function formatWikiTicketLink(ticketId, label) {
  const id = (ticketId || "").trim();
  if (!id) return "";
  const lab = (label || "").trim();
  return lab && lab !== id ? `[[${id}|${lab}]]` : `[[${id}]]`;
}

/**
 * Build `[[wiki:W-xxxxxx]]` / `[[wiki:W-xxxxxx|Label]]` for a wiki page.
 * @param {string} pageId
 * @param {string} [label]
 * @returns {string}
 */
export function formatWikiPageLink(pageId, label) {
  const id = (pageId || "").trim();
  if (!id) return "";
  const target = id.toLowerCase().startsWith("wiki:") ? id : `wiki:${id}`;
  const bareId = classifyWikiLinkTarget(target).id;
  const lab = (label || "").trim();
  return lab && lab !== bareId && lab !== target
    ? `[[${target}|${lab}]]`
    : `[[${target}]]`;
}

/**
 * TipTap Markdown serialization escapes `[[wikilinks]]` as `\[\[…\]\]`.
 * Restore Gitoza wiki-link syntax so View mode / WIKI_LINK_RE can match.
 * @param {string | null | undefined} md
 * @returns {string}
 */
export function unescapeMarkdownWikiLinks(md) {
  if (md == null || typeof md !== "string" || md.length === 0) {
    return md == null ? "" : md;
  }
  if (!md.includes("\\[")) return md;
  // Full TipTap-escaped pairs: \[\[id\]\] or \[\[id|label\]\]
  return md.replace(/\\\[\\\[([^\]]*)\\\]\\\]/g, (_, inner) => {
    const restored = String(inner).replace(/\\\|/g, "|");
    return `[[${restored}]]`;
  });
}

/**
 * Parse all wiki links from markdown text.
 * @param {string} text
 * @returns {{ kind: 'wiki' | 'ticket', id: string, label: string }[]}
 */
export function parseWikiLinks(text) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  const re = new RegExp(WIKI_LINK_RE.source, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    const { kind, id } = classifyWikiLinkTarget(raw);
    if (!id) continue;
    const label = (m[2] || "").trim() || id;
    out.push({ kind, id, label });
  }
  return out;
}

/**
 * Resolve a ticket id to a list row (includes closed statuses).
 * @param {string|null} repoSlug
 * @param {string} ticketId
 * @returns {Promise<object|null>}
 */
export async function resolveTicketById(repoSlug, ticketId) {
  const id = (ticketId || "").trim();
  if (!repoSlug || !id) return null;
  try {
    const res = await getTickets(repoSlug, {
      ticket_id: id,
      limit: 1,
      offset: 0,
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    return items[0] || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a wiki page_id to a list row.
 * @param {string|null} repoSlug
 * @param {string} pageId
 * @returns {Promise<object|null>}
 */
export async function resolveWikiPageById(repoSlug, pageId) {
  const id = (pageId || "").trim();
  if (!repoSlug || !id) return null;
  try {
    const res = await getWikiPages(repoSlug, {
      page_id: id,
      limit: 1,
      offset: 0,
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    return items[0] || null;
  } catch {
    return null;
  }
}

/**
 * Search tickets for parent autocomplete.
 * @param {string|null} repoSlug
 * @param {string} query
 * @param {{ excludeId?: string, limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function searchTicketsForLink(repoSlug, query, opts = {}) {
  if (!repoSlug) return [];
  const q = (query || "").trim();
  if (!q) return [];
  try {
    const res = await getTickets(repoSlug, {
      search: q,
      limit: opts.limit ?? 12,
      offset: 0,
    });
    let items = Array.isArray(res?.items) ? res.items : [];
    const exclude = (opts.excludeId || "").trim();
    if (exclude) {
      items = items.filter((t) => t.ticket_id !== exclude);
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Search wiki pages by title / page_id for link insert.
 * @param {string|null} repoSlug
 * @param {string} query
 * @param {{ excludeId?: string, limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function searchWikiPagesForLink(repoSlug, query, opts = {}) {
  if (!repoSlug) return [];
  const q = (query || "").trim();
  if (!q) return [];
  try {
    const res = await getWikiPages(repoSlug, {
      search: q,
      limit: opts.limit ?? 12,
      offset: 0,
    });
    let items = Array.isArray(res?.items) ? res.items : [];
    const exclude = (opts.excludeId || "").trim();
    if (exclude) {
      items = items.filter((p) => p.page_id !== exclude);
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Normalize ticket + wiki list rows into a flat entity-link suggestion list.
 * Tickets first, then wiki pages (stable for scanning / keyboard nav).
 * @param {object[]} tickets
 * @param {object[]} pages
 * @param {{ excludeTicketId?: string, excludePageId?: string, limitPerKind?: number }} [opts]
 * @returns {{ kind: 'ticket' | 'wiki', id: string, title: string, file_path: string }[]}
 */
export function mergeEntityLinkResults(tickets, pages, opts = {}) {
  const limitPerKind = opts.limitPerKind ?? 6;
  const excludeTicket = (opts.excludeTicketId || "").trim();
  const excludePage = (opts.excludePageId || "").trim();
  const out = [];

  const ticketRows = Array.isArray(tickets) ? tickets : [];
  for (const t of ticketRows) {
    const id = (t?.ticket_id || "").trim();
    if (!id || (excludeTicket && id === excludeTicket)) continue;
    out.push({
      kind: "ticket",
      id,
      title: (t?.title || "").trim() || id,
      file_path: t?.file_path || "",
    });
    if (out.filter((x) => x.kind === "ticket").length >= limitPerKind) break;
  }

  const pageRows = Array.isArray(pages) ? pages : [];
  let wikiCount = 0;
  for (const p of pageRows) {
    const id = (p?.page_id || "").trim();
    if (!id || (excludePage && id === excludePage)) continue;
    out.push({
      kind: "wiki",
      id,
      title: (p?.title || "").trim() || id,
      file_path: p?.file_path || "",
    });
    wikiCount += 1;
    if (wikiCount >= limitPerKind) break;
  }

  return out;
}

/**
 * Search tickets and wiki pages for a unified link insert picker.
 * @param {string|null} repoSlug
 * @param {string} query
 * @param {{ excludeTicketId?: string, excludePageId?: string, limitPerKind?: number }} [opts]
 * @returns {Promise<{ kind: 'ticket' | 'wiki', id: string, title: string, file_path: string }[]>}
 */
export async function searchEntitiesForLink(repoSlug, query, opts = {}) {
  if (!repoSlug) return [];
  const q = (query || "").trim();
  if (!q) return [];
  const limitPerKind = opts.limitPerKind ?? 6;
  const [tickets, pages] = await Promise.all([
    searchTicketsForLink(repoSlug, q, {
      excludeId: opts.excludeTicketId,
      limit: limitPerKind,
    }),
    searchWikiPagesForLink(repoSlug, q, {
      excludeId: opts.excludePageId,
      limit: limitPerKind,
    }),
  ]);
  return mergeEntityLinkResults(tickets, pages, {
    excludeTicketId: opts.excludeTicketId,
    excludePageId: opts.excludePageId,
    limitPerKind,
  });
}
