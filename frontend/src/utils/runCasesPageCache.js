/**
 * Pure helpers for run case page cache keys (used by useLazyRunBrowse and tests).
 */

export function pageCacheKey(runId, folderPrefix, page) {
  return `${runId}\0${folderPrefix ?? ""}\0${page}`;
}

export function browseFolderKey(runId, folderPath, page) {
  return `${runId ?? ""}\0${folderPath ?? ""}\0${page}`;
}

/**
 * Keep only rows whose file_path exists in cachedCases (run detail membership).
 * When cachedCases is undefined, pass through unchanged.
 */
export function filterCasesByMembership(cases, cachedCases) {
  const items = cases ?? [];
  if (cachedCases == null) return items;
  const paths = new Set(
    (cachedCases ?? []).map((c) => c?.file_path).filter(Boolean),
  );
  return items.filter((c) => c?.file_path && paths.has(c.file_path));
}

/**
 * Remove rows from all page-cache entries for a run and decrement per-page totals.
 */
export function patchPageCacheRemovePaths(pageCacheByKey, runId, pathsToRemove) {
  const pathsSet = new Set(
    (Array.isArray(pathsToRemove) ? pathsToRemove : []).filter(Boolean),
  );
  if (!runId || pathsSet.size === 0) return pageCacheByKey;

  const prefix = `${runId}\0`;
  const next = { ...pageCacheByKey };
  for (const [key, payload] of Object.entries(next)) {
    if (!key.startsWith(prefix)) continue;
    const items = payload?.items ?? [];
    const filtered = items.filter((c) => !pathsSet.has(c.file_path));
    const removed = items.length - filtered.length;
    if (removed > 0) {
      next[key] = {
        ...payload,
        items: filtered,
        total: Math.max(0, (payload.total ?? 0) - removed),
      };
    }
  }
  return next;
}

/**
 * Filter stale snapshot rows by current run membership and adjust total.
 */
export function applyMembershipToStale(staleSnapshot, cachedCases) {
  const cases = staleSnapshot?.cases ?? [];
  const total = staleSnapshot?.total ?? 0;
  if (cachedCases == null) {
    return { cases, total };
  }
  const filtered = filterCasesByMembership(cases, cachedCases);
  const removed = cases.length - filtered.length;
  return {
    cases: filtered,
    total: Math.max(0, total - removed),
  };
}

/**
 * Stale-while-revalidate display for run browse case list.
 */
export function resolveBrowseListDisplay({
  displayCases = [],
  displayTotal = 0,
  currentPageLoading = false,
  searchActive = false,
  staleSnapshot = { cases: [], total: 0 },
  cachedCases,
}) {
  const effectiveStale = applyMembershipToStale(staleSnapshot, cachedCases);

  const showStale =
    !searchActive &&
    currentPageLoading &&
    displayCases.length === 0 &&
    effectiveStale.cases.length > 0;

  const casesForList = showStale ? effectiveStale.cases : displayCases;
  const totalForList = showStale ? effectiveStale.total : displayTotal;
  const listRefreshing = currentPageLoading && casesForList.length > 0;

  const listLoading =
    currentPageLoading && !showStale && displayCases.length === 0;

  return {
    casesForList,
    totalForList,
    listRefreshing,
    listLoading,
    showStale,
  };
}
