/**
 * Helpers for case filter options (tags, etc.) used by search and tag autocomplete.
 */

import { assigneeMatchKey } from "../constants/assignee";

/**
 * Collect distinct tags from loaded case rows (case-insensitive dedupe, sorted).
 * @param {Array<{ tags?: string[] }>} cases
 * @returns {string[]}
 */
export function collectTagsFromCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return [];
  const seen = new Map();
  for (const c of cases) {
    for (const t of c.tags ?? []) {
      const norm = String(t).trim();
      if (!norm) continue;
      const key = norm.toLowerCase();
      if (!seen.has(key)) seen.set(key, norm);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Merge new tags into filter options without duplicates (preserves existing order, appends new).
 * @param {object} prev
 * @param {string[]} newTags
 * @returns {object}
 */
export function mergeTagsIntoFilters(prev, newTags) {
  if (!Array.isArray(newTags) || newTags.length === 0) return prev ?? {};
  const base = prev ?? {};
  const existing = new Set((base.tags ?? []).map((t) => String(t).toLowerCase()));
  const merged = [...(base.tags ?? [])];
  for (const t of newTags) {
    const norm = String(t).trim();
    if (!norm) continue;
    const key = norm.toLowerCase();
    if (!existing.has(key)) {
      merged.push(norm);
      existing.add(key);
    }
  }
  merged.sort((a, b) => a.localeCompare(b));
  return { ...base, tags: merged };
}

/**
 * When API tags are empty but loaded cases have tags, use case tags as fallback.
 * @param {object} filterOptions
 * @param {Array<{ tags?: string[] }>} testCases
 * @returns {object}
 */
export function mergeCaseFilterTags(filterOptions, testCases) {
  const opts = filterOptions ?? {};
  const apiTags = opts.tags ?? [];
  if (apiTags.length > 0) return opts;
  const fromCases = collectTagsFromCases(testCases);
  if (fromCases.length === 0) return opts;
  return { ...opts, tags: fromCases };
}

/**
 * Collect distinct param keys and per-key values from loaded case rows.
 * @param {Array<{ params?: Record<string, string> }>} cases
 * @returns {{ param_keys: string[], param_values_by_key: Record<string, string[]> }}
 */
export function collectParamsFromCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    return { param_keys: [], param_values_by_key: {} };
  }
  const keys = new Map();
  const valuesByKey = new Map();
  for (const c of cases) {
    const params = c.params ?? {};
    for (const [rawKey, rawVal] of Object.entries(params)) {
      const key = String(rawKey).trim();
      const val = String(rawVal).trim();
      if (!key || !val) continue;
      const lookup = key.toLowerCase();
      if (!keys.has(lookup)) keys.set(lookup, key);
      const bucket = valuesByKey.get(key) ?? new Map();
      bucket.set(val.toLowerCase(), val);
      valuesByKey.set(key, bucket);
    }
  }
  const param_keys = [...keys.values()].sort((a, b) => a.localeCompare(b));
  const param_values_by_key = {};
  for (const key of param_keys) {
    const bucket = valuesByKey.get(key);
    param_values_by_key[key] = bucket ? [...bucket.values()].sort((a, b) => a.localeCompare(b)) : [];
  }
  return { param_keys, param_values_by_key };
}

/**
 * Merge new params into filter catalog without duplicates.
 * @param {object} prev
 * @param {Record<string, string>} newParams
 * @returns {object}
 */
export function mergeParamsIntoFilters(prev, newParams) {
  if (!newParams || typeof newParams !== "object" || Object.keys(newParams).length === 0) {
    return prev ?? {};
  }
  const base = prev ?? {};
  const keySeen = new Map(
    (base.param_keys ?? []).map((k) => [String(k).toLowerCase(), String(k)]),
  );
  const valuesByKey = { ...(base.param_values_by_key ?? {}) };

  for (const [rawKey, rawVal] of Object.entries(newParams)) {
    const key = String(rawKey).trim();
    const val = String(rawVal).trim();
    if (!key || !val) continue;
    const lookup = key.toLowerCase();
    if (!keySeen.has(lookup)) keySeen.set(lookup, key);
    const canonicalKey = keySeen.get(lookup);
    const existing = new Map(
      (valuesByKey[canonicalKey] ?? []).map((v) => [String(v).toLowerCase(), String(v)]),
    );
    existing.set(val.toLowerCase(), val);
    valuesByKey[canonicalKey] = [...existing.values()].sort((a, b) => a.localeCompare(b));
  }

  const param_keys = [...keySeen.values()].sort((a, b) => a.localeCompare(b));
  return { ...base, param_keys, param_values_by_key: valuesByKey };
}

/**
 * When API param keys are empty but loaded cases have params, use case params as fallback.
 * @param {object} filterOptions
 * @param {Array<{ params?: Record<string, string> }>} testCases
 * @returns {object}
 */
