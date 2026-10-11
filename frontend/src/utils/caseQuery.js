import { getCases } from "../services/api";
import { REPOSITORY_CASE_WINDOW_SIZE } from "../constants/repositoryCaseList";

const DEFAULT_PAGE_SIZE = 5000;

/**
 * Fetch one page of case rows from list_cases (server-side window).
 * @param {string|null} repoSlug
 * @param {object} params
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ items: Array<object>, total: number }>}
 */
export async function fetchCaseWindow(
  repoSlug,
  params = {},
  { limit = REPOSITORY_CASE_WINDOW_SIZE, offset = 0 } = {},
) {
  if (!repoSlug) return { items: [], total: 0 };

  const res = await getCases(repoSlug, {
    sort_by: "case_id",
    sort_dir: "asc",
    ...params,
    limit,
    offset,
  });
  const items = Array.isArray(res?.items) ? res.items : [];
  const total = typeof res?.total === "number" ? res.total : items.length;
  return { items, total };
}

/**
 * Fetch all case rows matching params, paginating until the full result set is loaded.
 * @param {string|null} repoSlug
 * @param {object} params - forwarded to getCases (snake_case or camelCase keys)
 * @param {{ pageSize?: number }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllCases(repoSlug, params = {}, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  if (!repoSlug) return [];

  const merged = [];
  const seen = new Set();
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const res = await getCases(repoSlug, {
      ...params,
      limit: pageSize,
      offset,
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    total = typeof res?.total === "number" ? res.total : items.length;

    for (const row of items) {
      const key = row?.file_path;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }

    if (items.length === 0) break;
    offset += items.length;
  }

  return merged;
}

/**
 * Map SearchPanel chips to list_cases API query params.
 * @param {Array<{ key: string, value: string }>} chips
 * @returns {object}
 */
export function chipsToCaseQueryParams(chips) {
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
      case "caseID":
        params.search = params.search ? `${params.search} ${value}` : value;
        break;
      case "title":
        params.search = params.search ? `${params.search} ${value}` : value;
        break;
      case "tag":
        params.tag = value;
        break;
      case "status":
        params.status = value;
        break;
      case "priority":
        params.priority = value;
        break;
      case "approve_status":
        params.approve_status = value;
        break;
      case "updated_by":
        params.updated_by = value;
        break;
      case "assigned_to":
        params.assigned_to = value;
        break;
      case "automated":
        params.automated = value.toLowerCase() === "true";
        break;
      case "param": {
        const paramKey = (chip.paramKey ?? "").trim();
        if (!paramKey) break;
        if (!params.param_filters) params.param_filters = [];
        params.param_filters.push({ key: paramKey, value });
        break;
      }
      default: {
        // Frontmatter custom fields (param-field chips): key is the param name
        if (!params.param_filters) params.param_filters = [];
        params.param_filters.push({ key, value });
        break;
      }
    }
  }

  if (params.param_filters?.length) {
    params.param_filters = JSON.stringify(params.param_filters);
  } else {
    delete params.param_filters;
  }

  if (freeTextParts.length) {
    const q = freeTextParts.join(" ");
    params.search = params.search ? `${params.search} ${q}` : q;
  }

  return params;
}

/**
 * Run async tasks with bounded concurrency.
 * @param {Array<T>} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} fn
 */
export async function runWithConcurrency(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
