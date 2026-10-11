import { useCallback, useEffect, useRef, useState } from "react";
import { findFolderNode, getParentDirectoryPath } from "../utils/caseTree";

export const PICKER_LAST_FOLDER_STORAGE_KEY = "casePicker.lastFolder";

/**
 * Shared browse state for case picker pages (Add cases, Export cases).
 * Browse folder is independent of the open case in the detail panel.
 */
export function usePickerBrowseState({
  tree = [],
  selectedCaseFilePath = null,
  searchOpen = false,
  searchActive = false,
  onFolderExpand,
  enabled = true,
}) {
  const [selectedFolderPath, setSelectedFolderPath] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [caseListPage, setCaseListPage] = useState(1);
  const didInitialFolderRef = useRef(false);

  useEffect(() => {
    setCaseListPage(1);
  }, [selectedFolderPath, searchOpen, searchActive]);

  useEffect(() => {
    if (!enabled) didInitialFolderRef.current = false;
  }, [enabled]);

  const handleSelectBrowseFolder = useCallback(
    (path) => {
      if (!path) return;
      setSelectedFolderPath(path);
      try {
        localStorage.setItem(PICKER_LAST_FOLDER_STORAGE_KEY, path);
      } catch (_) {}
      onFolderExpand?.(path);
    },
    [onFolderExpand],
  );

  useEffect(() => {
    if (!enabled || didInitialFolderRef.current || searchOpen) return;
    if (selectedFolderPath) {
      didInitialFolderRef.current = true;
      return;
    }
    if (!tree?.length) return;

    let initialPath = null;
    if (selectedCaseFilePath) {
      initialPath = getParentDirectoryPath(selectedCaseFilePath);
    } else {
      try {
        const last = localStorage.getItem(PICKER_LAST_FOLDER_STORAGE_KEY);
        if (last && findFolderNode(tree, last)) initialPath = last;
      } catch (_) {}
      if (!initialPath) {
        initialPath = tree[0]?.directory_path ?? null;
      }
    }
    if (initialPath) {
      handleSelectBrowseFolder(initialPath);
    }
    didInitialFolderRef.current = true;
  }, [
    enabled,
    tree,
    searchOpen,
    selectedCaseFilePath,
    selectedFolderPath,
    handleSelectBrowseFolder,
  ]);

  return {
    selectedFolderPath,
    expanded,
    setExpanded,
    caseListPage,
    setCaseListPage,
    handleSelectBrowseFolder,
  };
}
