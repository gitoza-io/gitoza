export const CHANGE_STATUS_LABELS = {
  A: "Added",
  M: "Modified",
  R: "Renamed",
  D: "Deleted",
};

/**
 * @param {string} path
 * @returns {string}
 */
function leafName(path) {
  const normalized = (path || "").replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || normalized;
  return base.replace(/\.ya?ml$/i, "") || base;
}

/**
 * Short rename tooltip: prefer leaf stems, fall back to full paths.
 * @param {string} oldPath
 * @param {string} newPath
 * @returns {string}
 */
export function formatRenameTooltip(oldPath, newPath) {
  const oldLeaf = leafName(oldPath);
  const newLeaf = leafName(newPath);
  if (oldLeaf && newLeaf && oldLeaf !== newLeaf) {
    return `${oldLeaf} → ${newLeaf}`;
  }
  const oldNorm = (oldPath || "").replace(/\\/g, "/");
  const newNorm = (newPath || "").replace(/\\/g, "/");
  if (oldNorm && newNorm && oldNorm !== newNorm) {
    return `${oldNorm} → ${newNorm}`;
  }
  return CHANGE_STATUS_LABELS.R;
}

/**
 * @param {string} status
 * @returns {string}
 */
export function changeStatusLabel(status) {
  const key = (status || "").toUpperCase();
  return CHANGE_STATUS_LABELS[key] ?? status ?? "";
}

/**
 * @param {Array<{ path?: string, status?: string, old_path?: string | null }>} changes
 * @returns {Map<string, { status: string, old_path?: string }>}
 */
export function buildChangeStatusByPath(changes) {
  const map = new Map();
  for (const change of changes || []) {
    const path = (change?.path || "").replace(/\\/g, "/");
    if (!path) continue;
    const status = (change?.status || "M").toUpperCase();
    const entry = { status };
    if (change?.old_path) {
      entry.old_path = change.old_path.replace(/\\/g, "/");
    }
    map.set(path, entry);
  }
  return map;
}
