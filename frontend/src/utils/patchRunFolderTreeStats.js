import { projectFromFilePath } from "./runCaseTree";

const EMPTY_STATS = {
  totalCases: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  pending: 0,
};

/**
 * @param {string | null | undefined} result
 * @returns {"passed" | "failed" | "skipped" | "pending"}
 */
export function normalizeRunResult(result) {
  if (result === "passed" || result === "failed" || result === "skipped") {
    return result;
  }
  return "pending";
}

/**
 * @param {object | null | undefined} stats
 * @returns {object}
 */
function ensureStats(stats) {
  if (!stats) return { ...EMPTY_STATS };
  return {
    totalCases: stats.totalCases ?? 0,
    passed: stats.passed ?? 0,
    failed: stats.failed ?? 0,
    skipped: stats.skipped ?? 0,
    pending: stats.pending ?? 0,
  };
}

/**
 * @param {object | null | undefined} stats
 * @param {string | null | undefined} oldResult
 * @param {string | null | undefined} newResult
 * @returns {object | null} null when no change
 */
export function applyResultStatsDelta(stats, oldResult, newResult) {
  const oldKey = normalizeRunResult(oldResult);
  const newKey = normalizeRunResult(newResult);
  if (oldKey === newKey) return null;

  const next = ensureStats(stats);
  next[oldKey] = Math.max(0, next[oldKey] - 1);
  next[newKey] = next[newKey] + 1;
  return next;
}

/**
 * @param {object | null | undefined} stats
 * @param {string | null | undefined} result
 * @returns {object}
 */
export function applyRemoveStatsDelta(stats, result) {
  const key = normalizeRunResult(result);
  const next = ensureStats(stats);
  next.totalCases = Math.max(0, next.totalCases - 1);
  next[key] = Math.max(0, next[key] - 1);
  return next;
}

/**
 * @param {object | null | undefined} stats
 * @param {string | null | undefined} result
 * @returns {object}
 */
export function applyAddStatsDelta(stats, result) {
  const key = normalizeRunResult(result);
  const next = ensureStats(stats);
  next.totalCases += 1;
  next[key] += 1;
  return next;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function parentFolderOf(filePath) {
  const p = (filePath || "").replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

/**
 * @param {string} nodeRepoPath
 * @param {string} filePath
 * @returns {boolean}
 */
function caseUnderFolder(nodeRepoPath, filePath) {
  if (!nodeRepoPath || !filePath) return false;
  const parent = parentFolderOf(filePath);
  return parent === nodeRepoPath || parent.startsWith(`${nodeRepoPath}/`);
}

/**
 * @param {array} nodes
 * @param {string} filePath
 * @param {(node: object) => object} patchNode
 * @returns {{ tree: array, changed: boolean }}
 */
function mapFolderTreeNodes(nodes, filePath, patchNode) {
  let changed = false;
  const tree = (nodes ?? []).map((node) => {
    let nextNode = node;
    if (caseUnderFolder(node.directory_path, filePath)) {
      const patched = patchNode(node);
      if (patched !== node) {
        nextNode = patched;
        changed = true;
      }
    }
    const childResult = mapFolderTreeNodes(node.children ?? [], filePath, patchNode);
    if (childResult.changed) {
      changed = true;
      nextNode = nextNode === node ? { ...nextNode } : nextNode;
      nextNode.children = childResult.tree;
    }
    return nextNode;
  });
  return { tree, changed };
}

/**
 * @param {array} tree
 * @param {string} filePath
 * @param {string | null | undefined} oldResult
 * @param {string | null | undefined} newResult
 * @returns {array}
 */
export function patchFolderTreeForResultChange(tree, filePath, oldResult, newResult) {
  if (!tree?.length || !filePath) return tree ?? [];
  if (normalizeRunResult(oldResult) === normalizeRunResult(newResult)) return tree;

  const { tree: nextTree, changed } = mapFolderTreeNodes(tree, filePath, (node) => {
    const nextStats = applyResultStatsDelta(node.result_stats, oldResult, newResult);
    if (!nextStats) return node;
    return { ...node, result_stats: nextStats };
  });

  return changed ? nextTree : tree;
}

/**
 * @param {array} tree
 * @param {Array<{ file_path: string, result?: string }>} removals
 * @returns {array}
 */
export function patchFolderTreeForRemovals(tree, removals) {
  if (!tree?.length || !removals?.length) return tree ?? [];

  let currentTree = tree;
  let anyChanged = false;

  for (const { file_path: filePath, result } of removals) {
    if (!filePath) continue;
    const { tree: nextTree, changed } = mapFolderTreeNodes(currentTree, filePath, (node) => {
      const nextStats = applyRemoveStatsDelta(node.result_stats, result);
      const nextCount = Math.max(0, (node.case_count ?? 0) - 1);
      if (
        nextStats.totalCases === ensureStats(node.result_stats).totalCases &&
        nextStats.passed === ensureStats(node.result_stats).passed &&
        nextStats.failed === ensureStats(node.result_stats).failed &&
        nextStats.skipped === ensureStats(node.result_stats).skipped &&
        nextStats.pending === ensureStats(node.result_stats).pending &&
        nextCount === (node.case_count ?? 0)
      ) {
        return node;
      }
      return {
        ...node,
        case_count: nextCount,
        result_stats: nextStats,
      };
    });
    if (changed) {
      anyChanged = true;
      currentTree = nextTree;
    }
  }

  return anyChanged ? currentTree : tree;
}

/**
 * @param {array} tree
 * @param {Array<{ file_path: string, result?: string }>} additions
 * @returns {{ tree: array, missingPrefixes: string[] }}
 */
export function patchFolderTreeForAdditions(tree, additions) {
  if (!additions?.length) {
    return { tree: tree ?? [], missingPrefixes: [] };
  }

  let currentTree = tree ?? [];
  const missingPrefixes = new Set();
  let anyChanged = false;

  for (const { file_path: filePath, result } of additions) {
    if (!filePath) continue;
    const { tree: nextTree, changed } = mapFolderTreeNodes(currentTree, filePath, (node) => {
      const nextStats = applyAddStatsDelta(node.result_stats, result);
      return {
        ...node,
        case_count: (node.case_count ?? 0) + 1,
        result_stats: nextStats,
      };
    });
    if (changed) {
      anyChanged = true;
      currentTree = nextTree;
    } else {
      const project = projectFromFilePath(filePath);
      if (project) missingPrefixes.add(project);
    }
  }

  return {
    tree: anyChanged ? currentTree : tree ?? [],
    missingPrefixes: Array.from(missingPrefixes),
  };
}
