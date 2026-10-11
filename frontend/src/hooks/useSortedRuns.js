import { useMemo } from "react";

/**
 * Sort a list of runs by creation or last-update time.
 *
 * @param {Array} runs - Run objects with `created_at` and `updated_at` fields.
 * @param {"created" | "updated"} sortBy - Which field to sort by (descending).
 * @returns {Array} A new sorted array (original is not mutated).
 */
export function useSortedRuns(runs, sortBy) {
  return useMemo(() => {
    if (!Array.isArray(runs) || runs.length === 0) return runs;
    return [...runs].sort((a, b) => {
      if (sortBy === "created") {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
      return (
        new Date(b.updated_at || b.created_at || 0) -
        new Date(a.updated_at || a.created_at || 0)
      );
    });
  }, [runs, sortBy]);
}
