/**
 * Quick status filters for browsing releases (root / project focus).
 * Distinct from ticket workflow statuses in ticketStatusQuickFilter.js.
 */

/** @type {{ value: string, label: string, icon: string, iconClass: string }[]} */
export const RELEASE_LIFECYCLE_QUICK_FILTERS = [
  {
    value: "open",
    label: "Open",
    icon: "Inbox",
    iconClass: "text-sky-600 dark:text-sky-400",
  },
  {
    value: "shipped",
    label: "Shipped",
    icon: "Ship",
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    icon: "Ban",
    iconClass: "text-slate-500 dark:text-slate-400",
  },
];

/** Default lifecycle filter when browsing releases (hide shipped/cancelled until chosen). */
export const DEFAULT_RELEASE_LIFECYCLE_STATUS = "open";

/**
 * Whether opening a release should clear the active lifecycle filter to "all".
 * Used when a filtered project list would hide the target release (e.g. deep-link to shipped).
 *
 * @param {{
 *   releaseId: string | null | undefined;
 *   projectName: string | null | undefined;
 *   lifecycleStatus: string | null | undefined;
 *   releasesByProject: Record<string, Array<{ release_id?: string }>>;
 *   releaseRow?: { status?: string } | null;
 * }} args
 * @returns {boolean}
 */
export function shouldClearLifecycleFilterForRelease({
  releaseId,
  projectName,
  lifecycleStatus,
  releasesByProject,
  releaseRow,
}) {
  if (!lifecycleStatus) return false;
  if (!releaseId || !projectName) return false;

  const list = releasesByProject[projectName];
  if (Array.isArray(list) && list.some((r) => r.release_id === releaseId)) {
    return false;
  }

  const projectLoaded = Object.prototype.hasOwnProperty.call(releasesByProject, projectName);
  if (projectLoaded) {
    return true;
  }

  const catalogStatus = (releaseRow?.status || "").trim().toLowerCase();
  if (!releaseRow) {
    return true;
  }
  return catalogStatus !== lifecycleStatus;
}
