/**
 * Pure helpers for run case list window keys and item merging.
 */

import { compareCasesByCaseId } from "./exportHierarchy";

/**
 * @param {string|null|undefined} runId
 * @param {string|null|undefined} folderPrefix
 */
export function runCaseWindowQueryKey(runId, folderPrefix) {
  return [runId ?? "", folderPrefix ?? ""].join("\0");
}

/**
 * Append fetched rows without duplicate file_path (preserves order).
 * @param {Array<object>} existing
 * @param {Array<object>} incoming
 * @returns {Array<object>}
 */
export function mergeRunWindowItems(existing, incoming) {
  const seen = new Set((existing ?? []).map((r) => r?.file_path).filter(Boolean));
  const out = [...(existing ?? [])];
  for (const row of incoming ?? []) {
    const key = row?.file_path;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * @param {Array<object>} items
 * @param {string[]} pathsToRemove
 * @returns {Array<object>}
 */
export function removeRunWindowPaths(items, pathsToRemove) {
  const paths = new Set((pathsToRemove ?? []).filter(Boolean));
  if (!paths.size) return items ?? [];
  return (items ?? []).filter((r) => !paths.has(r.file_path));
}

/**
 * Remove paths from every entry in a run case window cache map for a given run.
 * @param {Map<string, { items: Array<object>, total: number }>} cacheMap
 * @param {string} runId
 * @param {string[]} pathsToRemove
 */
export function patchAllRunWindowCachesRemove(cacheMap, runId, pathsToRemove) {
  const paths = (pathsToRemove ?? []).filter(Boolean);
  if (!paths.length || !cacheMap || !runId) return;

  const runPrefix = `${runId}\0`;
  for (const [key, cached] of cacheMap.entries()) {
    if (!key.startsWith(runPrefix)) continue;
    const prevItems = cached?.items ?? [];
    const nextItems = removeRunWindowPaths(prevItems, paths);
    const removedCount = prevItems.length - nextItems.length;
    if (removedCount > 0) {
      cacheMap.set(key, {
        items: nextItems,
        total: Math.max(0, (cached?.total ?? 0) - removedCount),
      });
    }
  }
}

/**
 * Remove all cache entries for a run.
 * @param {Map<string, { items: Array<object>, total: number }>} cacheMap
 * @param {string} runId
 */
export function clearRunWindowCachesForRun(cacheMap, runId) {
  if (!cacheMap || !runId) return;
  const runPrefix = `${runId}\0`;
  for (const key of [...cacheMap.keys()]) {
    if (key.startsWith(runPrefix)) {
      cacheMap.delete(key);
    }
  }
}

/**
 * @param {Array<object>} items
 * @param {object} row
 * @returns {Array<object>}
 */
export function upsertRunWindowRow(items, row) {
  if (!row?.file_path) return items ?? [];
  const list = items ?? [];
  const idx = list.findIndex((r) => r.file_path === row.file_path);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = { ...next[idx], ...row };
    return next;
  }
  return [...list, row];
}

/**
 * @param {Array<object>} items
 * @param {string} filePath
 * @param {object} partial
 * @returns {Array<object>}
 */
export function patchRunWindowRow(items, filePath, partial) {
  if (!filePath) return items ?? [];
  return (items ?? []).map((row) =>
    row.file_path === filePath ? { ...row, ...partial } : row,
  );
}

/**
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function sortRunWindowRowsByCaseId(rows) {
  return [...(rows ?? [])].sort(compareCasesByCaseId);
}
