/**
 * Helpers for inline rename name-collision errors (ApiError code "conflict").
 */

export class RenameNameConflictError extends Error {
  /** @param {string} displayName */
  constructor(displayName) {
    super(`Rename name conflict: ${displayName}`);
    this.name = "RenameNameConflictError";
    this.displayName = displayName;
  }
}

/** @param {string | null | undefined} filePath @param {{ sourcePath: string, targetPath?: string | null } | null} session */
export function isCaseInRenameSession(filePath, session) {
  if (!session || !filePath) return false;
  if (filePath === session.sourcePath) return true;
  return session.targetPath != null && filePath === session.targetPath;
}

/** @param {unknown} err */
export function isRenameNameConflictError(err) {
  return err instanceof RenameNameConflictError;
}

/** @param {unknown} err */
export function isApiConflictError(err) {
  return (
    err != null &&
    typeof err === "object" &&
    /** @type {{ code?: string }} */ (err).code === "conflict"
  );
}

/**
 * @param {{ kind: "case", newName: string, filePath: string } | { kind: "folder", newName: string }} params
 * @returns {string}
 */
export function getRenameConflictDisplayName(params) {
  if (params.kind === "folder") {
    return params.newName.trim();
  }
  const extMatch = params.filePath.match(/\.(ya?ml)$/i);
  const ext = extMatch ? extMatch[0] : ".yaml";
  return `${params.newName.trim()}${ext}`;
}
