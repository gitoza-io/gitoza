/**
 * Filter a top-level folder/run tree to a single open-focus root.
 * @param {Array<{ directory_path?: string }> | null | undefined} tree
 * @param {string | null | undefined} openedPath
 * @returns {Array<{ directory_path?: string }>}
 */
export function filterTreeToOpenedRoot(tree, openedPath) {
  if (!openedPath) return tree || [];
  return (tree || []).filter((n) => n.directory_path === openedPath);
}

/**
 * @param {string | null | undefined} path
 * @param {string | null | undefined} root
 * @returns {boolean}
 */
export function pathIsUnderOrEqual(path, root) {
  if (!root) return true;
  if (!path) return false;
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Folder path for search list queries while a project/run root is open-focused.
 * When focused, always stay under that root (Tickets-style scoped search).
 * @param {string | null | undefined} selectedFolderPath
 * @param {string | null | undefined} openedRootPath
 * @returns {string | null}
 */
export function effectiveSearchFolderPath(selectedFolderPath, openedRootPath) {
  if (!openedRootPath) return selectedFolderPath ?? null;
  if (!selectedFolderPath) return openedRootPath;
  if (pathIsUnderOrEqual(selectedFolderPath, openedRootPath)) return selectedFolderPath;
  return openedRootPath;
}

/**
 * Keep case/index rows under a directory path prefix (open-focus project scope).
 * @param {Array<{ file_path?: string, directory?: string }> | null | undefined} rows
 * @param {string | null | undefined} pathPrefix
 * @returns {Array<object>}
 */
export function filterRowsUnderPathPrefix(rows, pathPrefix) {
  if (!pathPrefix) return rows || [];
  const prefix = pathPrefix.endsWith("/") ? pathPrefix : `${pathPrefix}/`;
  return (rows || []).filter((row) => {
    const fp = row?.file_path || "";
    const dir = row?.directory || "";
    return (
      fp === pathPrefix ||
      fp.startsWith(prefix) ||
      dir === pathPrefix ||
      dir.startsWith(prefix)
    );
  });
}

/**
 * Keep run-case search rows for one run_id (open-focus run scope).
 * @param {Array<{ run_id?: string }> | null | undefined} rows
 * @param {string | null | undefined} runId
 * @returns {Array<object>}
 */
export function filterRowsByRunId(rows, runId) {
  if (!runId) return rows || [];
  return (rows || []).filter((row) => row?.run_id === runId);
}
