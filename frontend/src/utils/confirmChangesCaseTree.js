import { countFromDirectoryIndex, pathsUnderDirectory } from "./casePickerSelection";
import { buildCaseTree, getCasesForFolderSelection, pruneEmptyNodes } from "./caseTree";
import { folderDisplayNameFromSanitized } from "./patchRepositoryTree";

const CASES_PREFIX = ".gitoza/test/cases/";
const CASES_ROOT = CASES_PREFIX.replace(/\/$/, "");

function normalizeCasePath(filePath) {
  return (filePath || "").replace(/\\/g, "/");
}

function isCaseYamlPath(filePath) {
  return /\.ya?ml$/i.test(normalizeCasePath(filePath));
}

/**
 * Ancestor folder paths for a case YAML (project + suites), shallow to deep.
 * @param {string} filePath
 * @returns {string[]}
 */
function ancestorDirectoryPathsForCase(filePath) {
  const norm = normalizeCasePath(filePath);
  if (!norm.startsWith(CASES_PREFIX) || !isCaseYamlPath(norm)) return [];
  const dirs = [];
  let dir = norm.slice(0, norm.lastIndexOf("/"));
  while (dir.length > CASES_ROOT.length && dir.startsWith(`${CASES_ROOT}/`)) {
    dirs.push(dir);
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
  return dirs;
}

/**
 * Build a minimal repository folder tree from changed case paths (no API).
 * Used when staged paths cannot join to a stale or filtered browse tree.
 * @param {string[]} changedPaths
 * @returns {array}
 */
export function buildFolderTreeFromCasePaths(changedPaths) {
  const dirSet = new Set();
  for (const filePath of changedPaths || []) {
    for (const dir of ancestorDirectoryPathsForCase(filePath)) {
      dirSet.add(dir);
    }
  }
  if (dirSet.size === 0) return [];

  const nodeByPath = new Map();
  for (const dirPath of dirSet) {
    const name = dirPath.slice(dirPath.lastIndexOf("/") + 1);
    const afterPrefix = dirPath.slice(CASES_PREFIX.length);
    nodeByPath.set(dirPath, {
      type: "folder",
      name,
      display_name: folderDisplayNameFromSanitized(name),
      directory_path: dirPath,
      is_project: !afterPrefix.includes("/"),
      children: [],
      case_count: 0,
    });
  }

  const roots = [];
  for (const [dirPath, node] of nodeByPath) {
    const parentPath = dirPath.slice(0, dirPath.lastIndexOf("/"));
    const parent = nodeByPath.get(parentPath);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortChildren(nodes) {
    nodes.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    for (const node of nodes) {
      sortChildren(node.children ?? []);
    }
  }
  sortChildren(roots);
  return roots;
}

/**
 * Resolve changed-case folder tree: API tree first, synthetic path tree as fallback.
 * @param {array} repositoryTree
 * @param {string[]} changedPaths
 * @returns {array}
 */
export function resolveChangedCasesFolderTree(repositoryTree, changedPaths) {
  const joined = buildChangedCasesFolderTree(repositoryTree, changedPaths);
  if (joined.length > 0) return joined;
  if (!changedPaths?.length) return [];
  const synthetic = buildFolderTreeFromCasePaths(changedPaths);
  if (!synthetic.length) return [];
  return buildChangedCasesFolderTree(synthetic, changedPaths);
}

/**
 * Derive display metadata from a case file path (no IPC).
 * @param {string} filePath
 * @returns {{ title: string, caseId: string }}
 */
export function caseMetaFromPath(filePath) {
  const normalized = (filePath || "").replace(/\\/g, "/").replace(/\.ya?ml$/i, "");
  const withoutPrefix = normalized.startsWith(CASES_PREFIX)
    ? normalized.slice(CASES_PREFIX.length)
    : normalized;
  const segments = withoutPrefix.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] || withoutPrefix || filePath;
  return { title: leaf, caseId: leaf };
}

/**
 * Map changed case paths to minimal index rows for tree/list helpers.
 * @param {string[]} changedPaths
 * @returns {Array<{ file_path: string, case_id: string, title: string }>}
 */
export function pathsToMinimalCaseRows(changedPaths) {
  return (changedPaths || []).map((filePath) => {
    const meta = caseMetaFromPath(filePath);
    return {
      file_path: filePath.replace(/\\/g, "/"),
      case_id: meta.caseId,
      title: meta.title,
    };
  });
}

/**
 * Build a pruned folder tree containing only projects/suites with changed cases.
 * @param {array} repositoryTree - Repository tree from API (folder nodes only)
 * @param {string[]} changedPaths
 * @returns {array}
 */
export function buildChangedCasesFolderTree(repositoryTree, changedPaths) {
  if (!repositoryTree?.length || !changedPaths?.length) return [];
  const rows = pathsToMinimalCaseRows(changedPaths);
  const withCases = buildCaseTree(repositoryTree, rows);
  return pruneEmptyNodes(withCases);
}

/**
 * Walk pruned tree and return the first folder directory_path (depth-first).
 * @param {array} treeWithCases
 * @returns {string | null}
 */
export function findFirstChangedFolder(treeWithCases) {
  if (!treeWithCases?.length) return null;
  let found = null;
  function walk(nodes) {
    for (const node of nodes) {
      if (found) return;
      if (node.directory_path) {
        found = node.directory_path;
        return;
      }
      walk(node.children ?? []);
    }
  }
  walk(treeWithCases);
  return found;
}

/**
 * Count changed cases under a folder prefix.
 * @param {Array<{ file_path?: string }>} rows
 * @param {string} directoryPath
 * @returns {number}
 */
export function countChangedCasesUnderFolder(rows, directoryPath, directoryIndex = null) {
  if (directoryIndex) {
    return countFromDirectoryIndex(directoryIndex.counts, directoryPath);
  }
  return pathsUnderDirectory(rows, directoryPath).length;
}

/**
 * First changed case file path under a folder (sorted by case_id / path).
 * @param {Array<{ file_path?: string, case_id?: string }>} rows
 * @param {array} tree
 * @param {string} directoryPath
 * @returns {string | null}
 */
export function findFirstChangedCaseInFolder(rows, tree, directoryPath) {
  const cases = getCasesForFolderSelection(rows, tree, directoryPath);
  if (!cases.length) return null;
  return cases[0].file_path ?? null;
}
