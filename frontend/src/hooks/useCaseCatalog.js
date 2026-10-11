import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isArchivedCasePath } from "../constants/casePaths";
import { findCaseRowInCatalog } from "../utils/caseCatalogMove";
import { fetchAllCases, runWithConcurrency } from "../utils/caseQuery";
import { resortCaseRowsForFolder } from "../utils/repositoryCaseWindowCache";
import { remapPathUnderPrefix } from "../utils/patchRepositoryTree";
import { useCaseSearchResults, EMPTY_SEARCH_CHIPS } from "./useCaseSearchResults";

/**
 * Lazy case catalog: browse cache by folder prefix, server-side search.
 *
 * @param {string|null} repoSlug
 * @param {{
 *   searchChips?: Array<{ key: string, value: string }>,
 *   archiveMode?: boolean,
 *   projectFilter?: string|null,
 * }} options
 */
export function useCaseCatalog(
  repoSlug,
  { searchChips = [], archiveMode = false, projectFilter = null } = {},
) {
  const [casesByPrefix, setCasesByPrefix] = useState(() => new Map());
  const [loadingPrefixes, setLoadingPrefixes] = useState(() => new Set());

  const casesByPrefixRef = useRef(casesByPrefix);
  casesByPrefixRef.current = casesByPrefix;
  const loadedPrefixesRef = useRef(new Set());
  const archiveModeRef = useRef(archiveMode);
  archiveModeRef.current = archiveMode;

  const isSearchMode = searchChips.length > 0 && !archiveMode;
  const {
    results: searchResults,
    loading: searchLoading,
    setResults: setSearchResults,
  } = useCaseSearchResults(repoSlug, isSearchMode ? searchChips : EMPTY_SEARCH_CHIPS);

  const searchResultsRef = useRef(searchResults);
  searchResultsRef.current = searchResults;

  const clearCache = useCallback(() => {
    loadedPrefixesRef.current = new Set();
    setCasesByPrefix(new Map());
    setSearchResults([]);
  }, [setSearchResults]);

  useEffect(() => {
    clearCache();
  }, [repoSlug, archiveMode, clearCache]);

  const loadCasesForPrefix = useCallback(
    async (directoryPath, { force = false } = {}) => {
      const prefix = (directoryPath || "").trim();
      if (!repoSlug || !prefix) return [];
      if (!force && loadedPrefixesRef.current.has(prefix)) {
        return casesByPrefixRef.current.get(prefix) ?? [];
      }

      setLoadingPrefixes((prev) => new Set(prev).add(prefix));
      try {
        const rows = await fetchAllCases(repoSlug, {
          path_prefix: prefix,
          ...(archiveModeRef.current ? { includeArchived: true } : {}),
        });
        loadedPrefixesRef.current.add(prefix);
        setCasesByPrefix((prev) => {
          const next = new Map(prev);
          next.set(prefix, rows);
          return next;
        });
        return rows;
      } catch {
        return [];
      } finally {
        setLoadingPrefixes((prev) => {
          const next = new Set(prev);
          next.delete(prefix);
          return next;
        });
      }
    },
    [repoSlug],
  );

  const reloadExpandedPrefixes = useCallback(
    async (prefixes) => {
      const list = (prefixes || []).filter(Boolean);
      if (!list.length) return;
      for (const prefix of list) {
        loadedPrefixesRef.current.delete(prefix);
      }
      await runWithConcurrency(list, 3, (prefix) =>
        loadCasesForPrefix(prefix, { force: true }),
      );
    },
    [loadCasesForPrefix],
  );

  const reloadAllLoadedPrefixes = useCallback(async () => {
    const prefixes = [...loadedPrefixesRef.current];
    await reloadExpandedPrefixes(prefixes);
  }, [reloadExpandedPrefixes]);

  const removeCasesByPathPrefix = useCallback(
    (prefix) => {
      const norm = `${(prefix || "").replace(/\\/g, "/").replace(/\/+$/, "")}/`;
      const matches = (filePath) => {
        const fp = (filePath || "").replace(/\\/g, "/");
        return fp.startsWith(norm);
      };
      setCasesByPrefix((prev) => {
        const next = new Map();
        for (const [key, rows] of prev.entries()) {
          next.set(
            key,
            rows.filter((r) => !matches(r.file_path)),
          );
        }
        return next;
      });
      setSearchResults((prev) => prev.filter((r) => !matches(r.file_path)));
    },
    [setSearchResults],
  );

  const addCasesToCache = useCallback(
    (newRows) => {
      const rows = (newRows || []).filter((r) => r?.file_path);
      if (!rows.length) return;

      const mergeRowInto = (existing, row) => {
        const list = existing ?? [];
        const idx = list.findIndex((r) => r.file_path === row.file_path);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = { ...next[idx], ...row };
          return next;
        }
        return [...list, row];
      };

      const rowMatchesPrefix = (filePath, prefix) => {
        const fp = (filePath || "").replace(/\\/g, "/");
        const norm = (prefix || "").replace(/\\/g, "/").replace(/\/+$/, "");
        if (!fp || !norm) return false;
        if (fp.startsWith(`${norm}/`)) return true;
        const lastSlash = fp.lastIndexOf("/");
        const parent = lastSlash >= 0 ? fp.slice(0, lastSlash) : "";
        return parent === norm;
      };

      setCasesByPrefix((prev) => {
        const next = new Map(prev);
        for (const row of rows) {
          const fp = row.file_path;
          let matched = false;
          for (const [prefix] of prev.entries()) {
            if (rowMatchesPrefix(fp, prefix)) {
              next.set(prefix, mergeRowInto(next.get(prefix), row));
              matched = true;
            }
          }
          if (!matched) {
            const lastSlash = fp.lastIndexOf("/");
            const parentDir = lastSlash >= 0 ? fp.slice(0, lastSlash) : "";
            if (parentDir) {
              next.set(parentDir, mergeRowInto(next.get(parentDir), row));
              loadedPrefixesRef.current.add(parentDir);
            }
          }
        }
        return next;
      });

      setSearchResults((prev) => {
        let out = prev;
        for (const row of rows) {
          out = mergeRowInto(out, row);
        }
        return out;
      });
    },
    [setSearchResults],
  );

  const snapshotCaseRows = useCallback((filePaths) => {
    const paths = (filePaths || []).filter(Boolean);
    return paths
      .map((p) =>
        findCaseRowInCatalog(casesByPrefixRef.current, searchResultsRef.current, p),
      )
      .filter(Boolean);
  }, []);

  const removeCasesFromCache = useCallback(
    (filePaths) => {
      const paths = new Set((filePaths || []).filter(Boolean));
      if (!paths.size) return;
      setCasesByPrefix((prev) => {
        const next = new Map();
        for (const [prefix, rows] of prev.entries()) {
          next.set(
            prefix,
            rows.filter((r) => !paths.has(r.file_path)),
          );
        }
        return next;
      });
      setSearchResults((prev) => prev.filter((r) => !paths.has(r.file_path)));
    },
    [setSearchResults],
  );

  const patchCaseInCache = useCallback(
    (filePath, partial) => {
      if (!filePath) return;
      const patch = (rows) =>
        rows.map((row) => (row.file_path === filePath ? { ...row, ...partial } : row));
      setCasesByPrefix((prev) => {
        const next = new Map();
        for (const [prefix, rows] of prev.entries()) {
          next.set(prefix, patch(rows));
        }
        return next;
      });
      setSearchResults((prev) => patch(prev));
    },
    [setSearchResults],
  );

  const moveCasesInCache = useCallback(
    (moves) => {
      const list = (moves || []).filter(
        (m) => m?.oldPath && m?.newPath && m.oldPath !== m.newPath,
      );
      if (!list.length) return [];

      const applied = [];
      const oldPaths = [];
      const newRows = [];

      for (const { oldPath, newPath } of list) {
        const row = findCaseRowInCatalog(
          casesByPrefixRef.current,
          searchResultsRef.current,
          oldPath,
        );
        const movedRow = row ? { ...row, file_path: newPath } : { file_path: newPath };
        applied.push({ oldPath, newPath, row });
        oldPaths.push(oldPath);
        newRows.push(movedRow);
      }

      removeCasesFromCache(oldPaths);
      addCasesToCache(newRows);
      return applied;
    },
    [removeCasesFromCache, addCasesToCache],
  );

  const renameCaseInCache = useCallback(
    (oldPath, newPath, newCaseId) => {
      if (!oldPath || !newPath || oldPath === newPath) return null;
      const row = findCaseRowInCatalog(
        casesByPrefixRef.current,
        searchResultsRef.current,
        oldPath,
      );
      const renamedRow = row
        ? { ...row, file_path: newPath, case_id: newCaseId }
        : { file_path: newPath, case_id: newCaseId };
      removeCasesFromCache([oldPath]);
      addCasesToCache([renamedRow]);
      return { oldPath, newPath, row: row ?? null };
    },
    [removeCasesFromCache, addCasesToCache],
  );

  const resortCasesInFolder = useCallback(
    (folderPath) => {
      const norm = (folderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
      if (!norm) return;
      setCasesByPrefix((prev) => {
        const next = new Map(prev);
        for (const [prefix, rows] of prev.entries()) {
          next.set(prefix, resortCaseRowsForFolder(rows, norm));
        }
        return next;
      });
      setSearchResults((prev) => resortCaseRowsForFolder(prev, norm));
    },
    [setSearchResults],
  );

  const renameCasesByPathPrefix = useCallback(
    (oldPath, newPath) => {
      const oldNorm = (oldPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
      const newNorm = (newPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
      if (!oldNorm || !newNorm || oldNorm === newNorm) return;

      const remapKey = (key) => {
        if (key === oldNorm) return newNorm;
        const prefix = `${oldNorm}/`;
        if (key.startsWith(prefix)) return newNorm + key.slice(oldNorm.length);
        return key;
      };

      const remapRows = (rows) =>
        (rows || []).map((row) => {
          const nextPath = remapPathUnderPrefix(row.file_path, oldNorm, newNorm);
          return nextPath === row.file_path ? row : { ...row, file_path: nextPath };
        });

      const nextLoaded = new Set();
      for (const key of loadedPrefixesRef.current) {
        nextLoaded.add(remapKey(key));
      }
      loadedPrefixesRef.current = nextLoaded;

      setCasesByPrefix((prev) => {
        const next = new Map();
        for (const [key, rows] of prev.entries()) {
          const remappedKey = remapKey(key);
          next.set(remappedKey, remapRows(rows));
        }
        return next;
      });
      setSearchResults((prev) => remapRows(prev));
    },
    [setSearchResults],
  );

  const loadAllProjectPrefixes = useCallback(
    async (projectDirectoryPaths) => {
      const list = (projectDirectoryPaths || []).filter(Boolean);
      await runWithConcurrency(list, 3, (prefix) => loadCasesForPrefix(prefix));
    },
    [loadCasesForPrefix],
  );

  useEffect(() => {
    if (!repoSlug || !projectFilter || isSearchMode || archiveMode) return;
    loadCasesForPrefix(projectFilter);
  }, [repoSlug, projectFilter, isSearchMode, loadCasesForPrefix, archiveMode]);

  const browseRows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const rows of casesByPrefix.values()) {
      for (const row of rows) {
        const key = row?.file_path;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
    }
    return out;
  }, [casesByPrefix]);

  const loadedPrefixes = useMemo(() => new Set(casesByPrefix.keys()), [casesByPrefix]);

  const visibleRows = useMemo(() => {
    if (isSearchMode) return searchResults;
    if (archiveMode) {
      return browseRows.filter((row) => isArchivedCasePath(row?.file_path));
    }
    return browseRows;
  }, [isSearchMode, searchResults, browseRows, archiveMode]);

  return {
    visibleRows,
    browseRows,
    searchResults,
    isSearchMode,
    loadingPrefixes,
    loadedPrefixes,
    searchLoading,
    loadCasesForPrefix,
    loadAllProjectPrefixes,
    reloadExpandedPrefixes,
    clearCache,
    reloadAllLoadedPrefixes,
    snapshotCaseRows,
    removeCasesFromCache,
    addCasesToCache,
    moveCasesInCache,
    renameCaseInCache,
    resortCasesInFolder,
    removeCasesByPathPrefix,
    renameCasesByPathPrefix,
    patchCaseInCache,
  };
}
