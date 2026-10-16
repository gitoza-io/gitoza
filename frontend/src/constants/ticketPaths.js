/** Active tickets root (relative to repo root). */
export const TICKETS_ROOT = ".gitoza/tasks/tickets";

function normalizeRepoPath(path) {
  return (path || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * True when path is a ticket doc under `.gitoza/tasks/tickets/`.
 * @param {string} path
 */
export function isTicketDocPath(path) {
  const fp = normalizeRepoPath(path);
  if (!fp.startsWith(`${TICKETS_ROOT}/`)) return false;
  return /\.md$/i.test(fp);
}

/**
 * Ticket id stem from a ticket doc path (filename without extension).
 * @param {string} filePath
 * @returns {string}
 */
export function ticketLeafIdFromPath(filePath) {
  const fp = normalizeRepoPath(filePath);
  return (fp.split("/").pop() || fp).replace(/\.md$/i, "") || fp;
}

/**
 * Display label `project › ticket_id` for Confirm / conflict sidebars.
 * @param {string} filePath
 */
export function ticketBreadcrumbLabel(filePath) {
  const fp = normalizeRepoPath(filePath);
  const leaf = ticketLeafIdFromPath(fp);
  const project = ticketProjectFromPath(fp);
  return project ? `${project} › ${leaf}` : leaf;
}

/**
 * Project name from a ticket file or project directory path.
 * @param {string} path
 * @returns {string|null}
 */
export function ticketProjectFromPath(path) {
  const fp = normalizeRepoPath(path);
  if (!fp.startsWith(`${TICKETS_ROOT}/`)) return null;
  const rest = fp.slice(TICKETS_ROOT.length + 1);
  const project = (rest.split("/")[0] || "").trim();
  if (!project || project === ".archive") return null;
  return project;
}

/**
 * Project directory path (`.gitoza/tasks/tickets/{project}`) for a ticket file or project path.
 * @param {string} path
 * @returns {string|null}
 */
export function ticketProjectDirFromPath(path) {
  const project = ticketProjectFromPath(path);
  return project ? `${TICKETS_ROOT}/${project}` : null;
}

/**
 * When a project is open-focused and the ticket lives in another project, return that
 * project's directory so the list/query can switch focus. Otherwise null (no change).
 * @param {string} filePath
 * @param {string|null|undefined} openedProjectPath
 * @returns {string|null}
 */
export function projectFocusForTicketOpen(filePath, openedProjectPath) {
  const ticketDir = ticketProjectDirFromPath(filePath);
  if (!ticketDir) return null;
  const opened = normalizeRepoPath(openedProjectPath);
  if (!opened || opened === ticketDir) return null;
  return ticketDir;
}

/**
 * True when path is a ticket project directory (not a ticket doc).
 * @param {string} path
 */
export function isTicketProjectPath(path) {
  const fp = normalizeRepoPath(path);
  const active = `${TICKETS_ROOT}/`;
  if (!fp.startsWith(active)) return false;
  const rest = fp.slice(active.length);
  return Boolean(rest) && !rest.includes("/") && rest !== ".archive";
}
