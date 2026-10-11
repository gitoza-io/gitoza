/** Path helpers for project-scoped releases under `.gitoza/tasks/tickets/{project}/releases/`. */

export const TICKETS_PREFIX = ".gitoza/tasks/tickets/";
export const RELEASES_DIR_NAME = "releases";

/**
 * Relative file path for a release YAML.
 * @param {string} project
 * @param {string} stem
 */
export function releaseFileRel(project, stem) {
  return `${TICKETS_PREFIX}${project}/${RELEASES_DIR_NAME}/${stem}.yaml`;
}

/**
 * Option A: `{project}/{stem}`.
 * @param {string} project
 * @param {string} stem
 */
export function composeReleaseId(project, stem) {
  return `${project}/${stem}`;
}

/**
 * Parse `project/stem` release_id.
 * @param {string | null | undefined} releaseId
 * @returns {{ project: string, stem: string } | null}
 */
export function parseReleaseId(releaseId) {
  const s = (releaseId || "").trim();
  const slash = s.indexOf("/");
  if (slash <= 0 || slash === s.length - 1) return null;
  if (s.indexOf("/", slash + 1) !== -1) return null;
  return {
    project: s.slice(0, slash),
    stem: s.slice(slash + 1),
  };
}

/**
 * Parse release file path → `{ project, stem }`.
 * @param {string | null | undefined} filePath
 */
export function parseReleaseFilePath(filePath) {
  const p = (filePath || "").trim().replace(/\\/g, "/");
  if (!p.startsWith(TICKETS_PREFIX)) return null;
  const rest = p.slice(TICKETS_PREFIX.length);
  const parts = rest.split("/");
  if (parts.length !== 3 || parts[1] !== RELEASES_DIR_NAME) return null;
  const project = parts[0];
  const fileName = parts[2];
  if (!project || !fileName || fileName.startsWith(".")) return null;
  const stem = fileName.replace(/\.(ya?ml)$/i, "");
  if (!stem) return null;
  return { project, stem };
}
