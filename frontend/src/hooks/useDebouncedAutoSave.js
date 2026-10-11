import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SAVE_CHAIN = 12;

/**
 * Debounced auto-save hook.
 *
 * Watches `draft`, compares against `persisted` via `normalize`,
 * and calls `save(draft)` after `delayMs` of inactivity when there is
 * a meaningful diff.
 *
 * Saves for a single hook instance are **serialized** on a promise chain so
 * concurrent flush/timer/key-change saves cannot reorder responses against
 * the latest draft.
 *
 * Flush is driven by key change (leave current YAML entity), by `enabled`
 * turning false while dirty, and by unmount (dirty snapshots). When `key`
 * changes (e.g. run_id or file_path), we flush the previous key's draft from
 * its snapshot (dirty check).
 *
 * @returns {{ saving: boolean, flush: () => Promise<void> }}
 */
export function useDebouncedAutoSave({
  enabled = false,
  key = undefined,
  draft,
  persisted,
  normalize = (x) => x,
  save,
  delayMs = 800,
  silent = false,
}) {
  const [saving, setSaving] = useState(false);
  const timerRef = useRef(null);
  const prevKeyRef = useRef(key);
  const prevEnabledRef = useRef(enabled);

  const keySnapshotsRef = useRef(new Map());
  if (enabled) {
    keySnapshotsRef.current.set(key, { draft, persisted, save, normalize });
  }

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  const saveRef = useRef(save);
  saveRef.current = save;
  const normalizeRef = useRef(normalize);
  normalizeRef.current = normalize;
  const silentRef = useRef(silent);
  silentRef.current = silent;

  const saveTailRef = useRef(Promise.resolve());

  const draftSerialized = JSON.stringify(draft);

  const enqueueSnapshotSave = useCallback((snapshot) => {
    if (!snapshot) return;
    const a = JSON.stringify(snapshot.normalize(snapshot.draft));
    const b = JSON.stringify(snapshot.normalize(snapshot.persisted));
    if (a === b) return;
    saveTailRef.current = saveTailRef.current.then(() =>
      snapshot.save(snapshot.draft).catch((e) =>
        console.warn("useDebouncedAutoSave: snapshot save failed", e),
      ),
    );
  }, []);

  const runSaveChain = useCallback(() => {
    saveTailRef.current = saveTailRef.current.then(async () => {
      let iterations = 0;
      while (iterations < MAX_SAVE_CHAIN) {
        iterations += 1;
        const norm = normalizeRef.current;
        const a = JSON.stringify(norm(draftRef.current));
        const b = JSON.stringify(norm(persistedRef.current));
        if (a === b) return;
        if (!silentRef.current) setSaving(true);
        try {
          await saveRef.current(draftRef.current);
        } catch (e) {
          console.warn("useDebouncedAutoSave: save failed", e);
          return;
        } finally {
          if (!silentRef.current) setSaving(false);
        }
      }
      console.warn("useDebouncedAutoSave: max save chain iterations reached");
    });
    return saveTailRef.current;
  }, []);

  /** Immediately persist the current draft if it differs from persisted. */
  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const norm = normalizeRef.current;
    const a = JSON.stringify(norm(draftRef.current));
    const b = JSON.stringify(norm(persistedRef.current));
    if (a !== b) {
      return runSaveChain().catch((e) => {
        console.warn("useDebouncedAutoSave: flush failed", e);
      });
    }
    return Promise.resolve();
  }, [runSaveChain]);

  // Flush any dirty snapshots when the editor unmounts (e.g. Releases detail
  // swaps TicketEditorPanel for ReleaseSummaryPanel without a key change).
  useEffect(() => {
    const snapshots = keySnapshotsRef.current;
    return () => {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      for (const snapshot of snapshots.values()) {
        const a = JSON.stringify(snapshot.normalize(snapshot.draft));
        const b = JSON.stringify(snapshot.normalize(snapshot.persisted));
        if (a !== b) {
          void Promise.resolve()
            .then(() => snapshot.save(snapshot.draft))
            .catch((e) => console.warn("useDebouncedAutoSave: flush on unmount failed", e));
        }
      }
      snapshots.clear();
    };
  }, []);

  // --- Main debounce effect: `enabled` in deps clears timer when autosave is disabled (same key). ---
  useEffect(() => {
    // Key change: flush previous key from snapshot (dirty check).
    if (key !== prevKeyRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const oldKey = prevKeyRef.current;
      const oldSnapshot = keySnapshotsRef.current.get(oldKey);
      prevKeyRef.current = key;
      enqueueSnapshotSave(oldSnapshot);
      keySnapshotsRef.current.delete(oldKey);
    }

    // enabled true→false on the same key: debounce would be cleared with no save.
    if (prevEnabledRef.current && !enabled) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      enqueueSnapshotSave(keySnapshotsRef.current.get(key));
    }
    prevEnabledRef.current = enabled;

    if (!enabled) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runSaveChain().catch((e) => console.warn("useDebouncedAutoSave: debounced save failed", e));
    }, delayMs);

    return () => {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [key, draftSerialized, delayMs, enabled, runSaveChain, enqueueSnapshotSave]);

  return { saving, flush };
}
