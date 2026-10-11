import { normalizeCaseFilePath } from "./casePickerSelection.js";

/**
 * Whether a case file_path falls under a folder prefix (recursive folder semantics).
 * @param {string|null|undefined} filePath
 * @param {string|null|undefined} folderPath
 * @returns {boolean}
 */
export function casePathUnderFolder(filePath, folderPath) {
  const fp = normalizeCaseFilePath(filePath);
  const dir = (folderPath || "").trim().replace(/\\/g, "/");
  if (!fp || !dir) return false;
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  return fp.startsWith(prefix);
}

/**
 * Filter case rows to those visible under the current list folder window.
 * @param {Array<{ file_path?: string }>|null|undefined} rows
 * @param {string|null|undefined} folderPath
 * @returns {Array<object>}
 */
export function filterRowsForFolder(rows, folderPath) {
  if (!folderPath || !rows?.length) return [];
  return rows.filter((row) => casePathUnderFolder(row?.file_path, folderPath));
}
