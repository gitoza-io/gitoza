/**
 * Merge paginated page items with run detail cache for display.
 *
 * @param {Array} pageItems - from getActivePageData().items
 * @param {Array|null|undefined} cachedCases - runDetailsByRunId[runId]?.cases
 * @returns {{ items: Array, removedOnPage: number }}
 */
export function mergeRunPageCasesWithCache(pageItems, cachedCases) {
  const items = pageItems ?? [];
  const overlayByPath = new Map(
    (cachedCases ?? []).filter((c) => c?.file_path).map((c) => [c.file_path, c]),
  );

  // When cachedCases is defined (even []), treat cache as membership source (remove case).
  const filtered =
    cachedCases != null
      ? items.filter((c) => c?.file_path && overlayByPath.has(c.file_path))
      : items;

  const merged = filtered.map((c) => {
    const overlay = overlayByPath.get(c.file_path);
    if (!overlay) return c;
    return {
      ...c,
      result: overlay.result ?? c.result,
      executed_at: overlay.executed_at ?? c.executed_at,
      executed_by: overlay.executed_by ?? c.executed_by,
    };
  });

  return { items: merged, removedOnPage: items.length - filtered.length };
}
