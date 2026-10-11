import { compareCasesByCaseId } from "./exportHierarchy";
import {
  findFolderNode,
  findFolderDisplayName,
  getCasesForFolderSelection,
  getDirectCasesInFolder,
  getRecursiveCasesInFolder,
} from "./caseTree";

export const RUN_TREE_PREFIX = "__run__";

/** Synthetic tree path for a run root node (acts like a project in Test Repository). */
export function runTreePathForRunId(runId) {
  if (!runId) return null;
  return `${RUN_TREE_PREFIX}/${runId}`;
}

/**
 * @param {string | null | undefined} path
 * @returns {{ runId: string, repoPath: string | null, isRunRoot: boolean } | null}
 */
export function parseRunTreePath(path) {
  const normalized = (path || "").trim().replace(/\\/g, "/");
  if (!normalized.startsWith(`${RUN_TREE_PREFIX}/`)) return null;
  const rest = normalized.slice(`${RUN_TREE_PREFIX}/`.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return { runId: rest, repoPath: null, isRunRoot: true };
  }
  return { runId: rest.slice(0, slash), repoPath: rest.slice(slash + 1), isRunRoot: false };
}

/** Repo-relative folder prefix for list_run_cases from a unified run tree path. */
export function folderPrefixFromTreePath(directoryPath) {
  const parsed = parseRunTreePath(directoryPath);
  if (!parsed || parsed.isRunRoot) return null;
  return parsed.repoPath;
}

export function isRunRootPath(path) {
  return parseRunTreePath(path)?.isRunRoot === true;
}

export function prefixRunDirectoryPath(runId, repoPath) {
  if (!runId) return repoPath ?? null;
  if (!repoPath) return runTreePathForRunId(runId);
  return `${runTreePathForRunId(runId)}/${repoPath}`;
}

function prefixRunFolderTreeNodes(folderTree, runId) {
  return (folderTree || []).map((node) => {
    const repoPath = node.directory_path;
    return {
      ...node,
      repo_directory_path: repoPath,
      directory_path: prefixRunDirectoryPath(runId, repoPath),
      children: prefixRunFolderTreeNodes(node.children ?? [], runId),
    };
  });
}

function runDisplayName(run, detail) {
  return (detail?.run?.name ?? run?.name ?? "").trim() || "Unnamed run";
}

/**
 * Run header for summary UI: prefer detail cache, else listRuns row (Dashboard-style stale-first).
 * @param {string | null | undefined} runId
 * @param {Array} runs
 * @param {Record<string, { run?: object }>} runDetailsByRunId
 * @returns {object | null}
 */
export function runSummaryFromList(runId, runs = [], runDetailsByRunId = {}) {
  if (!runId) return null;
  if (runDetailsByRunId[runId]?.run) return runDetailsByRunId[runId].run;
  return runs.find((r) => r.run_id === runId) ?? null;
}

/**
 * Replace or insert a loaded project subtree into a run folder tree.
 * @param {array | null | undefined} tree
 * @param {string} projectRepoPath
 * @param {object} projectNode
 * @returns {array}
 */
export function mergeProjectSubtreeIntoTree(tree, projectRepoPath, projectNode) {
  if (!projectNode || !projectRepoPath) return tree ?? [];
  const current = tree ?? [];
  const idx = current.findIndex((n) => n.directory_path === projectRepoPath);
  if (idx >= 0) {
    const next = [...current];
    next[idx] = projectNode;
    return next;
  }
  return [...current, projectNode].sort((a, b) =>
    (a.display_name ?? a.name ?? "").localeCompare(b.display_name ?? b.name ?? ""),
  );
}

function runCaseCount(run, detail, cases) {
  const fromDetail = detail?.run?.total_cases ?? run?.total_cases;
  if (typeof fromDetail === "number") return fromDetail;
  return cases?.length ?? 0;
}

/**
 * Build Project → Suite → Case tree from run cases (same shape as repo for left sidebar).
 * Each case has file_path, case_id, title, result; we derive project/suite from file_path.
 */

