/**
 * Apply optimistic run-case execution metadata (add to run, Pass/Fail/Skip).
 *
 * @param {object} caseRow - Run case row from getRun / runDetailsByRunId cache
 * @param {{ result?: string, executedByHint?: string | null }} opts
 */
export function withExecutionMeta(caseRow, { result, executedByHint }) {
  const now = new Date().toISOString();
  const by = executedByHint ?? caseRow.executed_by ?? null;
  const r = result ?? caseRow.result ?? "pending";

  if (!r || r === "pending") {
    return {
      ...caseRow,
      result: "pending",
      executed_at: now,
      executed_by: by,
    };
  }

  return {
    ...caseRow,
    result: r,
    executed_at: now,
    executed_by: by,
  };
}
