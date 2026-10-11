import { withExecutionMeta } from "./runCaseExecutionMeta";
import { normalizeRequirementIds } from "./requirementIds";
import { statsForCases } from "./runSummaryHierarchy";

function normalizeCaseResult(result) {
  return result && String(result).trim() ? result : "pending";
}

/**
 * Merge list_run_cases rows into a cached run detail without wiping
 * unsaved local drafts. Header passed/failed/skipped are left alone when
 * already set (getRun / optimistic / batch) so a partial case window cannot
 * revive stale counts after restore/pull.
 *
 * A path is treated as an unsaved draft only when local result differs from
 * the autosave baseline (`prevSaved`). Remote/disk changes (restore, pull)
 * update both baseline and server together, so they replace the cache.
 *
 * @param {object | null | undefined} prevDetail
 * @param {Array<object>} items
 * @param {Array<{ file_path: string, result: string }> | null | undefined} [prevSaved]
 * @returns {{ detail: object, dirtyPaths: Set<string> }}
 */
export function mergeListRunCasesIntoDetail(prevDetail, items, prevSaved = null) {
  const prevCases = prevDetail?.cases ?? [];
  const byPath = new Map(prevCases.map((c) => [c.file_path, c]));
  const savedByPath = new Map(
    (prevSaved ?? []).map((r) => [r.file_path, normalizeCaseResult(r.result)]),
  );
  const dirtyPaths = new Set();

  for (const server of items ?? []) {
    if (!server?.file_path) continue;
    const local = byPath.get(server.file_path);
    const serverResult = normalizeCaseResult(server.result);
    if (local) {
      const localResult = normalizeCaseResult(local.result);
      const savedResult = savedByPath.has(server.file_path)
        ? savedByPath.get(server.file_path)
        : null;
      // Unsaved draft: local moved away from last autosave baseline.
      const isUnsavedDraft =
        savedResult != null && localResult !== savedResult && localResult !== serverResult;
      if (isUnsavedDraft) {
        dirtyPaths.add(server.file_path);
        byPath.set(server.file_path, {
          ...server,
          result: local.result || "pending",
          executed_at: local.executed_at,
          executed_by: local.executed_by,
        });
        continue;
      }
    }
    byPath.set(server.file_path, server);
  }

  const cases = Array.from(byPath.values());
  const stats = statsForCases(cases);
  const prevRun = prevDetail?.run ?? {};
  // Keep authoritative header counts (getRun / optimistic / batch). Recomputing from a
  // partial case window would revive stale cached rows after restore/pull.
  const hasHeaderCounts =
    typeof prevRun.passed === "number" ||
    typeof prevRun.failed === "number" ||
    typeof prevRun.skipped === "number";
  const detail = {
    ...(prevDetail ?? {}),
    cases,
    run: {
      ...prevRun,
      ...(hasHeaderCounts
        ? {}
        : {
            passed: stats.passed,
            failed: stats.failed,
            skipped: stats.skipped,
          }),
    },
  };
  return { detail, dirtyPaths };
}

/**
 * Merge server list_run_cases results into the autosave baseline, skipping paths
 * that still differ from the local draft (so pending debounce saves are not cancelled).
 *
 * @param {Array<{ file_path: string, result: string }> | null | undefined} prevSaved
 * @param {Array<object>} items
 * @param {Set<string>} dirtyPaths
 * @returns {Array<{ file_path: string, result: string }>}
 */
export function mergeSavedRunResultsPreservingDirty(prevSaved, items, dirtyPaths) {
  const map = new Map((prevSaved ?? []).map((r) => [r.file_path, r]));
  for (const c of items ?? []) {
    if (!c?.file_path) continue;
    if (dirtyPaths?.has(c.file_path)) continue;
    map.set(c.file_path, {
      file_path: c.file_path,
      result: normalizeCaseResult(c.result),
    });
  }
  return Array.from(map.values());
}

/**
 * Merge getRun payload into cache without dropping pending-case execution metadata
 * when the server omits fields or a reload races with optimistic UI.
 */
export function mergeRunDetailFromServer(prevDetail, serverDetail) {
  if (!serverDetail) return serverDetail ?? prevDetail ?? null;
  if (!prevDetail?.cases?.length) return serverDetail;

  const prevByPath = new Map((prevDetail.cases ?? []).map((c) => [c.file_path, c]));

  const cases = (serverDetail.cases ?? []).map((c) => {
    const pending = !c.result || c.result === "pending";
    if (!pending) return c;

    const p = prevByPath.get(c.file_path);
    if (!p) return c;

    const executedAt =
      (c.executed_at && String(c.executed_at).trim()) ||
      (p.executed_at && String(p.executed_at).trim()) ||
      null;
    const executedBy =
      (c.executed_by && String(c.executed_by).trim()) ||
      (p.executed_by && String(p.executed_by).trim()) ||
      null;

    if (!executedAt && !executedBy) return c;
    return {
      ...c,
      ...(executedAt ? { executed_at: executedAt } : {}),
      ...(executedBy ? { executed_by: executedBy } : {}),
    };
  });

  return { ...serverDetail, cases };
}