export function mergeCaseFilterParams(filterOptions, testCases) {
  const opts = filterOptions ?? {};
  const apiKeys = opts.param_keys ?? [];
  if (apiKeys.length > 0) return opts;
  const fromCases = collectParamsFromCases(testCases);
  if (fromCases.param_keys.length === 0) return opts;
  return { ...opts, ...fromCases };
}

export function resolveCanonicalParamKey(input, paramKeys = []) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const match = (paramKeys ?? []).find((k) => String(k).trim().toLowerCase() === lower);
  return match ? String(match).trim() : trimmed;
}

/**
 * Values for a param key, using case-insensitive key lookup in the catalog.
 * @param {string} paramKey
 * @param {Record<string, string[]>} paramValuesByKey
 * @param {string[]} [paramKeys]
 * @returns {string[]}
 */
export function paramValuesForKey(paramKey, paramValuesByKey = {}, paramKeys = []) {
  const canonical = resolveCanonicalParamKey(paramKey, paramKeys);
  if (!canonical) return [];
  if (paramValuesByKey?.[canonical]) return paramValuesByKey[canonical];
  const lower = canonical.toLowerCase();
  const entry = Object.entries(paramValuesByKey ?? {}).find(
    ([k]) => String(k).trim().toLowerCase() === lower,
  );
  return entry ? entry[1] : [];
}

/**
 * Collect distinct assignees from loaded case rows (case-insensitive dedupe, sorted).
 * @param {Array<{ assigned_to?: string | null }>} cases
 * @returns {string[]}
 */
export function collectAssigneesFromCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return [];
  const seen = new Map();
  for (const c of cases) {
    const norm = String(c.assigned_to ?? "").trim();
    if (!norm) continue;
    const key = assigneeMatchKey(norm);
    if (!seen.has(key)) seen.set(key, norm);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Merge assignee names into filter options without duplicates (preserves existing order).
 * @param {object} prev
 * @param {string[]} names
 * @returns {object}
 */
export function mergeAssigneesIntoFilters(prev, names) {
  if (!Array.isArray(names) || names.length === 0) return prev ?? {};
  const base = prev ?? {};
  const existing = new Set((base.assigned_to ?? []).map((n) => assigneeMatchKey(n)));
  const merged = [...(base.assigned_to ?? [])];
  for (const raw of names) {
    const norm = String(raw).trim();
    if (!norm) continue;
    const key = assigneeMatchKey(norm);
    if (!existing.has(key)) {
      merged.push(norm);
      existing.add(key);
    }
  }
  merged.sort((a, b) => a.localeCompare(b));
  return { ...base, assigned_to: merged };
}

/**
 * Union API, workspace, and loaded-case assignees for search dropdowns.
 * @param {object} filterOptions
 * @param {{ workspaceUsernames?: string[], cases?: Array<{ assigned_to?: string | null }> }} sources
 * @returns {object}
 */
export function mergeFilterAssignees(filterOptions, { workspaceUsernames = [], cases = [] } = {}) {
  const opts = filterOptions ?? {};
  let merged = mergeAssigneesIntoFilters(opts, workspaceUsernames);
  merged = mergeAssigneesIntoFilters(merged, collectAssigneesFromCases(cases));
  return merged;
}

/**
 * Collect distinct updated_by values from loaded case rows (case-insensitive dedupe, sorted).
 * @param {Array<{ updated_by?: string | null }>} cases
 * @returns {string[]}
 */
export function collectUpdatedByFromCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return [];
  const seen = new Map();
  for (const c of cases) {
    const norm = String(c.updated_by ?? "").trim();
    if (!norm) continue;
    const key = assigneeMatchKey(norm);
    if (!seen.has(key)) seen.set(key, norm);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Merge updated_by names into filter options without duplicates (preserves existing order).
 * @param {object} prev
 * @param {string[]} names
 * @returns {object}
 */
export function mergeUpdatedByIntoFilters(prev, names) {
  if (!Array.isArray(names) || names.length === 0) return prev ?? {};
  const base = prev ?? {};
  const existing = new Set((base.updated_by ?? []).map((n) => assigneeMatchKey(n)));
  const merged = [...(base.updated_by ?? [])];
  for (const raw of names) {
    const norm = String(raw).trim();
    if (!norm) continue;
    const key = assigneeMatchKey(norm);
    if (!existing.has(key)) {
      merged.push(norm);
      existing.add(key);
    }
  }
  merged.sort((a, b) => a.localeCompare(b));
  return { ...base, updated_by: merged };
}

/**
 * Union API, workspace, and loaded-case updated_by values for filter dropdowns.
 * @param {object} filterOptions
 * @param {{ workspaceUsernames?: string[], cases?: Array<{ updated_by?: string | null }> }} sources
 * @returns {object}
 */
export function mergeFilterUpdatedBy(filterOptions, { workspaceUsernames = [], cases = [] } = {}) {
  const opts = filterOptions ?? {};
  let merged = mergeUpdatedByIntoFilters(opts, workspaceUsernames);
  merged = mergeUpdatedByIntoFilters(merged, collectUpdatedByFromCases(cases));
  return merged;
}
