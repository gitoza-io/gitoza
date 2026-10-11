import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildCaseTree,
  collectFolderExpandKeys,
  getCasesForFolderSelection,
  pruneEmptyNodes,
} from "../utils/caseTree";

/**
 * Search-mode folder tree: pruned project/suite tree from matching rows,
 * local folder selection (decoupled from browse), and folder-scoped case lists.
 */
export function useSearchFolderTree({
  apiTree = [],
  rows = [],
  searchActive = false,
  searchResetKey = "",
}) {
  const [searchFolderPath, setSearchFolderPath] = useState(null);
  const [searchExpanded, setSearchExpanded] = useState(() => new Set());

  const searchTree = useMemo(() => {
    if (!searchActive || !rows.length) return [];
    return pruneEmptyNodes(buildCaseTree(apiTree, rows));
  }, [apiTree, rows, searchActive]);

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
    if (!searchActive || !searchFolderPath || !rows.length) return null;
    return getCasesForFolderSelection(rows, searchTree, searchFolderPath);
  }, [searchActive, searchFolderPath, rows, searchTree]);

  const handleSelectSearchFolder = useCallback((path) => {
    if (!path) return;
    setSearchFolderPath(path);
  }, []);

  return {
    searchTree,
    searchFolderPath,
    searchExpanded,
    setSearchExpanded,
    setSearchFolderPath,
    folderScopedCases,
    handleSelectSearchFolder,
    searchExpandKeys,
  };
}
