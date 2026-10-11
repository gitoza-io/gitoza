import { useCallback, useEffect, useRef, useState } from "react";
import { REPOSITORY_CASE_WINDOW_SIZE } from "../constants/repositoryCaseList";
import { listAutomationResults } from "../services/api";

/**
 * Paginated automation result list for column 2 (flat cases in an execution or suite).
 */
export function useAutomationCaseListWindow({
  executionId,
  suiteKey = null,
  repoSlug,
  enabled = true,
  windowSize = REPOSITORY_CASE_WINDOW_SIZE,
} = {}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const generationRef = useRef(0);

  const loadPage = useCallback(
    async (offset, append) => {
      if (!executionId || !repoSlug || !enabled) {
        setItems([]);
        setTotal(0);
        return;
      }
      const gen = ++generationRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await listAutomationResults(executionId, repoSlug, {
          limit: windowSize,
          offset,
          suiteKey,
        });
        if (gen !== generationRef.current) return;
        setTotal(res?.total ?? 0);
        setItems((prev) =>
          append ? [...prev, ...(res?.items ?? [])] : [...(res?.items ?? [])],
        );
      } catch (err) {
        if (gen !== generationRef.current) return;
        setError(err?.message ?? "Failed to load automation results");
        if (!append) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (gen === generationRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [executionId, suiteKey, repoSlug, enabled, windowSize],
  );

  const refresh = useCallback(() => {
    loadPage(0, false);
  }, [loadPage]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || items.length >= total) return;
    loadPage(items.length, true);
  }, [loadPage, loading, loadingMore, items.length, total]);

  useEffect(() => {
    loadPage(0, false);
  }, [loadPage]);

  const hasMore = items.length < total;

  return {
    items,
    total,
    loading,
    loadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
  };
}
