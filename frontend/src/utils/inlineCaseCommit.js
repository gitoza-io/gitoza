/**
 * Handles case create commit (auto-minted id). Dismisses any draft UI immediately;
 * on failure sets an error (optional restoreCreating for legacy inline ID UI).
 *
 * @param {{
 *   path: string,
 *   isProject: boolean,
 *   caseId: string | null,
 *   onCommitInlineCase?: (path: string, isProject: boolean, caseId: string) => unknown,
 *   clearCreating: () => void,
 *   restoreCreating: (path: string) => void,
 *   setError: (message: string) => void,
 *   clearError: () => void,
 * }} options
 * @returns {unknown}
 */
export function commitInlineCaseCreate({
  path,
  isProject,
  caseId,
  onCommitInlineCase,
  clearCreating,
  restoreCreating,
  setError,
  clearError,
}) {
  if (!onCommitInlineCase) return undefined;
  clearError();
  if (caseId == null) {
    clearCreating();
    return undefined;
  }
  clearCreating();
  const result = onCommitInlineCase(path, isProject, caseId);
  if (result && typeof result.then === "function") {
    return result.catch((err) => {
      restoreCreating?.(path);
      setError(err?.message || "Failed to create test case");
      throw err;
    });
  }
  return result;
}