/**
 * Ensure pending cases on given paths have execution metadata (e.g. from add_run_cases response).
 */
/**
 * Merge DB-first set_run_results_batch / set_run_result API response into run cache.
 * Preserves title, tags, comments, and other case metadata from prevDetail.
 */
export function mergeRunResultsFromBatchResponse(prevDetail, response) {
  if (!response) return prevDetail ?? null;
  if (!prevDetail) return prevDetail ?? null;

  const stampedByPath = new Map(
    (response.cases ?? []).map((c) => [c.file_path, c]),
  );

  const cases = (prevDetail.cases ?? []).map((c) => {
    const stamped = stampedByPath.get(c.file_path);
    if (!stamped) return c;
    return {
      ...c,
      result: stamped.result ?? c.result,
      executed_at: stamped.executed_at ?? c.executed_at,
      executed_by: stamped.executed_by ?? c.executed_by,
      ...(stamped.comment !== undefined ? { comment: stamped.comment } : {}),
    };
  });

  const runPatch = response.run;
  const run = runPatch
    ? {
        ...(prevDetail.run ?? {}),
        ...(runPatch.passed !== undefined ? { passed: runPatch.passed } : {}),
        ...(runPatch.failed !== undefined ? { failed: runPatch.failed } : {}),
        ...(runPatch.skipped !== undefined ? { skipped: runPatch.skipped } : {}),
        ...(runPatch.updated_at ? { updated_at: runPatch.updated_at } : {}),
        ...(runPatch.updated_by !== undefined ? { updated_by: runPatch.updated_by } : {}),
      }
    : prevDetail.run;

  return { ...prevDetail, run, cases };
}

function directoryFromFilePath(filePath) {
  const fp = filePath || "";
  const index = fp.lastIndexOf("/");
  return index >= 0 ? fp.slice(0, index) : "";
}

/**
 * Seed a run detail cache entry from a search_run_cases row when the case is not yet loaded.
 * @param {object | null | undefined} detail
 * @param {object | null | undefined} searchRow
 * @param {string | null | undefined} [executedByHint]
 * @returns {object | null | undefined}
 */
export function mergeSearchCaseIntoRunDetail(detail, searchRow, executedByHint = null) {
  if (!detail || !searchRow?.file_path) return detail;
  const filePath = searchRow.file_path;
  if ((detail.cases ?? []).some((c) => c.file_path === filePath)) return detail;

  const hint = executedByHint ?? detail.run?.updated_by ?? null;
  const caseRow = withExecutionMeta(
    {
      file_path: filePath,
      case_id: searchRow.case_id ?? filePath,
      title: searchRow.title || searchRow.case_id || "Untitled",
      priority: searchRow.priority ?? null,
      result: searchRow.result ?? "pending",
      directory: searchRow.directory || directoryFromFilePath(filePath),
      tags: searchRow.tags ?? [],
      requirement_ids: normalizeRequirementIds(searchRow),
      automated: Boolean(searchRow.automated),
      assigned_to: searchRow.assigned_to ?? null,
      effective_assigned_to:
        searchRow.effective_assigned_to ??
        searchRow.assigned_to ??
        detail.run?.assigned_to ??
        null,
      executed_by: searchRow.executed_by ?? null,
      executed_at: searchRow.executed_at ?? null,
      comments: searchRow.comments ?? [],
    },
    { result: searchRow.result ?? "pending", executedByHint: hint },
  );

  return {
    ...detail,
    cases: [...(detail.cases ?? []), caseRow],
  };
}

export function applyRunAssignedToPaths(detail, filePaths, runAssignedTo) {
  const name = runAssignedTo?.trim();
  if (!detail || !name || !filePaths?.length) return detail;

  const paths = new Set(filePaths);
  return {
    ...detail,
    cases: (detail.cases ?? []).map((c) => {
      if (!paths.has(c.file_path)) return c;
      if (c.assigned_to?.trim()) return c;
      return {
        ...c,
        effective_assigned_to: name,
      };
    }),
  };
}

export function applyExecutedByToPaths(detail, filePaths, executedBy) {
  const name = executedBy?.trim();
  if (!detail || !name || !filePaths?.length) return detail;

  const paths = new Set(filePaths);
  return {
    ...detail,
    cases: (detail.cases ?? []).map((c) => {
      if (!paths.has(c.file_path)) return c;
      if (c.result && c.result !== "pending") return c;
      return withExecutionMeta(c, { result: "pending", executedByHint: name });
    }),
  };
}
