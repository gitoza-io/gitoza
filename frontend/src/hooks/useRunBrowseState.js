import { useCallback, useEffect, useRef, useState } from "react";
import { findFolderNode, getParentDirectoryPath } from "../utils/caseTree";
import { parseRunTreePath, prefixRunDirectoryPath, runTreePathForRunId } from "../utils/runCaseTree";

export const TEST_RUN_LAST_FOLDER_KEY = "testRun.lastFolder";
export const REVIEW_LAST_FOLDER_KEY = "review.lastFolder";

/**
 * Browse folder state within a selected test run (project/suite tree).
 * Folder selection is decoupled from the open case in the detail panel.
 */
export function useRunBrowseState({
  tree = [],
  selectedRunId = null,
  selectedCaseFilePath = null,
  searchOpen = false,
  enabled = true,
  lastFolderStorageKey = TEST_RUN_LAST_FOLDER_KEY,
}) {
  const [selectedFolderPath, setSelectedFolderPath] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const didInitialFolderRef = useRef(false);

  useEffect(() => {
    setSelectedFolderPath((prev) => {
      if (!prev || !selectedRunId) return prev;
      const folderRunId = parseRunTreePath(prev)?.runId;
      if (folderRunId && folderRunId !== selectedRunId) {
        didInitialFolderRef.current = false;
        return null;
      }
      if (folderRunId === selectedRunId) {
        didInitialFolderRef.current = true;
      }
      return prev;
    });
  }, [selectedRunId]);

  const handleSelectBrowseFolder = useCallback(
    (path) => {
      if (!path) return;
      setSelectedFolderPath(path);
      try {
        localStorage.setItem(lastFolderStorageKey, path);
      } catch (_) {}
    },
    [lastFolderStorageKey],
  );

  useEffect(() => {
    if (!enabled || !selectedRunId || searchOpen) return;
    if (didInitialFolderRef.current) return;
    if (!tree?.length) {
      setSelectedFolderPath(null);
      didInitialFolderRef.current = true;
      return;
    }

    if (selectedFolderPath) {
      const folderRunId = parseRunTreePath(selectedFolderPath)?.runId;
      if (
        folderRunId === selectedRunId &&
        findFolderNode(tree, selectedFolderPath)
      ) {
        didInitialFolderRef.current = true;
        return;
      }
    }

    let initialPath = null;
    if (selectedCaseFilePath && selectedRunId) {
      const parent = getParentDirectoryPath(selectedCaseFilePath);
      if (parent) initialPath = prefixRunDirectoryPath(selectedRunId, parent);
    } else if (selectedRunId) {
      initialPath = runTreePathForRunId(selectedRunId);
      if (!findFolderNode(tree, initialPath)) initialPath = null;
    }
    if (!initialPath) {
      try {
        const last = localStorage.getItem(lastFolderStorageKey);
        if (last && findFolderNode(tree, last)) initialPath = last;
      } catch (_) {}
    }
    if (!initialPath) {
      initialPath = tree[0]?.directory_path ?? null;
    }
    if (initialPath) {
      handleSelectBrowseFolder(initialPath);
    }
    didInitialFolderRef.current = true;
  }, [
    enabled,
    selectedRunId,
    selectedFolderPath,
    tree,
    searchOpen,
    selectedCaseFilePath,
    handleSelectBrowseFolder,
    lastFolderStorageKey,
  ]);

  return {
    selectedFolderPath,
    expanded,
    setExpanded,
    handleSelectBrowseFolder,
  };
}
