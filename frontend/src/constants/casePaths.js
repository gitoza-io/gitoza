/** Active case repository root (relative to repo root). */
export const CASES_ROOT = ".gitoza/test/cases";

/** Archived cases live under this prefix, mirroring active project/suite structure. */
export const CASES_ARCHIVE_ROOT = ".gitoza/test/cases/.archive";

function normalizeRepoPath(path) {
  return (path || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

/** @param {string} filePath */
export function isArchivedCasePath(filePath) {
  const fp = normalizeRepoPath(filePath);
  return fp.startsWith(`${CASES_ARCHIVE_ROOT}/`) || fp === CASES_ARCHIVE_ROOT;
}

/** @param {string} directoryPath */
export function isArchivedDirectoryPath(directoryPath) {
  const norm = normalizeRepoPath(directoryPath);
  return norm.startsWith(`${CASES_ARCHIVE_ROOT}/`) || norm === CASES_ARCHIVE_ROOT;
}

/** @param {string} directoryPath */
export function isArchivedProjectDirectoryPath(directoryPath) {
  const norm = normalizeRepoPath(directoryPath);
  const parts = norm.split("/");
  return (
    parts.length === 5 &&
    parts[0] === ".gitoza" &&
    parts[1] === "test" &&
    parts[2] === "cases" &&
    parts[3] === ".archive"
  );
}

/** @param {string} directoryPath */
export function isArchivedSuiteDirectoryPath(directoryPath) {
  const norm = normalizeRepoPath(directoryPath);
  const parts = norm.split("/");
  return (
    parts.length >= 6 &&
    parts[0] === ".gitoza" &&
    parts[1] === "test" &&
    parts[2] === "cases" &&
    parts[3] === ".archive"
  );
}
