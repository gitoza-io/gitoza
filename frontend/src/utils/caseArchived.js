import { isArchivedCasePath } from "../constants/casePaths";

/**
 * True when the case file lives under `.gitoza/test/cases/.archive/`.
 */
export function isCaseArchived({ file_path: filePath } = {}) {
  return isArchivedCasePath(filePath);
}
