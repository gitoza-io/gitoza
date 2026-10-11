/**
 * Optimistic patches for repository folder tree (rename, create folder, add case).
 */

import { projectPathFromDirectory } from "./caseTree";

function nodeDirectoryPath(node) {
  return normalizePath(node?.repo_directory_path ?? node?.directory_path);
}

/**
 * @param {string} folderPath
 * @param {string} sanitizedName
 * @returns {string}
 */
export function computeRenamedFolderPath(folderPath, sanitizedName) {
  const norm = (folderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm) return sanitizedName;
  const slash = norm.lastIndexOf("/");
  const parent = slash >= 0 ? norm.slice(0, slash) : "";
  return parent ? `${parent}/${sanitizedName}` : sanitizedName;
}

/**
 * @param {string} sanitized
 * @returns {string}
 */
export function folderDisplayNameFromSanitized(sanitized) {
  return (sanitized || "").replace(/_/g, " ").replace(/-/g, " ");
}

/**
 * @param {string | null | undefined} path
 * @param {string} oldPath
 * @param {string} newPath
 * @returns {string | null | undefined}
 */
export function remapPathUnderPrefix(path, oldPath, newPath) {
  if (!path) return path;
  const fp = path.replace(/\\/g, "/");
  const oldNorm = oldPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const newNorm = newPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (fp === oldNorm) return newNorm;
  const prefix = `${oldNorm}/`;
  if (fp.startsWith(prefix)) return newNorm + fp.slice(oldNorm.length);
  return path;
}

/**
 * @param {Set<string>} expanded
 * @param {string} oldPathKey
 * @param {string} newPathKey
 * @returns {Set<string>}
 */
export function remapExpandKeys(expanded, oldPathKey, newPathKey) {
  if (!expanded?.size || !oldPathKey || oldPathKey === newPathKey) {
    return expanded instanceof Set ? new Set(expanded) : new Set();
  }
  const next = new Set();
  for (const key of expanded) {
    if (key === oldPathKey) {
      next.add(newPathKey);
    } else if (key.startsWith(`${oldPathKey}/`)) {
      next.add(newPathKey + key.slice(oldPathKey.length));
    } else {
      next.add(key);
    }
  }
  return next;
}

/**
 * @param {object} node
 * @param {string} oldNorm
 * @param {string} newNorm
 * @param {string} sanitizedName
 * @returns {{ node: object, changed: boolean }}
 */
function patchFolderNode(node, oldNorm, newNorm, sanitizedName) {
  const dirPath = node.directory_path || "";

  let nextNode = node;
  let changed = false;
  if (dirPath === oldNorm) {
    nextNode = {
      ...node,
      name: sanitizedName,
      display_name: folderDisplayNameFromSanitized(sanitizedName),
      directory_path: newNorm,
    };
    changed = true;
  } else if (dirPath.startsWith(`${oldNorm}/`)) {
    nextNode = {
      ...node,
      directory_path: newNorm + dirPath.slice(oldNorm.length),
    };
    changed = true;
  }

  const children = node.children ?? [];
  if (!children.length) return { node: nextNode, changed };

  let childrenChanged = false;
  const patchedChildren = children.map((child) => {
    const result = patchFolderNode(child, oldNorm, newNorm, sanitizedName);
    if (result.changed) childrenChanged = true;
    return result.node;
  });

  if (!childrenChanged) {
    return { node: nextNode, changed };
  }

  return {
    node: { ...nextNode, children: patchedChildren },
    changed: true,
  };
}

/**
 * @param {array} tree
 * @param {string} oldPath
 * @param {string} newPath
 * @param {string} sanitizedName
 * @returns {array}
 */
export function patchRepositoryTreeForFolderRename(tree, oldPath, newPath, sanitizedName) {
  if (!tree?.length || !oldPath || !newPath) return tree ?? [];
  const oldNorm = oldPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const newNorm = newPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (oldNorm === newNorm) return tree;

  let changed = false;
  const next = tree.map((node) => {
    const result = patchFolderNode(node, oldNorm, newNorm, sanitizedName);
    if (result.changed) changed = true;
    return result.node;
  });
  return changed ? next : tree;
}

