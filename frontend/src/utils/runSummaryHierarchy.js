/**
 * Project → nested suites → cases tree for run summary (same shape as RunSummaryPanel).
 * Shared by the panel and run PDF export for consistent grouping.
 */

import { buildExportHierarchy, compareCasesByTreePath } from "./exportHierarchy";
import { buildRunCaseTree } from "./runCaseTree";

const EMPTY_STATS = { totalCases: 0, passed: 0, failed: 0, skipped: 0, pending: 0 };

/**
 * @param {Array<object>} cases
 * @returns {{ totalCases: number; passed: number; failed: number; skipped: number; pending: number }}
 */
export function statsForCases(cases = []) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let pending = 0;
  for (const c of cases) {
    const result = c?.result;
    if (result === "passed") passed += 1;
    else if (result === "failed") failed += 1;
    else if (result === "skipped") skipped += 1;
    else pending += 1;
  }
  return {
    totalCases: cases.length,
    passed,
    failed,
    skipped,
    pending,
  };
}

/**
 * @param {...{ totalCases: number; passed: number; failed: number; skipped: number; pending: number }} parts
 * @returns {{ totalCases: number; passed: number; failed: number; skipped: number; pending: number }}
 */
export function mergeSuiteStats(...parts) {
  return parts.reduce(
    (acc, part) => ({
      totalCases: acc.totalCases + (part?.totalCases ?? 0),
      passed: acc.passed + (part?.passed ?? 0),
      failed: acc.failed + (part?.failed ?? 0),
      skipped: acc.skipped + (part?.skipped ?? 0),
      pending: acc.pending + (part?.pending ?? 0),
    }),
    { ...EMPTY_STATS },
  );
}

function rollupFromRunCaseTreeNode(node) {
  const children = (node.children ?? []).map(rollupFromRunCaseTreeNode);
  const directStats = statsForCases(node.cases ?? []);
  const stats = mergeSuiteStats(directStats, ...children.map((child) => child.stats));
  return {
    key: node.key,
    path: node.path ?? node.key,
    displayName: node.displayName,
    stats,
    children,
  };
}

/**
 * Stats-only project/suite rollup for RunSummaryPanel (no per-case rows).
 *
 * @param {Array<object>} runCases
 * @returns {Array<{ key: string; path: string; displayName: string; stats: object; children: array }>}
 */
export function buildRunSummaryRollup(runCases = []) {
  if (!runCases.length) return [];
  return buildRunCaseTree(runCases).map(rollupFromRunCaseTreeNode);
}

/**
 * @param {Array<object>} runCases
 * @returns {Array<object>} Materialized project nodes with children[] and cases[]
 */
export function buildRunSummaryHierarchy(runCases = []) {
  if (!runCases.length) return [];
  const sorted = [...runCases].sort(compareCasesByTreePath);
  const hierarchy = buildExportHierarchy(sorted);

  function enrich(node) {
    return {
      type: node.type,
      key: node.key,
      path: node.path,
      displayName: node.displayName,
      cases: node.cases.map((leaf) => sorted[leaf.case_index]),
      children: (node.children || []).map(enrich),
    };
  }

  return hierarchy.map(enrich);
}

/**
 * @param {{ cases: object[]; children: object[] }} suite
 * @returns {{ totalCases: number; passed: number; failed: number; skipped: number; pending: number }}
 */
export function computeSuiteStats(suite) {
  const direct = {
    totalCases: suite.cases.length,
    passed: suite.cases.filter((c) => c.result === "passed").length,
    failed: suite.cases.filter((c) => c.result === "failed").length,
    skipped: suite.cases.filter((c) => c.result === "skipped").length,
    pending: suite.cases.filter((c) => !["passed", "failed", "skipped"].includes(c.result)).length,
  };
  return suite.children.reduce(
    (acc, child) => {
      const childStats = computeSuiteStats(child);
      return {
        totalCases: acc.totalCases + childStats.totalCases,
        passed: acc.passed + childStats.passed,
        failed: acc.failed + childStats.failed,
        skipped: acc.skipped + childStats.skipped,
        pending: acc.pending + childStats.pending,
      };
    },
    direct,
  );
}
