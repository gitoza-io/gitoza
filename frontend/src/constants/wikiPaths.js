/** Active wiki root (relative to repo root). */
export const WIKI_ROOT = ".gitoza/wiki";

/** Archived wiki pages live under this prefix, mirroring active folder structure. */
export const WIKI_ARCHIVE_ROOT = ".gitoza/wiki/.archive";

/**
 * Folder to create a wiki page in. Defaults to wiki root when none is selected.
 * @param {string | null | undefined} selectedFolderPath
 * @returns {string}
 */
export function wikiCreateTargetFolder(selectedFolderPath) {
  const fp = (selectedFolderPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return fp || WIKI_ROOT;
}

function normalizeRepoPath(path) {
  return (path || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

/** @param {string} filePath */
export function isArchivedWikiPath(filePath) {
  const fp = normalizeRepoPath(filePath);
  return fp.startsWith(`${WIKI_ARCHIVE_ROOT}/`) || fp === WIKI_ARCHIVE_ROOT;
}

/** @param {string} directoryPath */
export function isArchivedWikiFolderPath(directoryPath) {
  const norm = normalizeRepoPath(directoryPath);
  return norm.startsWith(`${WIKI_ARCHIVE_ROOT}/`) || norm === WIKI_ARCHIVE_ROOT;
}

/**
 * True when path is a wiki YAML under `.gitoza/wiki/`.
 * @param {string} path
 */
export function isWikiYamlPath(path) {
  const fp = normalizeRepoPath(path);
  if (!fp.startsWith(`${WIKI_ROOT}/`) && fp !== `${WIKI_ROOT}`) return false;
  return /\.ya?ml$/i.test(fp);
}

/**
 * True when path is a `.gitkeep` under `.gitoza/wiki/` (empty folder placeholder).
 * @param {string} path
 */
export function isWikiGitkeepPath(path) {
  const fp = normalizeRepoPath(path);
  if (!fp.startsWith(`${WIKI_ROOT}/`)) return false;
  return /(^|\/)\.gitkeep$/i.test(fp);
}

/**
 * Wiki paths that Sync/Confirm should treat as processable (pages + empty folders).
 * @param {string} path
 */
export function isWikiTrackedPath(path) {
  return isWikiYamlPath(path) || isWikiGitkeepPath(path);
}

/**
 * Page id stem from a wiki YAML path (filename without extension).
 * @param {string} filePath
 * @returns {string}
 */
export function wikiPageIdFromPath(filePath) {
  const fp = normalizeRepoPath(filePath);
  return (fp.split("/").pop() || fp).replace(/\.ya?ml$/i, "") || fp;
}

/**
 * Display label for Confirm / conflict sidebars (nested folders joined with ›).
 * Example: `.gitoza/wiki/architecture/data/model.yaml` → `architecture › data › model`.
 * @param {string} filePath
 */
export function wikiBreadcrumbLabel(filePath) {
  const fp = normalizeRepoPath(filePath);
  const prefix = `${WIKI_ROOT}/`;
  const rest = fp.startsWith(prefix) ? fp.slice(prefix.length) : fp;
  const withoutExt = rest.replace(/\.ya?ml$/i, "");
  const parts = withoutExt.split("/").filter(Boolean);
  return parts.length > 0 ? parts.join(" › ") : withoutExt || fp;
}

/**
 * Folder path that a wiki `.gitkeep` keeps alive (parent of the file).
 * @param {string} path
 * @returns {string|null}
 */
export function wikiFolderFromGitkeepPath(path) {
  if (!isWikiGitkeepPath(path)) return null;
  const fp = normalizeRepoPath(path);
  const idx = fp.lastIndexOf("/");
  return idx > 0 ? fp.slice(0, idx) : WIKI_ROOT;
}

/**
 * Confirm changelist label for a wiki `.gitkeep` (folder breadcrumb).
 * @param {string} path
 */
export function wikiGitkeepFolderLabel(path) {
  const folder = wikiFolderFromGitkeepPath(path);
  if (!folder) return wikiBreadcrumbLabel(path);
  if (folder === WIKI_ROOT) return "Wiki root";
  return wikiBreadcrumbLabel(folder);
}

/**
 * Parent wiki folder for open-folder Back (null leaves focus / at wiki root).
 * @param {string} path
 * @returns {string|null}
 */
export function wikiParentFolder(path) {
  const fp = normalizeRepoPath(path);
  if (!fp || fp === WIKI_ROOT) return null;
  if (!fp.startsWith(`${WIKI_ROOT}/`)) return null;
  const idx = fp.lastIndexOf("/");
  if (idx <= 0) return null;
  const parent = fp.slice(0, idx);
  if (!parent.startsWith(WIKI_ROOT) || parent === WIKI_ROOT) return null;
  return parent;
}

/**
 * Sticky open-folder label: `architecture/data`.
 * @param {string} path
 */
export function wikiFolderFocusLabel(path) {
  const fp = normalizeRepoPath(path);
  const archivePrefix = `${WIKI_ARCHIVE_ROOT}/`;
  const activePrefix = `${WIKI_ROOT}/`;
  const rest = fp.startsWith(archivePrefix)
    ? fp.slice(archivePrefix.length)
    : fp.startsWith(activePrefix)
      ? fp.slice(activePrefix.length)
      : fp;
  const parts = rest.split("/").filter(Boolean);
  return parts.length > 0 ? parts.join("/") : rest || fp;
}

/**
 * Find a folder node by directory_path in a wiki/case tree.
 * @param {Array} nodes
 * @param {string} directoryPath
 * @returns {object|null}
 */
export function findWikiFolderNode(nodes, directoryPath) {
  const want = normalizeRepoPath(directoryPath);
  if (!want) return null;
  for (const n of nodes || []) {
    if (normalizeRepoPath(n?.directory_path) === want) return n;
    const found = findWikiFolderNode(n?.children, want);
    if (found) return found;
  }
  return null;
}

/**
 * Parent folder path (repo-relative) for a wiki page or folder.
 * @param {string} path
 * @returns {string|null}
 */
export function wikiFolderFromPath(path) {
  const fp = normalizeRepoPath(path);
  if (fp === WIKI_ROOT) return WIKI_ROOT;
  if (!fp.startsWith(`${WIKI_ROOT}/`)) return null;
  if (/\.ya?ml$/i.test(fp)) {
    const idx = fp.lastIndexOf("/");
    return idx > 0 ? fp.slice(0, idx) : WIKI_ROOT;
  }
  return fp;
}

/**
 * True when path is a wiki folder (not a YAML page).
 * @param {string} path
 */
export function isWikiFolderPath(path) {
  const fp = normalizeRepoPath(path);
  if (fp === WIKI_ROOT || fp === WIKI_ARCHIVE_ROOT) return true;
  if (!fp.startsWith(`${WIKI_ROOT}/`)) return false;
  return !/\.ya?ml$/i.test(fp);
}

/**
 * CaseTree expand keys for a wiki file (folder names from wiki root).
 * @param {string} filePath
 * @returns {string[]}
 */
export function wikiExpandKeysFromFilePath(filePath) {
  const folder = wikiFolderFromPath(filePath);
  if (!folder || folder === WIKI_ROOT || folder === WIKI_ARCHIVE_ROOT) return [];
  const prefix = isArchivedWikiFolderPath(folder)
    ? `${WIKI_ARCHIVE_ROOT}/`
    : `${WIKI_ROOT}/`;
  const rest = folder.startsWith(prefix) ? folder.slice(prefix.length) : folder;
  if (!rest) return [];
  const parts = rest.split("/").filter(Boolean);
  const keys = [];
  for (let i = 0; i < parts.length; i += 1) {
    keys.push(parts.slice(0, i + 1).join("/"));
  }
  return keys;
}
