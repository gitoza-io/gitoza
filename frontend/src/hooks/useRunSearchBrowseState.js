import { useCallback, useEffect, useMemo, useState } from "react";
import { collectFolderExpandKeys } from "../utils/caseTree";
import { compareCasesByCaseId } from "../utils/exportHierarchy";
import {
  findRunFolderDisplayName,
  getRunCasesForFolderSelection,
  mapRunCaseToListItem,
  parseRunTreePath,
} from "../utils/runCaseTree";

/**
 * Search-mode run folder tree: pruned unified run tree from matching cases,
 * local folder selection, and folder-scoped case lists.
 */
export function useRunSearchBrowseState({
  searchTree = [],
  matchingCases = [],
  searchActive = false,
  searchResetKey = "",
}) {
  const [searchFolderPath, setSearchFolderPath] = useState(null);
  const [searchExpanded, setSearchExpanded] = useState(() => new Set());

  const searchExpandKeys = useMemo(
    () => collectFolderExpandKeys(searchTree),
    [searchTree],
  );

  useEffect(() => {
    setSearchFolderPath(null);
  }, [searchResetKey, searchActive]);

  useEffect(() => {
    if (searchTree.length > 0) {
      setSearchExpanded(searchExpandKeys);
    } else {
      setSearchExpanded(() => new Set());
    }
  }, [searchTree, searchExpandKeys]);

  const folderScopedCases = useMemo(() => {
    if (!searchActive || !matchingCases.length) return [];
    if (!searchFolderPath) {
      return [...matchingCases].map(mapRunCaseToListItem).sort(compareCasesByCaseId);
    }
    return getRunCasesForFolderSelection(matchingCases, searchTree, searchFolderPath);
  }, [searchActive, searchFolderPath, matchingCases, searchTree]);

  const selectedRunId = useMemo(() => {
    if (!searchFolderPath) return null;
    return parseRunTreePath(searchFolderPath)?.runId ?? null;
  }, [searchFolderPath]);

  const folderLabel = useMemo(
    () => findRunFolderDisplayName(searchTree, searchFolderPath),
    [searchTree, searchFolderPath],
  );

  const handleSelectSearchFolder = useCallback((path) => {
    if (!path) return;
    setSearchFolderPath(path);
  }, []);

  return {
    searchFolderPath,
    searchExpanded,
    setSearchExpanded,
    setSearchFolderPath,
    folderScopedCases,
    selectedRunId,
    folderLabel,
    handleSelectSearchFolder,
    searchExpandKeys,
  };
}
