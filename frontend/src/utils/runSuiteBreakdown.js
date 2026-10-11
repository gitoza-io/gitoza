import {
  buildRunSummaryHierarchy,
  computeSuiteStats,
  statsForCases,
} from "./runSummaryHierarchy";

function isUnderStandardCasesPath(filePath) {
  const p = (filePath || "").replace(/\\/g, "/");
  return p.startsWith(".gitoza/test/cases/");
}

function collectSuiteRows(nodes, parentLabel = "") {
  const rows = [];
  for (const node of nodes ?? []) {
    const label = parentLabel ? `${parentLabel} › ${node.displayName}` : node.displayName;
    const stats = computeSuiteStats(node);
    if (stats.totalCases > 0) {
      rows.push({ key: node.key, label, stats });
    }
    if (node.children?.length) {
      rows.push(...collectSuiteRows(node.children, label));
    }
  }
  return rows;
}

/**
 * Flat suite/project breakdown rows for Dashboard (path order, breadcrumb labels).
 *
 * @param {Array<object>} runCases
 * @returns {Array<{ key: string, label: string, stats: object }>}
 */
export function buildSuiteBreakdownRows(runCases = []) {
  if (!runCases?.length) return [];

  const hierarchy = buildRunSummaryHierarchy(runCases);
  const rows = collectSuiteRows(hierarchy);

  const unscoped = runCases.filter((c) => !isUnderStandardCasesPath(c.file_path));
  if (unscoped.length > 0) {
    rows.push({
      key: "__other_locations__",
      label: "Other locations",
      stats: statsForCases(unscoped),
    });
  }

  return rows;
}
