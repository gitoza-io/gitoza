import { useEffect, useState } from "react";
import { chipsToCaseQueryParams, fetchAllCases } from "../utils/caseQuery";

/** Stable empty chips reference for callers that toggle search on/off. */
export const EMPTY_SEARCH_CHIPS = [];

function chipsDepKey(chips) {
  if (!chips?.length) return "";
  return JSON.stringify(chips);
}

/**
 * Server-side case search driven by SearchPanel chips.
 *
 * @param {string|null} repoSlug
 * @param {Array<{ key: string, value: string }>} chips
 * @returns {{ results: Array<object>, loading: boolean, setResults: Function }}
 */
export function useCaseSearchResults(repoSlug, chips) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const chipsKey = chipsDepKey(chips);

  useEffect(() => {
    if (!repoSlug || !chipsKey) {
      setResults((prev) => (prev.length === 0 ? prev : []));
      setLoading((prev) => (prev ? false : prev));
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    const params = chipsToCaseQueryParams(chips);
    fetchAllCases(repoSlug, params)
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
  }, [repoSlug, chipsKey]);

  return { results, loading, setResults };
}
