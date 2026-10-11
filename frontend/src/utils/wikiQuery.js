import { getWikiPages } from "../services/api";

const DEFAULT_PAGE_SIZE = 5000;

/**
 * Map SearchPanel chips to list_wiki_pages API query params.
 * @param {Array<{ key: string, value: string }>} chips
 * @returns {object}
 */
export function chipsToWikiQueryParams(chips) {
  if (!Array.isArray(chips) || chips.length === 0) return {};

  const params = {};
  const freeTextParts = [];

  for (const chip of chips) {
    const key = chip?.key;
    const value = (chip?.value ?? "").trim();
    if (!key || !value) continue;

    switch (key) {
      case "q":
        freeTextParts.push(value);
        break;
      case "tag":
        params.tag = value;
        break;
      case "status":
        params.status = value;
        break;
      default:
        break;
    }
  }

  if (freeTextParts.length) {
    params.search = freeTextParts.join(" ");
  }
  return params;
}

/**
 * @param {string} repoSlug
 * @param {object} queryParams
 * @param {{ limit?: number, offset?: number, archiveMode?: boolean }} [opts]
 */
export async function fetchWikiWindow(repoSlug, queryParams, opts = {}) {
  const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
  const offset = opts.offset ?? 0;
  const archiveMode = Boolean(opts.archiveMode);
  return getWikiPages(repoSlug, {
    ...queryParams,
    limit,
    offset,
    archived_only: archiveMode ? true : undefined,
  });
}
