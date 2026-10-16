/**
 * Central registry for debounced auto-save flush callbacks (case editor, run summary, run results).
 * Before Sync / capture-pending-changes and before IDE Refresh / full reindex, App calls
 * flushAllAutoSavesBeforeSync() (or flushAllAutoSavesBeforeIndex) so the working tree and DB
 * match in-memory drafts (see useDebouncedAutoSave — also flushes dirty snapshots on unmount).
 *
 * Pending run shards (results.md) are flushed inside index hooks and capture_pending_changes on the backend.
 */

const flushers = new Set();

/**
 * Register a flush function; returns unregister cleanup.
 * @param {() => void | Promise<void>} flushFn
 * @returns {() => void}
 */
export function registerAutoSaveFlush(flushFn) {
  if (typeof flushFn !== "function") return () => {};
  flushers.add(flushFn);
  return () => {
    flushers.delete(flushFn);
  };
}

/**
 * Run all registered flushes in parallel. Failures are logged; sync still proceeds.
 * @returns {Promise<void>}
 */
export async function flushAllAutoSavesBeforeSync() {
  const fns = [...flushers];
  await Promise.all(
    fns.map((fn) =>
      Promise.resolve()
        .then(() => fn())
        .catch((e) => {
          console.warn("autoSaveFlushRegistry: flush failed", e);
        }),
    ),
  );
}

/** Flush debounced drafts before IDE Refresh / reindex (same registry as Sync). */
export async function flushAllAutoSavesBeforeIndex() {
  await flushAllAutoSavesBeforeSync();
}
