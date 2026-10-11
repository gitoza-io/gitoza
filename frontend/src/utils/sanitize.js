/**
 * Sanitize a name for use in file/folder paths. Matches backend logic:
 * alphanumeric, spaces and hyphens replaced by underscore. Used for run names and folder/suite names.
 *
 * @param {string} name - Raw name (may contain spaces, hyphens, etc.)
 * @param {string} [fallback=''] - Value to return when result is empty (e.g. 'run' for run name)
 * @returns {string} Sanitized name (e.g. "my folder" → "my_folder")
 */
export function sanitizeNameForPath(name, fallback = "") {
  if (name == null || typeof name !== "string") return fallback;
  const s = name
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_|_$/g, "")
    .trim();
  return s || fallback;
}

/**
 * Human-readable label for a ticket project folder name (underscores/hyphens → spaces).
 * Folder path / `name` identity is unchanged; this is display-only.
 *
 * @param {string | null | undefined} folderName
 * @returns {string}
 */
export function ticketProjectDisplayName(folderName) {
  if (folderName == null || typeof folderName !== "string") return "";
  return folderName.replace(/[_-]/g, " ");
}
