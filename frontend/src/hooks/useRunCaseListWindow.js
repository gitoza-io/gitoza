import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REPOSITORY_CASE_WINDOW_SIZE } from "../constants/repositoryCaseList";
import { listRunCases } from "../services/api";
import { folderPrefixFromTreePath } from "../utils/runCaseTree";
import {
  clearRunWindowCachesForRun,
  mergeRunWindowItems,
  patchAllRunWindowCachesRemove,
  patchRunWindowRow,
  runCaseWindowQueryKey,
  sortRunWindowRowsByCaseId,
  upsertRunWindowRow,
} from "../utils/runCaseWindowCache";

/**
 * Server-side case list window for Test Run / Review column 2 (flat, infinite scroll).
 * Uses per-queryKey cache and stale-while-revalidate.
 *
 * @param {{
 *   runId: string|null,
 *   folderPath?: string|null,
 *   repoSlug: string|null,
 *   enabled?: boolean,
 *   windowSize?: number,
 *   onItemsFetched?: (runId: string, items: Array<object>) => void,
 * }} options
 */
export function useRunCaseListWindow({
  runId,
  folderPath = null,
  repoSlug,
  enabled = true,
  windowSize = REPOSITORY_CASE_WINDOW_SIZE,
  onItemsFetched,
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
  const onItemsFetchedRef = useRef(onItemsFetched);
  onItemsFetchedRef.current = onItemsFetched;

  const folderPrefix = useMemo(
    () => folderPrefixFromTreePath(folderPath),
    [folderPath],
  );

  const queryKey = useMemo(
    () => runCaseWindowQueryKey(runId, folderPrefix),
    [runId, folderPrefix],
  );
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const optionsRef = useRef({
    runId,
    folderPath,
    folderPrefix,
    repoSlug,
    enabled,
    windowSize,
  });
  optionsRef.current = {
    runId,
    folderPath,
    folderPrefix,
    repoSlug,
    enabled,
    windowSize,
  };

  const writeCache = useCallback((key, nextItems, nextTotal) => {
    windowCacheRef.current.set(key, {
      items: nextItems,
      total: nextTotal,
    });
  }, []);

  const canFetchNow = () => {
    const {
      enabled: isEnabled,
      runId: rid,
      folderPath: fp,
      repoSlug: slug,
    } = optionsRef.current;
    return Boolean(isEnabled && rid && slug && fp);
  };

  const fetchChunk = useCallback(
    async (offset, { append = false } = {}) => {
      if (!canFetchNow()) {
        return { items: [], total: 0 };
      }

      const generation = generationRef.current;
      const { runId: rid, folderPrefix: prefix, repoSlug: slug, windowSize: size } =
        optionsRef.current;

      const res = await listRunCases(rid, slug, {
        folder_prefix: prefix,
        limit: size,
        offset,
      });
      const result = {
        items: res?.items ?? [],
        total: res?.total ?? 0,
      };

      if (generation !== generationRef.current) {
        return result;
      }

      if (result.items.length > 0) {
        onItemsFetchedRef.current?.(rid, result.items);
      }

      setTotal(result.total);
      setItems((prev) => {
        const next = append ? mergeRunWindowItems(prev, result.items) : result.items;
        writeCache(queryKeyRef.current, next, result.total);
        return next;
      });
      setError(null);
      return result;
    },
    [writeCache],
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
    windowCacheRef.current.delete(queryKeyRef.current);
    void resetAndLoad();
  }, [resetAndLoad]);

  const invalidateForRun = useCallback(
    (targetRunId) => {
      if (!targetRunId) return;
      clearRunWindowCachesForRun(windowCacheRef.current, targetRunId);
      if (targetRunId === optionsRef.current.runId) {
        void resetAndLoad();
      }
    },
    [resetAndLoad],
  );

  const invalidateAll = useCallback(() => {
    windowCacheRef.current.clear();
    void resetAndLoad();
  }, [resetAndLoad]);

  const refetch = invalidate;

  const patchLocal = useCallback(
    ({ add = [], remove = [], update = [] } = {}) => {
      const pathsToRemove = (remove ?? []).filter(Boolean);
      const { runId: rid } = optionsRef.current;
      if (pathsToRemove.length && rid) {
        patchAllRunWindowCachesRemove(windowCacheRef.current, rid, pathsToRemove);
      }

      const currentCached = windowCacheRef.current.get(queryKeyRef.current);
      let nextItems = currentCached?.items ?? itemsRef.current;
      let nextTotal = currentCached?.total ?? totalRef.current;

      for (const row of add) {
        nextItems = upsertRunWindowRow(nextItems, row);
      }
      for (const { filePath, partial } of update) {
        if (filePath) nextItems = patchRunWindowRow(nextItems, filePath, partial);
      }

      if (pathsToRemove.length) {
        nextTotal = Math.max(0, nextTotal - pathsToRemove.length);
      }

      if (add.length) {
        const removedSet = new Set(pathsToRemove);
        nextTotal += add.filter((r) => r?.file_path && !removedSet.has(r.file_path)).length;
      }

      writeCache(queryKeyRef.current, nextItems, nextTotal);
      setItems(nextItems);
      setTotal(nextTotal);
    },
    [writeCache],
  );

  const sortLocal = useCallback(() => {
    const cached = windowCacheRef.current.get(queryKeyRef.current);
    const source = cached?.items ?? itemsRef.current;
    const nextItems = sortRunWindowRowsByCaseId(source);
    const nextTotal = cached?.total ?? totalRef.current;
    writeCache(queryKeyRef.current, nextItems, nextTotal);
    setItems(nextItems);
    setTotal(nextTotal);
  }, [writeCache]);

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
    invalidateForRun,
    invalidateAll,
    refetch,
    patchLocal,
    sortLocal,
    resetAndLoad,
  };
}

export default useRunCaseListWindow;
