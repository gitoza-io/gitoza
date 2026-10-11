/**
 * Whether closing the app should warn about local work not on the remote.
 *
 * @param {{ workplaceMode?: string | null, pushFailed?: boolean, workspaceKind?: string | null }} opts
 * @returns {boolean}
 */
export function shouldWarnOnAppClose({ workplaceMode, pushFailed, workspaceKind } = {}) {
  if (workspaceKind === "playground") return false;
  if (pushFailed === true) return true;
  return workplaceMode === "editing";
}
