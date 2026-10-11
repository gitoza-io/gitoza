import { useCallback, useEffect, useMemo, useState } from "react";
import { prunePinnedReleasePaths } from "../utils/releaseTree";

function storageKey(repoSlug) {
  return `releases.pinnedReleases.${repoSlug || "default"}`;
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

const PINNED_RELEASES_CHANGED = "releases:pinnedReleasesChanged";

/**
 * Per-repo persisted release and project pins for the Releases navigator.
 *
 * @param {string | null | undefined} repoSlug
 * @param {array} [releases] - When provided, stale release pins are pruned on change
 * @param {array} [projects] - When provided, stale project pins are pruned on change
 */
export function usePinnedReleases(repoSlug, releases = null, projects = null) {
  const key = storageKey(repoSlug);

  const [pinnedPaths, setPinnedPaths] = useState(() => readPinned(key));

  useEffect(() => {
    setPinnedPaths(readPinned(key));
  }, [key]);

  useEffect(() => {
    const onPinnedChanged = (e) => {
      if (e?.detail?.key === key) setPinnedPaths(readPinned(key));
    };
    window.addEventListener(PINNED_RELEASES_CHANGED, onPinnedChanged);
    return () => window.removeEventListener(PINNED_RELEASES_CHANGED, onPinnedChanged);
  }, [key]);

  useEffect(() => {
    if (!releases?.length && !projects?.length) return;
    setPinnedPaths((prev) => {
      if (!prev.length) return prev;
      const pruned = prunePinnedReleasePaths(prev, releases, projects);
      if (pruned.length === prev.length) return prev;
      writePinned(key, pruned);
      return pruned;
    });
  }, [releases, projects, key]);

  const pinnedPathSet = useMemo(() => new Set(pinnedPaths), [pinnedPaths]);

  const isPinned = useCallback(
    (directoryPath) => Boolean(directoryPath && pinnedPathSet.has(directoryPath)),
    [pinnedPathSet],
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

  return { pinnedPaths, pinnedPathSet, isPinned, togglePin };
}
