/**
 * Registry so App can invalidate Releases navigator caches after reindex/refresh
 * without importing ReleasesPage.
 */

const resetters = new Set();

/**
 * @param {() => void} resetFn
 * @returns {() => void} unregister
 */
export function registerReleasesCacheReset(resetFn) {
  if (typeof resetFn !== "function") return () => {};
  resetters.add(resetFn);
  return () => {
    resetters.delete(resetFn);
  };
}

/** Clear all registered Releases lazy caches (in-memory only). */
export function resetAllReleasesCaches() {
  for (const fn of [...resetters]) {
    try {
      fn();
    } catch (e) {
      console.warn("releasesCacheRegistry: reset failed", e);
    }
  }
}
