/**
 * Display-order pinning for project folder nodes in RepositoryFolderTree.
 * Pins reorder siblings only; does not affect backend/filesystem order.
 */

/**
 * @param {object} node
 * @returns {string}
 */
export function folderSortLabel(node) {
  return (node?.display_name ?? node?.name ?? "").trim();
}

/**
 * @param {object} node
 * @returns {boolean}
 */
export function isPinEligibleProject(node) {
  return node?.is_project === true && node?.is_run !== true;
}

/**
 * @param {array} nodes
 * @param {Set<string>} pinnedPaths
 * @returns {array}
 */
function sortSiblingNodes(nodes, pinnedPaths) {
  if (!nodes?.length || !pinnedPaths?.size) return nodes ?? [];

  const pinned = [];
  const unpinned = [];

  for (const node of nodes) {
    const path = node?.directory_path;
    if (isPinEligibleProject(node) && path && pinnedPaths.has(path)) {
      pinned.push(node);
    } else {
      unpinned.push(node);
    }
  }

  if (!pinned.length) return nodes;

  pinned.sort((a, b) =>
    folderSortLabel(a).localeCompare(folderSortLabel(b), undefined, { sensitivity: "base" }),
  );

  return [...pinned, ...unpinned];
}

/**
 * @param {object} node
 * @param {Set<string>} pinnedPaths
 * @returns {object}
 */
function mapNodeWithSortedChildren(node, pinnedPaths) {
  const children = node?.children ?? [];
  const sortedChildren = sortSiblingNodes(children, pinnedPaths).map((child) =>
    mapNodeWithSortedChildren(child, pinnedPaths),
  );
  return { ...node, children: sortedChildren };
}

/**
 * Reorder pin-eligible projects first (A–Z among pinned) at each sibling level.
 *
 * @param {array} tree
 * @param {Set<string>} pinnedPaths
 * @returns {array}
 */
export function sortTreeWithPinnedProjects(tree, pinnedPaths) {
  if (!tree?.length || !pinnedPaths?.size) return tree ?? [];
  const sortedRoots = sortSiblingNodes(tree, pinnedPaths);
  return sortedRoots.map((node) => mapNodeWithSortedChildren(node, pinnedPaths));
}

/**
 * Collect all project directory_path values present in the tree.
 *
 * @param {array} tree
 * @returns {Set<string>}
 */
export function collectProjectDirectoryPaths(tree) {
  const paths = new Set();
  function walk(nodes) {
    for (const node of nodes ?? []) {
      if (isPinEligibleProject(node) && node.directory_path) {
        paths.add(node.directory_path);
      }
      walk(node.children);
    }
  }
  walk(tree);
  return paths;
}

/**
 * Drop pinned paths that no longer exist in the tree.
 *
 * @param {string[]} pinnedPaths
 * @param {array} tree
 * @returns {string[]}
 */
export function prunePinnedProjects(pinnedPaths, tree) {
  if (!pinnedPaths?.length) return [];
  const valid = collectProjectDirectoryPaths(tree);
  return pinnedPaths.filter((p) => valid.has(p));
}
