/**
 * Normalize case file_path for consistent Set lookups (forward slashes).
 * @param {string} filePath
 * @returns {string}
 */
export function normalizeCaseFilePath(filePath) {
  return (filePath || "").replace(/\\/g, "/");
}

/**
 * Collect case file_paths under a directory prefix (project or suite folder).
 * @param {Array<{ file_path?: string }>} rows
 * @param {string} directoryPath
 * @returns {string[]}
 */
export function pathsUnderDirectory(rows, directoryPath) {
  const dir = (directoryPath || "").trim().replace(/\\/g, "/");
  if (!dir) return [];
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return (rows || [])
    .map((r) => normalizeCaseFilePath(r?.file_path))
    .filter((fp) => fp && fp.startsWith(prefix));
}

/**
 * Parent directory_path of a normalized repo path (empty string at filesystem root segment).
 * @param {string} directoryPath
 * @returns {string}
 */
export function parentDirectoryPath(directoryPath) {
  const normalized = (directoryPath || "").trim().replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
}

/**
 * Precompute recursive case counts and paths grouped by directory prefix.
 * Used by folder tree badges and picker checkbox state to avoid O(rows) scans per row.
 *
 * @param {Array<{ file_path?: string }>} rows
 * @param {{ filterPath?: (filePath: string) => boolean }} [options]
 * @returns {{ counts: Map<string, number>, pathsByDirectory: Map<string, string[]> }}
 */
export function buildDirectoryRowIndex(rows, options = {}) {
  const filterPath = options.filterPath ?? (() => true);
  const counts = new Map();
  const pathsByDirectory = new Map();

  for (const row of rows || []) {
    const fp = normalizeCaseFilePath(row?.file_path);
    if (!fp || !filterPath(fp)) continue;

    const lastSlash = fp.lastIndexOf("/");
    if (lastSlash < 0) continue;

    let dir = fp.slice(0, lastSlash);
    while (dir) {
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
      const bucket = pathsByDirectory.get(dir);
      if (bucket) bucket.push(fp);
      else pathsByDirectory.set(dir, [fp]);
      dir = parentDirectoryPath(dir);
    }
  }

  return { counts, pathsByDirectory };
}

/**
 * @param {Map<string, number> | null | undefined} counts
 * @param {string} directoryPath
 * @returns {number}
 */
export function countFromDirectoryIndex(counts, directoryPath) {
  const dir = (directoryPath || "").trim().replace(/\\/g, "/");
  if (!dir || !counts) return 0;
  return counts.get(dir) ?? 0;
}

/**
 * Toggle select-all for cases under a folder prefix (lazy-load aware).
 *
 * @param {object} options
 * @param {string} options.directoryPath
 * @param {Array<{ file_path?: string }>} options.rows - currently visible rows (fallback)
 * @param {(updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void} options.setSelectedFilePaths
 * @param {(directoryPath: string) => Promise<Array<{ file_path?: string }>>} options.loadCasesForPrefix
 * @param {(filePath: string) => boolean} [options.filterPath]
 */
export async function toggleFolderSelection({
  directoryPath,
  rows,
  setSelectedFilePaths,
  loadCasesForPrefix,
  filterPath = () => true,
}) {
  const dir = (directoryPath || "").trim();
  if (!dir || !loadCasesForPrefix) return;

  const loaded = await loadCasesForPrefix(dir);
  const sourceRows = loaded?.length ? loaded : rows;
  const paths = pathsUnderDirectory(sourceRows, dir).filter(filterPath);
  if (paths.length === 0) return;

  setSelectedFilePaths((prev) => {
    const allSelected = paths.every((p) => prev.has(p));
    const next = new Set(prev);
    if (allSelected) paths.forEach((p) => next.delete(p));
    else paths.forEach((p) => next.add(p));
    return next;
  });
}

/** @see toggleFolderSelection */
export const toggleProjectSelection = toggleFolderSelection;

/** @see toggleFolderSelection */
export const toggleSuiteSelection = toggleFolderSelection;
