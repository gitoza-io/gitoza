/**
 * Pure helpers for repository case list window keys and item merging.
 */

import { compareCasesByCaseId } from "./exportHierarchy";

/**
 * @param {string|null|undefined} filePath
 * @param {string|null|undefined} folderPath
 * @returns {boolean}
 */
export function isDirectCaseInFolder(filePath, folderPath) {
  const fp = (filePath || "").replace(/\\/g, "/");
  const norm = (folderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!fp || !norm) return false;
  const prefix = `${norm}/`;
  if (!fp.startsWith(prefix)) return false;
  const after = fp.slice(prefix.length);
  return after.indexOf("/") === -1 && (after.endsWith(".yaml") || after.endsWith(".yml"));
}

/**
 * Re-sort direct child cases of folderPath by case_id, preserving other rows in place.
 * @param {Array<object>} rows
 * @param {string|null|undefined} folderPath
 * @returns {Array<object>}
 */
export function resortCaseRowsForFolder(rows, folderPath) {
  const list = rows ?? [];
  const norm = (folderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm || !list.length) return list;

  const directRows = list.filter((row) => isDirectCaseInFolder(row?.file_path, norm));
  if (directRows.length <= 1) return list;

  const sorted = [...directRows].sort(compareCasesByCaseId);
  let directIdx = 0;

  return list.map((row) => {
    if (!isDirectCaseInFolder(row?.file_path, norm)) return row;
    return sorted[directIdx++];
  });
}

/**
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function sortCaseRowsByCaseId(rows) {
  return [...(rows ?? [])].sort(compareCasesByCaseId);
}

/**
 * @param {string|null|undefined} repoSlug
 * @param {string|null|undefined} folderPath
 * @param {string} searchParamsHash
 * @param {string|null|undefined} priority
 * @param {boolean} archiveMode
 */
export function caseListWindowQueryKey(
  repoSlug,
  folderPath,
  searchParamsHash,
  priority,
  archiveMode,
) {
  return [
    repoSlug ?? "",
    folderPath ?? "",
    searchParamsHash ?? "",
    priority ?? "",
    archiveMode ? "1" : "0",
  ].join("\0");
}

/**
 * @param {Array<{ key: string, value: string }>} chips
 * @returns {string}
 */
export function hashSearchChips(chips) {
  if (!Array.isArray(chips) || chips.length === 0) return "";
  return chips
    .map((c) => {
      if (c.key === "param" && c.paramKey) {
        return `param:${c.paramKey}:${c.value ?? ""}`;
      }
      return `${c.key}:${c.value ?? ""}`;
    })
    .sort()
    .join("|");
}

/**
 * Append fetched rows without duplicate file_path (preserves order).
 * @param {Array<object>} existing
 * @param {Array<object>} incoming
 * @returns {Array<object>}
 */
export function mergeCaseWindowItems(existing, incoming) {
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
export function removeCaseWindowPaths(items, pathsToRemove) {
  const paths = new Set((pathsToRemove ?? []).filter(Boolean));
  if (!paths.size) return items ?? [];
  return (items ?? []).filter((r) => !paths.has(r.file_path));
}

/**
 * Remove paths from every entry in a case list window cache map.
 * @param {Map<string, { items: Array<object>, total: number }>} cacheMap
 * @param {string[]} pathsToRemove
 */
export function patchAllWindowCachesRemove(cacheMap, pathsToRemove) {
  const paths = (pathsToRemove ?? []).filter(Boolean);
  if (!paths.length || !cacheMap) return;

  for (const [key, cached] of cacheMap.entries()) {
    const prevItems = cached?.items ?? [];
    const nextItems = removeCaseWindowPaths(prevItems, paths);
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
 * @param {Array<object>} items
 * @param {object} row
 * @returns {Array<object>}
 */
export function upsertCaseWindowRow(items, row) {
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
 * Upsert pending optimistic rows into a fetched case window list.
 * @param {Array<object>} items
 * @param {Array<object>} pendingRows
 * @returns {{ items: Array<object>, addedCount: number }}
 */
export function mergePendingCaseWindowRows(items, pendingRows) {
  let next = items ?? [];
  let addedCount = 0;
  const existing = new Set(next.map((r) => r?.file_path).filter(Boolean));
  for (const row of pendingRows ?? []) {
    if (!row?.file_path) continue;
    const had = existing.has(row.file_path);
    next = upsertCaseWindowRow(next, row);
    if (!had) {
      existing.add(row.file_path);
      addedCount += 1;
    }
  }
  return { items: next, addedCount };
}

/**
 * @param {Array<object>} items
 * @param {string} filePath
 * @param {object} partial
 * @returns {Array<object>}
 */
export function patchCaseWindowRow(items, filePath, partial) {
  if (!filePath) return items ?? [];
  return (items ?? []).map((row) =>
    row.file_path === filePath ? { ...row, ...partial } : row,
  );
}
