import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectExpandKeysForTicket,
  findReleaseTreeNode,
  parseReleaseTreePath,
  releaseTreePathForReleaseId,
} from "../utils/releaseTree";

export const RELEASES_LAST_PATH_KEY = "releases.lastPath";

/**
 * Browse state for Releases navigator (release / project selection + expand).
 */
export function useReleaseBrowseState({
  tree = [],
  selectedTicketPath = null,
  searchOpen = false,
  enabled = true,
  lastPathStorageKey = RELEASES_LAST_PATH_KEY,
}) {
  const [selectedPath, setSelectedPath] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const didInitialPathRef = useRef(false);

  const selectedReleaseId = parseReleaseTreePath(selectedPath)?.releaseId ?? null;

  const handleSelectPath = useCallback(
    (path) => {
      if (!path) return;
      setSelectedPath(path);
      try {
        localStorage.setItem(lastPathStorageKey, path);
      } catch (_) {}
    },
    [lastPathStorageKey],
  );

  const handleToggleExpand = useCallback((pathKey, options = {}) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (options?.expandOnly) {
        next.add(pathKey);
        return next;
      }
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled || searchOpen) return;
    if (selectedTicketPath && tree.length) {
      const keys = collectExpandKeysForTicket(tree, selectedTicketPath);
      if (keys.size) {
        setExpanded((prev) => new Set([...prev, ...keys]));
      }
    }
  }, [enabled, searchOpen, selectedTicketPath, tree]);

  useEffect(() => {
    if (!enabled || searchOpen) return;
    if (didInitialPathRef.current) return;
    if (!tree?.length) {
      setSelectedPath(null);
      didInitialPathRef.current = true;
      return;
    }

    if (selectedPath && findReleaseTreeNode(tree, selectedPath)) {
      didInitialPathRef.current = true;
      return;
    }

    let initialPath = null;
    try {
      const last = localStorage.getItem(lastPathStorageKey);
      if (last && findReleaseTreeNode(tree, last)) initialPath = last;
    } catch (_) {}

    if (!initialPath) {
      initialPath = tree[0]?.directory_path ?? null;
    }
    if (initialPath) {
      handleSelectPath(initialPath);
    }
    didInitialPathRef.current = true;
  }, [enabled, tree, searchOpen, selectedPath, handleSelectPath, lastPathStorageKey]);

  const resetBrowseState = useCallback(() => {
    didInitialPathRef.current = false;
    setSelectedPath(null);
    setExpanded(new Set());
  }, []);

  return {
    selectedPath,
    selectedReleaseId,
    expanded,
    setExpanded,
    handleSelectPath,
    handleToggleExpand,
    resetBrowseState,
  };
}
