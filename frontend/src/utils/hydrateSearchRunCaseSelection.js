import { mergeSearchCaseIntoRunDetail } from "./mergeRunDetailFromServer";

/**
 * Resolve which run owns a case list row (browse vs search mode).
 */
export function resolveRunIdForCaseSelection({
  searchActive,
  caseRow,
  searchSelectedRunId,
  browseSelectedRunId,
}) {
  if (!searchActive) return browseSelectedRunId ?? null;
  return caseRow?.run_id ?? searchSelectedRunId ?? browseSelectedRunId ?? null;
}

/**
 * Seed a search result row into runDetailsByRunId so the detail panel can render the case.
 */
export async function hydrateSearchRunCaseSelection({
  runId,
  filePath,
  searchCases,
  ensureRunHeaderLoaded,
  setRunDetailsByRunId,
}) {
  if (!runId || !filePath) return;
  await ensureRunHeaderLoaded(runId);
  const searchRow =
    searchCases.find((r) => r.run_id === runId && r.file_path === filePath) ?? null;
  if (!searchRow) return;
  setRunDetailsByRunId((prev) => {
    const detail = prev[runId];
    if (!detail) return prev;
    const hydrated = mergeSearchCaseIntoRunDetail(detail, searchRow);
    return hydrated === detail ? prev : { ...prev, [runId]: hydrated };
  });
}
