/**
 * Handles inline case create commit: dismisses the input immediately (like suite create),
 * then restores it with an error message if the async create fails.
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
      restoreCreating(path);
      setError(err?.message || "Invalid case ID");
      throw err;
    });
  }
  return result;
}
