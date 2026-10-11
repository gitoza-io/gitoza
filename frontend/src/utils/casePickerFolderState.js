import {
  countFromDirectoryIndex,
  normalizeCaseFilePath,
  pathsUnderDirectory,
} from "./casePickerSelection";

/**
 * Count selected file paths under a directory prefix.
 * @param {Set<string>|Iterable<string>} selectedFilePaths
 * @param {string} directoryPath
 * @returns {number}
 */
export function countSelectedUnderDirectory(selectedFilePaths, directoryPath) {
  const dir = (directoryPath || "").trim().replace(/\\/g, "/");
  if (!dir || !selectedFilePaths) return 0;
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  let count = 0;
  for (const raw of selectedFilePaths) {
    const fp = normalizeCaseFilePath(raw);
    if (fp && fp.startsWith(prefix)) count += 1;
  }
  return count;
}

/**
 * Count selectable case paths under a directory from loaded rows.
 * @param {Array<{ file_path?: string }>} rows
 * @param {string} directoryPath
 * @param {(filePath: string) => boolean} [filterPath]
 * @returns {number}
 */
export function countSelectableUnderDirectory(rows, directoryPath, filterPath = () => true) {
  return pathsUnderDirectory(rows, directoryPath).filter(filterPath).length;
}

/**
 * Whether a directory's cases are represented in the lazy catalog cache (exact prefix or loaded ancestor).
 * @param {string} directoryPath
 * @param {Set<string>|Iterable<string>|null|undefined} loadedPrefixes
 * @returns {boolean}
 */
export function isPrefixCoveredByLoadedPrefixes(directoryPath, loadedPrefixes) {
  const dir = (directoryPath || "").trim().replace(/\\/g, "/");
  if (!dir || !loadedPrefixes) return false;
  for (const loaded of loadedPrefixes) {
    const prefix = (loaded || "").trim().replace(/\\/g, "/");
    if (!prefix) continue;
    if (dir === prefix || dir.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/**
 * Hybrid folder badge count for picker mode: authoritative tree counts until lazy data is available.
 * @param {object} options
 * @param {string} options.directoryPath
 * @param {Array<{ file_path?: string }>} options.pickerRows
 * @param {(filePath: string) => boolean} [options.filterPath]
 * @param {Set<string>|Iterable<string>|null|undefined} [options.loadedPrefixes]
 * @param {number} [options.serverCaseCount]
 * @returns {number}
 */
export function getPickerFolderBadgeCount({
  directoryPath,
  pickerRows,
  filterPath = () => true,
  loadedPrefixes,
  serverCaseCount = 0,
  directoryIndex = null,
}) {
  const hasLazyRowSource =
    directoryIndex != null || (pickerRows?.length ?? 0) > 0;
  if (!hasLazyRowSource) {
    return serverCaseCount ?? 0;
  }

  const lazyCount = directoryIndex
    ? countFromDirectoryIndex(directoryIndex.counts, directoryPath)
    : countSelectableUnderDirectory(pickerRows, directoryPath, filterPath);
  if (lazyCount > 0 || isPrefixCoveredByLoadedPrefixes(directoryPath, loadedPrefixes)) {
    return lazyCount;
  }
  return serverCaseCount ?? 0;
}

/**
 * Tri-state folder checkbox state for case picker (project/suite rows).
 * Mirrors CaseTree picker logic without requiring cases attached to tree nodes.
 *
 * @param {object} options
 * @param {string} options.directoryPath
 * @param {Array<{ file_path?: string }>} options.rows
 * @param {Set<string>|Iterable<string>} [options.selectedFilePaths]
 * @param {(filePath: string) => boolean} [options.filterPath]
 * @returns {{ checked: boolean, indeterminate: boolean, selectableCount: number, pathsForState: string[] }}
 */
export function getFolderPickerCheckboxState({
  directoryPath,
  rows,
  selectedFilePaths,
  filterPath = () => true,
  directoryIndex = null,
}) {
  const dir = (directoryPath || "").trim();
  if (!dir) {
    return { checked: false, indeterminate: false, selectableCount: 0, pathsForState: [] };
  }

  const loadedPaths = directoryIndex
    ? [...(directoryIndex.pathsByDirectory.get(dir.replace(/\\/g, "/")) ?? [])]
    : pathsUnderDirectory(rows, dir).filter(filterPath);
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  const selectedUnderPrefix = [];
  if (selectedFilePaths) {
    for (const raw of selectedFilePaths) {
      const fp = normalizeCaseFilePath(raw);
      if (fp && fp.startsWith(prefix) && filterPath(fp)) {
        selectedUnderPrefix.push(fp);
      }
    }
  }

  const pathsForState = [...new Set([...loadedPaths, ...selectedUnderPrefix])];
  const selectableCount = loadedPaths.length;

  if (pathsForState.length === 0) {
    return { checked: false, indeterminate: false, selectableCount, pathsForState };
  }

  const selectedSet =
    selectedFilePaths instanceof Set
      ? selectedFilePaths
      : new Set(selectedFilePaths ?? []);

  const checked = pathsForState.every((fp) => selectedSet.has(fp));
  const indeterminate =
    pathsForState.some((fp) => selectedSet.has(fp)) && !checked;

  return { checked, indeterminate, selectableCount, pathsForState };
}

/**
 * Build folder-scoped selection label for the case list header.
 * @param {number} selectedCount
 * @param {number} totalCount
 * @returns {string|null}
 */
export function formatPickerSelectionLabel(selectedCount, totalCount) {
  if (totalCount <= 0) return null;
  return `${selectedCount} of ${totalCount} selected`;
}