export function projectFromFilePath(filePath) {
  const p = (filePath || "").replace(/\\/g, "/");
  if (!p.startsWith(".gitoza/test/cases/")) return "";
  const parts = p.split("/");
  if (parts.length >= 4) return parts.slice(0, 4).join("/");
  return "";
}

function folderFromFilePath(filePath) {
  const p = (filePath || "").replace(/\\/g, "/");
  const lastSlash = p.lastIndexOf("/");
  return lastSlash >= 0 ? p.slice(0, lastSlash) : "";
}

function projectDisplayName(projectPath) {
  const name = projectPath.split("/").pop() || "";
  return name.replace(/_/g, " ").replace(/-/g, " ").trim() || name;
}

function suiteDisplayName(suitePath) {
  const name = suitePath.split("/").pop() || "";
  return name.replace(/_/g, " ").trim() || name;
}

/**
 * @param {array} runCases - runDetail.cases: [{ file_path, case_id, title, result, directory, ... }]
 * @returns {array} Tree: [ { type: 'project', key, displayName, cases: [], children: [ { type: 'suite', key, displayName, cases: [] } ] } ]
 */
export function buildRunCaseTree(runCases) {
  if (!runCases?.length) return [];

  const byProject = new Map();
  for (const c of runCases) {
    const fp = c.file_path || "";
    const project = projectFromFilePath(fp);
    const folder = folderFromFilePath(fp);
    if (!project) continue;
    if (!byProject.has(project)) {
      byProject.set(project, {
        type: "project",
        key: project,
        path: project,
        displayName: projectDisplayName(project),
        cases: [],
        children: new Map(),
      });
    }
    const proj = byProject.get(project);

    if (folder === project || !folder.startsWith(`${project}/`)) {
      proj.cases.push(c);
      continue;
    }

    const relativeSuitePath = folder.slice(project.length + 1);
    const segments = relativeSuitePath.split("/").filter(Boolean);
    let current = proj;
    let currentPath = project;
    for (const segment of segments) {
      currentPath = `${currentPath}/${segment}`;
      if (!current.children.has(segment)) {
        current.children.set(segment, {
          type: "suite",
          key: currentPath,
          path: currentPath,
          displayName: suiteDisplayName(currentPath),
          cases: [],
          children: new Map(),
        });
      }
      current = current.children.get(segment);
    }
    current.cases.push(c);
  }

  function materialize(node) {
    const children = Array.from(node.children.values())
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map(materialize);
    const cases = [...node.cases].sort(compareCasesByCaseId);
    return {
      type: node.type,
      key: node.key,
      path: node.path,
      displayName: node.displayName,
      cases,
      children,
    };
  }

  return Array.from(byProject.values())
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map(materialize);
}

/**
 * Collect all expandable node keys from run case tree (for "expand all" in toolbar).
 * @param {array} tree - Result of buildRunCaseTree(runCases)
 * @returns {Set<string>}
 */
export function collectRunCaseExpandKeys(tree) {
  const keys = new Set();
  function collect(nodes) {
    for (const n of nodes || []) {
      const hasExpandable = (n.children?.length ?? 0) > 0 || (n.cases?.length ?? 0) > 0;
      if (hasExpandable) keys.add(n.key);
      if (n.children?.length) collect(n.children);
    }
  }
  collect(tree);
  return keys;
}

/**
 * Flatten run case `file_path` values in the same order RunCaseTree renders them (children first, then cases).
 * Used for Shift+click range selection in the run cases tree.
 *
 * @param {array} runCases - runDetail.cases
 * @returns {string[]}
 */
export function flattenRunCasePathsInDisplayOrder(runCases) {
  const tree = buildRunCaseTree(runCases);
  const out = [];
  function visit(node) {
    for (const child of node.children ?? []) visit(child);
    for (const c of node.cases ?? []) {
      if (c?.file_path) out.push(c.file_path);
    }
  }
  for (const root of tree) visit(root);
  return out;
}

/**
 * Map case file_path to virtual list location for scroll-to-selected.
 *
 * @param {array} tree - Result of buildRunCaseTree(runCases)
 * @returns {Map<string, { listId: string, index: number, listCaseCount: number }>}
 */
