import { useCallback, useEffect, useMemo, useState } from "react";
import { prunePinnedProjects } from "../utils/folderTreePins";

/**
 * @param {string | null | undefined} repoSlug
 * @param {string} [namespace]
 */
function storageKey(repoSlug, namespace = "folderTree") {
  return `${namespace}.pinnedProjects.${repoSlug || "default"}`;
}

function readPinned(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((p) => typeof p === "string");
    }
  } catch (_) {}
  return [];
}

function writePinned(key, paths) {
  try {
    localStorage.setItem(key, JSON.stringify(paths));
  } catch (_) {}
}

const PINNED_PROJECTS_CHANGED = "folderTree:pinnedProjectsChanged";

/**
 * Remap a pinned project path after optimistic folder rename (localStorage only).
 *
 * @param {string | null | undefined} repoSlug
 * @param {string} oldPath
 * @param {string} newPath
 * @param {{ namespace?: string }} [options]
 */
export function remapPinnedProjectInStorage(repoSlug, oldPath, newPath, options = {}) {
  const namespace = options.namespace ?? "folderTree";
  const oldNorm = (oldPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const newNorm = (newPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!oldNorm || !newNorm || oldNorm === newNorm) return;

  const key = storageKey(repoSlug, namespace);
  const paths = readPinned(key);
  if (!paths.includes(oldNorm)) return;

  const next = paths.map((p) => (p === oldNorm ? newNorm : p));
  writePinned(key, next);
  try {
    window.dispatchEvent(
      new CustomEvent(PINNED_PROJECTS_CHANGED, { detail: { key } }),
    );
  } catch (_) {}
}

/**
 * Per-repo persisted project pins for column 1 browse trees.
 *
 * @param {string | null | undefined} repoSlug
 * @param {array} [tree] - When provided, stale pins are pruned on change
 * @param {{ namespace?: string }} [options] - Storage namespace (default `folderTree`)
 */
export function usePinnedProjects(repoSlug, tree = null, options = {}) {
  const namespace = options.namespace ?? "folderTree";
  const key = storageKey(repoSlug, namespace);

  const [pinnedPaths, setPinnedPaths] = useState(() => readPinned(key));

  useEffect(() => {
    setPinnedPaths(readPinned(key));
  }, [key]);

  useEffect(() => {
    const onPinnedChanged = (e) => {
      if (e?.detail?.key === key) setPinnedPaths(readPinned(key));
    };
    window.addEventListener(PINNED_PROJECTS_CHANGED, onPinnedChanged);
    return () => window.removeEventListener(PINNED_PROJECTS_CHANGED, onPinnedChanged);
  }, [key]);

  useEffect(() => {
    if (!tree?.length) return;
    setPinnedPaths((prev) => {
      if (!prev.length) return prev;
      const pruned = prunePinnedProjects(prev, tree);
      if (pruned.length === prev.length) return prev;
      writePinned(key, pruned);
      return pruned;
    });
  }, [tree, key]);

  const pinnedProjectPaths = useMemo(() => new Set(pinnedPaths), [pinnedPaths]);

  const isPinned = useCallback(
    (directoryPath) => Boolean(directoryPath && pinnedProjectPaths.has(directoryPath)),
    [pinnedProjectPaths],
  );

  const togglePin = useCallback(
    (directoryPath) => {
      if (!directoryPath) return;
      setPinnedPaths((prev) => {
        const next = prev.includes(directoryPath)
          ? prev.filter((p) => p !== directoryPath)
          : [...prev, directoryPath];
        writePinned(key, next);
        return next;
      });
    },
    [key],
  );

  return { pinnedProjectPaths, pinnedPaths, isPinned, togglePin };
}
