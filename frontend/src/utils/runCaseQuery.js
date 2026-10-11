import { listRunCases, searchRunCases } from "../services/api";

const DEFAULT_PAGE_SIZE = 5000;

/**
 * Fetch all run case rows matching params, paginating until the full result set is loaded.
 * @param {string|null} repoSlug
 * @param {object} params
 * @param {{ pageSize?: number, includeArchived?: boolean }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllRunCases(
  repoSlug,
  params = {},
  { pageSize = DEFAULT_PAGE_SIZE, includeArchived = false } = {},
) {
  if (!repoSlug) return [];

  const merged = [];
  const seen = new Set();
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const res = await searchRunCases(repoSlug, {
      ...params,
      include_archived: includeArchived,
      limit: pageSize,
      offset,
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    total = typeof res?.total === "number" ? res.total : items.length;

    for (const row of items) {
      const key = `${row?.run_id}\0${row?.file_path}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }

    if (items.length === 0) break;
    offset += items.length;
  }

  return merged;
}

/** Fetch every case row for a run folder via paginated list_run_cases. */
export async function fetchAllRunCasesForFolder(
  runId,
  repoSlug = null,
  folderPrefix = null,
  pageSize = 500,
) {
  const all = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const res = await listRunCases(runId, repoSlug, {
      folder_prefix: folderPrefix,
      limit: pageSize,
      offset,
    });
    const items = res?.items ?? [];
    all.push(...items);
    total = res?.total ?? 0;
    offset += pageSize;
    if (items.length === 0) break;
  }
  return all;
}

/**
 * Map SearchPanel chips to search_run_cases API query params.
 * @param {Array<{ key: string, value: string }>} chips
 * @returns {object}
 */
export function chipsToRunCaseQueryParams(chips) {
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
      case "result":
        params.result = value.toLowerCase();
        break;
      case "tag":
        params.tag = value;
        break;
      case "priority":
        params.priority = value;
        break;
      case "requirement_id":
        params.requirement_id = value;
        break;
      case "executed_by":
        params.executed_by = value;
        break;
      case "assigned_to":
        params.assigned_to = value;
        break;
      case "automated":
        params.automated = value.toLowerCase() === "true";
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
