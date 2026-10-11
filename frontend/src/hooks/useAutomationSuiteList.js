import { useCallback, useState } from "react";
import { listAutomationSuites } from "../services/api";

/**
 * Lazy-load JUnit suite nodes for an execution (column 1 tree level 3).
 */
export function useAutomationSuiteList() {
  const [suitesByExecution, setSuitesByExecution] = useState({});
  const [loadingSuitesFor, setLoadingSuitesFor] = useState(null);
  const [error, setError] = useState(null);

  const loadSuitesForExecution = useCallback(async (executionId, repoSlug) => {
    if (!executionId || !repoSlug) return;

    setLoadingSuitesFor(executionId);
    setError(null);
    try {
      const res = await listAutomationSuites(executionId, repoSlug);
      setSuitesByExecution((prev) => ({
        ...prev,
        [executionId]: Array.isArray(res?.items) ? res.items : [],
      }));
    } catch (err) {
      setError(err?.message ?? "Failed to load suites");
      setSuitesByExecution((prev) => ({
        ...prev,
        [executionId]: [],
      }));
    } finally {
      setLoadingSuitesFor(null);
    }
  }, []);

  const clearSuitesCache = useCallback(() => {
    setSuitesByExecution({});
  }, []);

  return {
    suitesByExecution,
    loadingSuitesFor,
    error,
    loadSuitesForExecution,
    clearSuitesCache,
  };
}