function normalizePath(path) {
  return (path || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function parentFolderOf(filePath) {
  const p = normalizePath(filePath);
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

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
 * Insert a new suite folder under an existing parent node (sorted by display_name).
 *
 * @param {array} tree
 * @param {string} parentPath
 * @param {string} newFolderPath
 * @returns {{ tree: array, changed: boolean }}
 */
export function patchRepositoryTreeForFolderCreate(tree, parentPath, newFolderPath) {
  if (!parentPath || !newFolderPath) {
    return { tree: tree ?? [], changed: false };
  }

  const parentNorm = normalizePath(parentPath);
  const newNorm = normalizePath(newFolderPath);
  if (!parentNorm || !newNorm || newNorm === parentNorm) {
    return { tree, changed: false };
  }

  const segment = newNorm.slice(newNorm.lastIndexOf("/") + 1);
  if (!segment) return { tree, changed: false };

  function insertUnderParent(nodes, parentCrumbs) {
    let changed = false;
    const next = (nodes ?? []).map((node) => {
      const dirPath = nodeDirectoryPath(node);
      if (dirPath === parentNorm) {
        const children = [...(node.children ?? [])];
        if (children.some((c) => normalizePath(c.directory_path) === newNorm)) {
          return node;
        }
        const displayName = folderDisplayNameFromSanitized(segment);
        const childNode = {
          type: "folder",
          name: segment,
          display_name: displayName,
          directory_path: newNorm,
          path_from_root: [...parentCrumbs, displayName],
          is_project: false,
          case_count: 0,
          children: [],
        };
        children.push(childNode);
        children.sort((a, b) =>
          (a.display_name ?? a.name ?? "").localeCompare(b.display_name ?? b.name ?? ""),
        );
        changed = true;
        return { ...node, children };
      }
      const crumbs = node.path_from_root ?? [node.display_name ?? node.name ?? ""];
      const childResult = insertUnderParent(node.children ?? [], crumbs);
      if (childResult.changed) {
        changed = true;
        return { ...node, children: childResult.tree };
      }
      return node;
    });
    return { tree: changed ? next : nodes, changed };
  }

  let result = insertUnderParent(tree, []);
  if (!result.changed && parentNorm) {
    const projectPath = projectPathFromDirectory(parentNorm);
    if (projectPath && !(tree ?? []).length) {
      const segment = projectPath.split("/").pop() || projectPath;
      const displayName = folderDisplayNameFromSanitized(
        segment.replace(/\.gitoza\.test$/i, ""),
      );
      const seeded = [
        {
          type: "folder",
          name: segment,
          display_name: displayName,
          directory_path: projectPath,
          path_from_root: [displayName],
          is_project: true,
          case_count: 0,
          children: [],
        },
      ];
      result = insertUnderParent(seeded, []);
    }
  }
  return { tree: result.changed ? result.tree : tree, changed: result.changed };
}

/**
 * Increment case_count on folder ancestors for newly added case file paths.
 *
 * @param {array} tree
 * @param {string[]} filePaths
 * @returns {{ tree: array, missingPrefixes: string[] }}
 */
export function patchRepositoryTreeForCaseAdditions(tree, filePaths) {
  if (!filePaths?.length) {
    return { tree: tree ?? [], missingPrefixes: [] };
  }

  let currentTree = tree ?? [];
  const missingPrefixes = new Set();
  let anyChanged = false;

  for (const filePath of filePaths) {
    if (!filePath) continue;
    const { tree: nextTree, changed } = mapFolderTreeNodes(currentTree, filePath, (node) => ({
      ...node,
      case_count: (node.case_count ?? 0) + 1,
    }));
    if (changed) {
      anyChanged = true;
      currentTree = nextTree;
    } else {
      const project = projectPathFromDirectory(filePath);
      if (project) missingPrefixes.add(project);
    }
  }

  return {
    tree: anyChanged ? currentTree : tree ?? [],
    missingPrefixes: Array.from(missingPrefixes),
  };
}

/**
 * Decrement case_count on folder ancestors for removed case file paths.
 *
 * @param {array} tree
 * @param {string[]} filePaths
 * @returns {{ tree: array, missingPrefixes: string[] }}
 */
/**
 * Remove a folder node (suite or project) and subtract its case_count from ancestors.
 *
 * @param {array} tree
 * @param {string} folderPath
 * @returns {{ tree: array, changed: boolean }}
 */
export function patchRepositoryTreeForFolderDelete(tree, folderPath) {
  const targetNorm = normalizePath(folderPath);
  if (!targetNorm || !tree?.length) {
    return { tree: tree ?? [], changed: false };
  }

  let rootChanged = false;
  const nextRoot = [];
  for (const node of tree) {
    const dirPath = normalizePath(node.directory_path);
    if (dirPath === targetNorm) {
      rootChanged = true;
      continue;
    }
    const result = deleteFolderFromNode(node, targetNorm);
    if (result.changed) rootChanged = true;
    nextRoot.push(result.node);
  }

  return { tree: rootChanged ? nextRoot : tree, changed: rootChanged };
}

/**
 * @param {object} node
 * @param {string} targetNorm
 * @returns {{ node: object, changed: boolean, removedCount: number }}
 */
function deleteFolderFromNode(node, targetNorm) {
  const children = node.children ?? [];
  const directIdx = children.findIndex((c) => normalizePath(c.directory_path) === targetNorm);
  if (directIdx >= 0) {
    const removed = children[directIdx];
    const removedCount = removed.case_count ?? 0;
    const newChildren = children.filter((_, i) => i !== directIdx);
    return {
      node: {
        ...node,
        children: newChildren,
        case_count: Math.max(0, (node.case_count ?? 0) - removedCount),
      },
      changed: true,
      removedCount,
    };
  }

  let changed = false;
  let totalRemoved = 0;
  const newChildren = children.map((child) => {
    const result = deleteFolderFromNode(child, targetNorm);
    if (result.changed) {
      changed = true;
      totalRemoved += result.removedCount;
      return result.node;
    }
    return child;
  });

  if (!changed) {
    return { node, changed: false, removedCount: 0 };
  }

  return {
    node: {
      ...node,
      children: newChildren,
      case_count: Math.max(0, (node.case_count ?? 0) - totalRemoved),
    },
    changed: true,
    removedCount: totalRemoved,
  };
}

export function patchRepositoryTreeForCaseRemovals(tree, filePaths) {
  if (!filePaths?.length) {
    return { tree: tree ?? [], missingPrefixes: [] };
  }

  let currentTree = tree ?? [];
  const missingPrefixes = new Set();
  let anyChanged = false;

  for (const filePath of filePaths) {
    if (!filePath) continue;
    const { tree: nextTree, changed } = mapFolderTreeNodes(currentTree, filePath, (node) => {
      const nextCount = Math.max(0, (node.case_count ?? 0) - 1);
      if (nextCount === (node.case_count ?? 0)) return node;
      return { ...node, case_count: nextCount };
    });
    if (changed) {
      anyChanged = true;
      currentTree = nextTree;
    } else {
      const project = projectPathFromDirectory(filePath);
      if (project) missingPrefixes.add(project);
    }
  }

  return {
    tree: anyChanged ? currentTree : tree ?? [],
    missingPrefixes: Array.from(missingPrefixes),
  };
}

function pruneZeroCountFolderNodes(nodes) {
  if (!nodes?.length) return [];
  return nodes
    .map((node) => ({
      ...node,
      children: pruneZeroCountFolderNodes(node.children ?? []),
    }))
    .filter((node) => (node.case_count ?? 0) > 0);
}

function patchRepositoryTreeForCaseRemovalsWithPrune(tree, filePaths) {
  const { tree: nextTree, missingPrefixes } = patchRepositoryTreeForCaseRemovals(tree, filePaths);
  return {
    tree: pruneZeroCountFolderNodes(nextTree),
    missingPrefixes,
  };
}

/**
 * Decrement active browse tree counts and remove folders/projects whose badge reaches zero.
 *
 * @param {array} tree
 * @param {string[]} filePaths
 * @returns {{ tree: array, missingPrefixes: string[] }}
 */
export function patchRepositoryTreeForActiveCaseRemovals(tree, filePaths) {
  return patchRepositoryTreeForCaseRemovalsWithPrune(tree, filePaths);
}

/**
 * Decrement archive tree counts and remove folders/projects whose badge reaches zero.
 *
 * @param {array} tree
 * @param {string[]} filePaths
 * @returns {{ tree: array, missingPrefixes: string[] }}
 */
export function patchRepositoryTreeForArchiveCaseRemovals(tree, filePaths) {
  return patchRepositoryTreeForCaseRemovalsWithPrune(tree, filePaths);
}
