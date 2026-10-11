/**
 * Flatten visible folder/run rows for virtual scrolling in RepositoryFolderTree.
 * pathKey format matches collectExpandKeysForFolderPath in caseTree.js.
 */

/**
 * @typedef {{ kind: 'folder', pathKey: string, level: number, node: object, isExpanded: boolean }} FlatFolderRow
 * @typedef {{ kind: 'inlineCreate', level: number, parentPath: string, parentPathKey: string }} FlatInlineCreateRow
 */

/**
 * @param {array} tree
 * @param {Set<string>} expanded
 * @param {{ creatingInPath?: string | null }} [options]
 * @returns {(FlatFolderRow | FlatInlineCreateRow)[]}
 */
export function flattenVisibleFolderRows(tree, expanded, options = {}) {
  const creatingInPath = options.creatingInPath ?? null;
  const out = [];

  /**
   * @param {array} nodes
   * @param {string} prefix
   * @param {number} level
   */
  function walk(nodes, prefix, level) {
    for (const node of nodes ?? []) {
      const pathKey = prefix ? `${prefix}/${node.name}` : node.name;
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isCreatingChild = creatingInPath === node.directory_path;
      const isExpanded = expanded.has(pathKey);
      out.push({ kind: "folder", pathKey, level, node, isExpanded });

      if ((hasChildren || isCreatingChild) && (isExpanded || isCreatingChild)) {
        walk(node.children ?? [], pathKey, level + 1);
        if (isCreatingChild) {
          out.push({
            kind: "inlineCreate",
            level: level + 1,
            parentPath: node.directory_path,
            parentPathKey: pathKey,
          });
        }
      }
    }
  }

  walk(tree ?? [], "", 0);
  return out;
}

/**
 * @param {(FlatFolderRow | FlatInlineCreateRow)[]} flatRows
 * @param {string | null | undefined} directoryPath
 * @returns {number}
 */
export function findFlatRowIndex(flatRows, directoryPath) {
  if (!directoryPath || !flatRows?.length) return -1;
  return flatRows.findIndex(
    (row) => row.kind === "folder" && row.node?.directory_path === directoryPath,
  );
}
