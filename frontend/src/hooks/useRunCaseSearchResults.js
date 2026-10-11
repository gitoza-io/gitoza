import { useEffect, useState } from "react";
import { chipsToRunCaseQueryParams, fetchAllRunCases } from "../utils/runCaseQuery";

/**
 * Server-side run case search driven by SearchPanel chips.
 *
 * @param {string|null} repoSlug
 * @param {Array<{ key: string, value: string }>} chips
 * @param {{ includeArchived?: boolean, enabled?: boolean, refreshKey?: number }} [options]
 * @returns {{ results: Array<object>, loading: boolean, setResults: Function }}
 */
export function useRunCaseSearchResults(
  repoSlug,
  chips,
  { includeArchived = false, enabled = true, refreshKey = 0 } = {},
) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !repoSlug || !chips?.length) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const params = chipsToRunCaseQueryParams(chips);
    fetchAllRunCases(repoSlug, params, { includeArchived })
      .then((rows) => {
        if (!cancelled) setResults(rows);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repoSlug, chips, includeArchived, enabled, refreshKey]);

  return { results, loading, setResults };
}
