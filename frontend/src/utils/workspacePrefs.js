/** Legacy localStorage keys (product name is Gitoza); keep values so existing installs retain prefs. */
export const LAST_ACTIVE_REPO_KEY = "git-test-lens-last-active-repo";
export const LAST_ACTIVE_VIEW_KEY = "git-test-lens-last-active-view";

/** Main sidebar destinations restored on cold start. */
export const RESTORABLE_VIEWS = Object.freeze([
  "tickets",
  "releases",
  "wiki",
  "explorer",
  "testrun",
  "automation",
  "review",
  "settings",
]);

const RESTORABLE_VIEW_SET = new Set(RESTORABLE_VIEWS);

/**
 * @param {unknown} view
 * @returns {view is string}
 */
export function isRestorableView(view) {
  return typeof view === "string" && RESTORABLE_VIEW_SET.has(view);
}

/**
 * Last workspace the user selected (sidebar switcher). Restored on cold start when still installed.
 */
export function readLastActiveRepoSlug() {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_REPO_KEY);
    const trimmed = raw?.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

export function writeLastActiveRepoSlug(slug) {
  try {
    if (slug) {
      localStorage.setItem(LAST_ACTIVE_REPO_KEY, slug);
    } else {
      localStorage.removeItem(LAST_ACTIVE_REPO_KEY);
    }
  } catch {
    // private mode / quota — ignore
  }
}

/**
 * Prefer last session workspace if it still exists; else config default or first repo.
 * @param {{ repos?: { slug: string }[], default_slug?: string | null } | null | undefined} reposData
 */
export function resolveInitialRepoSlug(reposData) {
  const repos = Array.isArray(reposData?.repos) ? reposData.repos : [];
  const slugs = new Set(repos.map((r) => r.slug));
  const last = readLastActiveRepoSlug();
  if (last && slugs.has(last)) {
    return last;
  }
  return reposData?.default_slug ?? repos[0]?.slug ?? null;
}

/**
 * Last main nav view. Returns allowlisted string or null.
 */
export function readLastActiveView() {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_VIEW_KEY);
    const trimmed = raw?.trim();
    if (!trimmed || !isRestorableView(trimmed)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Persist a restorable main nav view. Ephemeral views are ignored (prior value kept).
 * @param {unknown} view
 */
export function writeLastActiveView(view) {
  if (!isRestorableView(view)) return;
  try {
    localStorage.setItem(LAST_ACTIVE_VIEW_KEY, view);
  } catch {
    // private mode / quota — ignore
  }
}

/**
 * View to open on cold start: last restorable, else Tickets.
 */
export function resolveInitialActiveView() {
  return readLastActiveView() ?? "tickets";
}