export function buildRunCaseLocationMap(tree) {
  const map = new Map();
  function visit(node) {
    const cases = node.cases ?? [];
    const listCaseCount = cases.length;
    cases.forEach((c, index) => {
      const fp = c?.file_path;
      if (fp && node.key) map.set(fp, { listId: node.key, index, listCaseCount });
    });
    for (const child of node.children ?? []) visit(child);
  }
  for (const root of tree ?? []) visit(root);
  return map;
}

function countCasesInRunNode(node) {
  const direct = node.cases?.length ?? 0;
  const fromChildren = (node.children ?? []).reduce(
    (sum, child) => sum + countCasesInRunNode(child),
    0,
  );
  return direct + fromChildren;
}

function statsForRunCases(cases = []) {
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

/** Run list / run detail summary fields (from listRuns or getRun.run). */
function statsFromRunSummary(run, detail) {
  const source = detail?.run ?? run;
  const total = source?.total_cases;
  if (typeof total !== "number" || total <= 0) return undefined;
  const passed = source?.passed ?? 0;
  const failed = source?.failed ?? 0;
  const skipped = source?.skipped ?? 0;
  const pending = Math.max(0, total - passed - failed - skipped);
  return {
    totalCases: total,
    passed,
    failed,
    skipped,
    pending,
  };
}

function resultStatsForRunRoot(run, detail, cases) {
  if (cases.length > 0) return statsForRunCases(cases);
  return statsFromRunSummary(run, detail);
}

/** Prefer folder-tree rollup so run-root badges match project/suite badges after restore/pull. */
function resultStatsFromFolderChildren(children) {
  if (!children?.length) return undefined;
  const parts = children.map((c) => c?.result_stats).filter(Boolean);
  if (!parts.length) return undefined;
  return mergeRunResultStats(...parts);
}

function mergeRunResultStats(...parts) {
  return parts.reduce(
    (acc, part) => ({
      totalCases: acc.totalCases + (part?.totalCases ?? 0),
      passed: acc.passed + (part?.passed ?? 0),
      failed: acc.failed + (part?.failed ?? 0),
      skipped: acc.skipped + (part?.skipped ?? 0),
      pending: acc.pending + (part?.pending ?? 0),
    }),
    { totalCases: 0, passed: 0, failed: 0, skipped: 0, pending: 0 },
  );
}

function countResultStatsInRunNode(node) {
  const direct = statsForRunCases(node.cases ?? []);
  return (node.children ?? []).reduce(
    (acc, child) => mergeRunResultStats(acc, countResultStatsInRunNode(child)),
    direct,
  );
}

function projectFolderNodeName(projectPath) {
  const segment = (projectPath || "").split("/").pop() || "";
  if (!segment) return "project.gitoza.test";
  return segment.includes(".gitoza.test") ? segment : `${segment}.gitoza.test`;
}

function mapRunTreeNodeToFolderNode(node) {
  const isProject = node.type === "project";
  const children = (node.children ?? []).map(mapRunTreeNodeToFolderNode);
  return {
    name: isProject ? projectFolderNodeName(node.path) : node.displayName,
    display_name: node.displayName,
    directory_path: node.path,
    is_project: isProject,
    case_count: countCasesInRunNode(node),
    result_stats: countResultStatsInRunNode(node),
    children,
  };
}

/**
 * Folder-only tree for RepositoryFolderTree from run cases.
 * @param {array} runCases
 * @returns {array}
 */
export function buildRunFolderTree(runCases) {
  const tree = buildRunCaseTree(runCases);
  return tree.map(mapRunTreeNodeToFolderNode);
}

/**
 * Unified browse tree: each run is a root folder; repo projects/suites nest underneath.
 * Compatible with RepositoryFolderTree (same shape as Test Repository browse).
 *
 * @param {array} runs
 * @param {Record<string, { run?: object, cases?: array } | null | undefined>} runDetailsByRunId
 * @returns {array}
 */
/**
 * Unified tree from server-side run case search results (pruned runs and folders).
 * @param {array} runs - Run list items to include (already filtered to matching runs)
 * @param {array} matchingCases - Rows from search_run_cases
 * @returns {array}
 */
export function buildUnifiedRunTreeFromSearchResults(runs, matchingCases) {
  const byRunId = new Map();
  for (const c of matchingCases ?? []) {
    const runId = c?.run_id;
    if (!runId) continue;
    if (!byRunId.has(runId)) byRunId.set(runId, []);
    byRunId.get(runId).push(c);
  }

  return (runs || [])
    .filter((run) => byRunId.has(run?.run_id))
    .map((run) => {
      const runId = run.run_id;
      const cases = byRunId.get(runId) ?? [];
      const children =
        cases.length > 0
          ? prefixRunFolderTreeNodes(buildRunFolderTree(cases), runId)
          : [];
      const name = runDisplayName(run, undefined);
      return {
        is_run: true,
        is_project: true,
        run_id: runId,
        name,
        display_name: name,
        directory_path: runTreePathForRunId(runId),
        case_count: cases.length,
        result_stats: cases.length > 0 ? statsForRunCases(cases) : undefined,
        children,
      };
    });
}

export function buildUnifiedRunTree(runs, runDetailsByRunId = {}, runFolderTreeByRunId = {}) {
  const hasFolderTrees = runFolderTreeByRunId && Object.keys(runFolderTreeByRunId).length > 0;
  if (hasFolderTrees) {
    return buildUnifiedRunTreeFromFolderTrees(runs, runDetailsByRunId, runFolderTreeByRunId);
  }
  return (runs || []).map((run) => {
    const runId = run?.run_id;
    const detail = runId ? runDetailsByRunId[runId] : undefined;
    const cases = detail?.cases ?? [];
    const children =
      detail !== undefined && cases.length > 0
        ? prefixRunFolderTreeNodes(buildRunFolderTree(cases), runId)
        : [];
    const name = runDisplayName(run, detail);
    return {
      is_run: true,
      is_project: true,
      run_id: runId,
      name,
      display_name: name,
      directory_path: runTreePathForRunId(runId),
      case_count: runCaseCount(run, detail, cases),
      result_stats: resultStatsForRunRoot(run, detail, cases),
      children,
    };
  });
}

/**
 * Unified tree using server-built folder trees (no full case list required).
 */
export function buildUnifiedRunTreeFromFolderTrees(
  runs,
  runDetailsByRunId = {},
  runFolderTreeByRunId = {},
) {
  return (runs || []).map((run) => {
    const runId = run?.run_id;
    const detail = runId ? runDetailsByRunId[runId] : undefined;
    const folderTree = runId ? runFolderTreeByRunId[runId] : undefined;
    const children =
      folderTree !== undefined && folderTree.length > 0
        ? prefixRunFolderTreeNodes(folderTree, runId)
        : [];
    const name = runDisplayName(run, detail);
    const caseCount = runCaseCount(run, detail, []);
    return {
      is_run: true,
      is_project: true,
      run_id: runId,
      name,
      display_name: name,
      directory_path: runTreePathForRunId(runId),
      case_count: caseCount,
      result_stats:
        resultStatsFromFolderChildren(children) ?? resultStatsForRunRoot(run, detail, []),
      children,
    };
  });
}

/**
 * Map a run case row to list-item shape (includes result for Pass/Fail/Skip).
 * @param {object} c
 * @returns {object}
 */
export function mapRunCaseToListItem(c) {
  const item = {
    file_path: c.file_path,
    case_id: c.case_id,
    title: c.title || c.case_id || "Untitled",
    priority: c.priority || null,
    result: c.result ?? "pending",
  };
  if (c.run_id) item.run_id = c.run_id;
  return item;
}

function runNodeCasesRepoPath(node) {
  if (!node) return null;
  if (node.repo_directory_path) return node.repo_directory_path;
  const parsed = parseRunTreePath(node.directory_path);
  if (parsed?.repoPath) return parsed.repoPath;
  return node.directory_path ?? null;
}

function sortRunCaseListItems(items) {
  return [...(items || [])].sort((a, b) => compareCasesByCaseId(a, b));
}

function walkRunFolderNodeForGroupedList(node, runCases, unifiedTree, entries, depth, mapCase) {
  const repoPath = runNodeCasesRepoPath(node);
  if (repoPath && !parseRunTreePath(node.directory_path)?.isRunRoot) {
    const direct = sortRunCaseListItems(
      getDirectCasesInFolder(runCases, repoPath).map((item) => mapCase(item)),
    );
    for (const item of direct) {
      entries.push({ type: "case", item });
    }
  }

  for (const child of node.children ?? []) {
    const childRepoPath = runNodeCasesRepoPath(child);
    if (!childRepoPath) continue;
    if (getRecursiveCasesInFolder(runCases, childRepoPath).length === 0) continue;
    entries.push({
      type: "suiteHeader",
      directoryPath: child.directory_path,
      label:
        findRunFolderDisplayName(unifiedTree, child.directory_path) ??
        child.display_name ??
        child.name ??
        childRepoPath,
      depth,
    });
    walkRunFolderNodeForGroupedList(child, runCases, unifiedTree, entries, depth + 1, mapCase);
  }
}

/**
 * Grouped column-2 entries for run browse: direct cases first, subsuite headers, nested content.
 * @param {array} runCases
 * @param {array} unifiedFolderTree
 * @param {string | null | undefined} directoryPath
 * @returns {import("./caseTree").CaseListRenderEntry[]}
 */
export function buildGroupedRunCaseListEntries(runCases, unifiedFolderTree, directoryPath) {
  if (!directoryPath) return [];
  const byPath = new Map((runCases || []).map((c) => [c.file_path, c]));
  const mapCase = (item) => mapRunCaseToListItem(byPath.get(item.file_path) ?? item);

  const node = findFolderNode(unifiedFolderTree, directoryPath);
  if (!node) {
    return getRunCasesForFolderSelection(runCases, unifiedFolderTree, directoryPath).map((item) => ({
      type: "case",
      item,
    }));
  }

  const entries = [];
  walkRunFolderNodeForGroupedList(node, runCases, unifiedFolderTree, entries, 0, mapCase);
  return entries;
}

/**
 * Cases for run list column: recursive for all repo folders under run.
 * Preserves result field from run cases.
 *
 * @param {array} runCases
 * @param {array} folderTree - Result of buildRunFolderTree
 * @param {string | null | undefined} directoryPath
 * @returns {array}
 */
export function getRunCasesForFolderSelection(runCases, folderTree, directoryPath) {
  if (!directoryPath) return [];
  const parsed = parseRunTreePath(directoryPath);
  let scopedCases = runCases || [];
  if (parsed?.runId && scopedCases.some((c) => c.run_id)) {
    scopedCases = scopedCases.filter((c) => c.run_id === parsed.runId);
  }
  const byPath = new Map(scopedCases.map((c) => [c.file_path, c]));

  if (parsed?.isRunRoot) {
    return scopedCases
      .map((c) => mapRunCaseToListItem(byPath.get(c.file_path) ?? c))
      .sort((a, b) => compareCasesByCaseId(a, b));
  }

  const repoTree = buildRunFolderTree(scopedCases);
  const repoPath = parsed?.repoPath ?? directoryPath;
  const items = getCasesForFolderSelection(scopedCases, repoTree, repoPath);
  return items.map((item) => mapRunCaseToListItem(byPath.get(item.file_path) ?? item));
}

/**
 * Display label for a folder path in the run case list column header.
 * @param {array} folderTree
 * @param {string | null | undefined} directoryPath
 * @returns {string | null}
 */
export function findRunFolderDisplayName(folderTree, directoryPath) {
  if (!directoryPath) return null;
  const node = findFolderNode(folderTree, directoryPath);
  if (node) {
    const name = node.display_name ?? node.name ?? "";
    if (node.is_run) return name || "Run";
    if (node.is_project) return name.replace(/\.gitoza\.test$/i, "") || name;
    return name;
  }
  const parsed = parseRunTreePath(directoryPath);
  if (parsed?.repoPath) return parsed.repoPath.split("/").pop() || directoryPath;
  return findFolderDisplayName(folderTree, directoryPath);
}
