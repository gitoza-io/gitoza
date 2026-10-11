const DISMISS_KEY = "gitoza_update_notice_dismissed";

function readDismissedVersion() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const version = parsed?.version;
    return version != null ? String(version) : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string | null | undefined} version
 * @returns {boolean}
 */
export function isUpdateNoticeDismissed(version) {
  if (!version) return false;
  return readDismissedVersion() === String(version);
}

/**
 * @param {string | null | undefined} version
 */
export function dismissUpdateNotice(version) {
  try {
    localStorage.setItem(
      DISMISS_KEY,
      JSON.stringify({ version: String(version || "") }),
    );
  } catch (_) {
    /* ignore quota / private mode */
  }
}

export function clearDismissedUpdateNotice() {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch (_) {
    /* ignore */
  }
}
