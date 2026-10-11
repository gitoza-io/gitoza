import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REPOSITORY_CASE_WINDOW_SIZE } from "../constants/repositoryCaseList";
import { chipsToCaseQueryParams, fetchCaseWindow } from "../utils/caseQuery";
import {
  caseListWindowQueryKey,
  hashSearchChips,
  mergeCaseWindowItems,
  mergePendingCaseWindowRows,
  patchAllWindowCachesRemove,
  patchCaseWindowRow,
  sortCaseRowsByCaseId,
  upsertCaseWindowRow,
} from "../utils/repositoryCaseWindowCache";

/**
 * Server-side case list window for Test Repository column 2 (flat, infinite scroll).
 * Uses per-queryKey cache and stale-while-revalidate (same UX as Run browse list).
 *
 * @param {{
 *   repoSlug: string|null,
 *   folderPath?: string|null,
 *   searchChips?: Array<{ key: string, value: string }>,
 *   priorityFilter?: string|null,
 *   archiveMode?: boolean,
 *   enabled?: boolean,
 *   windowSize?: number,
 * }} options
 */
export function useCaseListWindow({
  repoSlug,
  folderPath = null,
  searchChips = [],
  priorityFilter = null,
  archiveMode = false,
  enabled = true,
  windowSize = REPOSITORY_CASE_WINDOW_SIZE,
} = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const totalRef = useRef(total);
  totalRef.current = total;
  const generationRef = useRef(0);
  const windowCacheRef = useRef(new Map());
  const pendingOptimisticByKeyRef = useRef(new Map());

  const searchParamsHash = useMemo(() => hashSearchChips(searchChips), [searchChips]);
  const queryKey = useMemo(
    () =>
      caseListWindowQueryKey(
        repoSlug,
        folderPath,
        searchParamsHash,
        priorityFilter,
        archiveMode,
      ),
    [repoSlug, folderPath, searchParamsHash, priorityFilter, archiveMode],
  );
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const optionsRef = useRef({
    repoSlug,
    folderPath,
    searchChips,
    priorityFilter,
    archiveMode,
    enabled,
    windowSize,
  });
  optionsRef.current = {
    repoSlug,
    folderPath,
    searchChips,
    priorityFilter,
    archiveMode,
    enabled,
    windowSize,
  };

  const writeCache = useCallback((key, nextItems, nextTotal) => {
    windowCacheRef.current.set(key, {
      items: nextItems,
      total: nextTotal,
    });
  }, []);

  const consumePendingOptimisticRows = useCallback((key, items, total) => {
    const pending = pendingOptimisticByKeyRef.current.get(key);
    if (!pending?.length) {
      return { items, total };
    }
    pendingOptimisticByKeyRef.current.delete(key);
    const { items: merged, addedCount } = mergePendingCaseWindowRows(items, pending);
    return { items: merged, total: total + addedCount };
  }, []);

  const accumulatePendingOptimisticRows = useCallback((key, { add = [], update = [] } = {}) => {
    let pending = pendingOptimisticByKeyRef.current.get(key) ?? [];
    for (const row of add) {
      pending = upsertCaseWindowRow(pending, row);
    }
    for (const { filePath, partial } of update) {
      if (filePath) pending = patchCaseWindowRow(pending, filePath, partial);
    }
    if (pending.length) {
      pendingOptimisticByKeyRef.current.set(key, pending);
    } else {
      pendingOptimisticByKeyRef.current.delete(key);
    }
  }, []);

  const buildRequestParams = useCallback(() => {
    const {
      folderPath: fp,
      searchChips: chips,
      priorityFilter: priority,
      archiveMode: archived,
    } = optionsRef.current;
    const params = {
      ...chipsToCaseQueryParams(chips),
    };
    if (fp) {
      params.path_prefix = fp;
    }
    if (priority && priority !== "all") {
      params.priority = priority;
    }
    if (archived) {
      params.status = "archived";
    }
    return params;
  }, []);

  const canFetchNow = () => {
    const { enabled: isEnabled, repoSlug: slug, folderPath: fp, searchChips: chips } =
      optionsRef.current;
    return Boolean(isEnabled && slug && (fp || chips.length > 0));
  };

  const fetchChunk = useCallback(
    async (offset, { append = false } = {}) => {
      if (!canFetchNow()) {
        return { items: [], total: 0 };
      }

      const generation = generationRef.current;
      const { repoSlug: slug, windowSize: size } = optionsRef.current;
      const params = buildRequestParams();
      const result = await fetchCaseWindow(slug, params, {
        limit: size,
        offset,
      });

      if (generation !== generationRef.current) {
        return result;
      }

      let nextItems;
      let nextTotal;
      if (append) {
        nextItems = mergeCaseWindowItems(itemsRef.current, result.items);
        nextTotal = result.total;
      } else {
        const merged = consumePendingOptimisticRows(
          queryKeyRef.current,
          result.items,
          result.total,
        );
        nextItems = merged.items;
        nextTotal = merged.total;
      }

      setTotal(nextTotal);
      setItems(nextItems);
      writeCache(queryKeyRef.current, nextItems, nextTotal);
      setError(null);
      return { ...result, items: nextItems, total: nextTotal };
    },
    [buildRequestParams, writeCache, consumePendingOptimisticRows],
  );

  const resetAndLoad = useCallback(async () => {
    generationRef.current += 1;
    const generation = generationRef.current;
    const key = queryKeyRef.current;

    if (!canFetchNow()) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setError(null);
      return;
    }

    const cached = windowCacheRef.current.get(key);
    if (cached) {
      setItems(cached.items);
      setTotal(cached.total);
      setLoading(false);
      setRefreshing(true);
      setLoadingMore(false);
      setError(null);

      try {
        await fetchChunk(0, { append: false });
      } catch (err) {
        if (generation === generationRef.current) {
          setError(err?.message || "Failed to load cases");
        }
      } finally {
        if (generation === generationRef.current) {
          setRefreshing(false);
        }
      }
      return;
    }

    const hasStale = itemsRef.current.length > 0;
    if (hasStale) {
      setRefreshing(true);
      setLoading(false);
    } else {
      setItems([]);
      setTotal(0);
      setLoading(true);
      setRefreshing(false);
    }
    setLoadingMore(false);
    setError(null);

    try {
      await fetchChunk(0, { append: false });
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err?.message || "Failed to load cases");
        if (!hasStale) {
          setItems([]);
          setTotal(0);
        }
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [fetchChunk]);

  const loadMore = useCallback(async () => {
    if (!canFetchNow() || loading || loadingMore || refreshing) return;
    if (itemsRef.current.length >= totalRef.current && totalRef.current > 0) return;

    const generation = generationRef.current;
    setLoadingMore(true);

    try {
      await fetchChunk(itemsRef.current.length, { append: true });
    } catch (err) {
      if (generation === generationRef.current) {
        setError(err?.message || "Failed to load more cases");
      }
    } finally {
      if (generation === generationRef.current) {
        setLoadingMore(false);
      }
    }
  }, [loading, loadingMore, refreshing, fetchChunk]);

  const invalidate = useCallback(() => {
    pendingOptimisticByKeyRef.current.delete(queryKeyRef.current);
    windowCacheRef.current.delete(queryKeyRef.current);
    void resetAndLoad();
  }, [resetAndLoad]);

  const invalidateAll = useCallback(() => {
    pendingOptimisticByKeyRef.current.clear();
    windowCacheRef.current.clear();
    void resetAndLoad();
  }, [resetAndLoad]);

  const refetch = invalidate;

  const applyPatchToWindowCache = useCallback(
    (
      key,
      { add = [], remove = [], update = [] } = {},
      { isActiveKey = false, writeCache: shouldWriteCache = true } = {},
    ) => {
      const pathsToRemove = (remove ?? []).filter(Boolean);
      const cached = windowCacheRef.current.get(key);
      let nextItems = cached?.items ?? (isActiveKey ? itemsRef.current : []);
      let nextTotal = cached?.total ?? (isActiveKey ? totalRef.current : 0);

      for (const row of add) {
        nextItems = upsertCaseWindowRow(nextItems, row);
      }
      for (const { filePath, partial } of update) {
        if (filePath) nextItems = patchCaseWindowRow(nextItems, filePath, partial);
      }

      if (add.length) {
        const removedSet = new Set(pathsToRemove);
        nextTotal += add.filter((r) => r?.file_path && !removedSet.has(r.file_path)).length;
      }

      if (shouldWriteCache) {
        writeCache(key, nextItems, nextTotal);
      }

      if (isActiveKey) {
        setItems(nextItems);
        setTotal(nextTotal);
      }

      return { nextItems, nextTotal };
    },
    [writeCache],
  );

  const patchLocal = useCallback(
    ({ add = [], remove = [], update = [] } = {}) => {
      const pathsToRemove = (remove ?? []).filter(Boolean);
      if (pathsToRemove.length) {
        patchAllWindowCachesRemove(windowCacheRef.current, pathsToRemove);
      }

      applyPatchToWindowCache(
        queryKeyRef.current,
        { add, remove: [], update },
        { isActiveKey: true },
      );
    },
    [applyPatchToWindowCache],
  );

  const patchLocalForFolder = useCallback(
    (folderPath, { add = [], remove = [], update = [] } = {}) => {
      const pathsToRemove = (remove ?? []).filter(Boolean);
      if (pathsToRemove.length) {
        patchAllWindowCachesRemove(windowCacheRef.current, pathsToRemove);
      }

      const {
        repoSlug,
        searchChips,
        priorityFilter,
        archiveMode,
      } = optionsRef.current;
      const key = caseListWindowQueryKey(
        repoSlug,
        folderPath,
        hashSearchChips(searchChips),
        priorityFilter,
        archiveMode,
      );

      const hadCache = windowCacheRef.current.has(key);
      if (hadCache) {
        applyPatchToWindowCache(
          key,
          { add, remove: [], update },
          { isActiveKey: key === queryKeyRef.current },
        );
        return;
      }

      if (add.length || update.length) {
        accumulatePendingOptimisticRows(key, { add, update });
      }
    },
    [applyPatchToWindowCache, accumulatePendingOptimisticRows],
  );

  const sortLocal = useCallback(() => {
    const cached = windowCacheRef.current.get(queryKeyRef.current);
    const source = cached?.items ?? itemsRef.current;
    const nextItems = sortCaseRowsByCaseId(source);
    const nextTotal = cached?.total ?? totalRef.current;
    writeCache(queryKeyRef.current, nextItems, nextTotal);
    setItems(nextItems);
    setTotal(nextTotal);
  }, [writeCache]);

  const snapshotRows = useCallback((filePaths) => {
    const pathSet = new Set((filePaths || []).filter(Boolean));
    if (!pathSet.size) return [];

    const found = new Map();
    for (const row of itemsRef.current) {
      if (row?.file_path && pathSet.has(row.file_path)) {
        found.set(row.file_path, { ...row });
      }
    }

    for (const cached of windowCacheRef.current.values()) {
      for (const row of cached?.items ?? []) {
        if (row?.file_path && pathSet.has(row.file_path) && !found.has(row.file_path)) {
          found.set(row.file_path, { ...row });
        }
      }
    }

    return Array.from(pathSet)
      .map((filePath) => found.get(filePath))
      .filter(Boolean);
  }, []);

  useEffect(() => {
    void resetAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when queryKey changes only
  }, [queryKey]);

  const hasMore = canFetchNow() && items.length < total;

  return {
    items,
    total,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    queryKey,
    loadMore,
    invalidate,
    invalidateAll,
    refetch,
    patchLocal,
    patchLocalForFolder,
    sortLocal,
    snapshotRows,
  };
}

export default useCaseListWindow;
