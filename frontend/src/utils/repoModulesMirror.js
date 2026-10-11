/** Default module visibility (all enabled). */
export const DEFAULT_PROJECT_MODULES = Object.freeze({
  tickets: true,
  releases: true,
  wiki: true,
  test_repository: true,
  test_run: true,
  automation: true,
});

export const DEFAULT_REPO_FEATURE_FLAGS = Object.freeze({
  enable_review_system: true,
  modules: { ...DEFAULT_PROJECT_MODULES },
});

function mirrorKey(repoSlug) {
  return `gitoza.repoModules.${repoSlug}`;
}

/**
 * Normalize a partial modules object to full boolean flags.
 * @param {object | null | undefined} raw
 */
export function normalizeProjectModules(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    tickets: src.tickets !== false,
    releases: src.releases !== false,
    wiki: src.wiki !== false,
    test_repository: src.test_repository !== false,
    test_run: src.test_run !== false,
    automation: src.automation !== false,
  };
}

/**
 * @param {object | null | undefined} raw
 * @returns {{ enable_review_system: boolean, modules: ReturnType<typeof normalizeProjectModules> }}
 */
export function normalizeRepoFeatureFlags(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    enable_review_system: src.enable_review_system !== false,
    modules: normalizeProjectModules(src.modules),
  };
}

/** True when review + all module flags match. */
export function featureFlagsEqual(a, b) {
  const left = normalizeRepoFeatureFlags(a);
  const right = normalizeRepoFeatureFlags(b);
  if (left.enable_review_system !== right.enable_review_system) return false;
  for (const key of Object.keys(DEFAULT_PROJECT_MODULES)) {
    if (left.modules[key] !== right.modules[key]) return false;
  }
  return true;
}

/**
 * Read last-known feature flags for a repo from localStorage.
 * @param {string | null | undefined} repoSlug
 */
export function readRepoModulesMirror(repoSlug) {
  const slug = (repoSlug || "").trim();
  if (!slug) return { ...DEFAULT_REPO_FEATURE_FLAGS, modules: { ...DEFAULT_PROJECT_MODULES } };
  try {
    const raw = localStorage.getItem(mirrorKey(slug));
    if (!raw) {
      return { ...DEFAULT_REPO_FEATURE_FLAGS, modules: { ...DEFAULT_PROJECT_MODULES } };
    }
    return normalizeRepoFeatureFlags(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REPO_FEATURE_FLAGS, modules: { ...DEFAULT_PROJECT_MODULES } };
  }
}

/**
 * Persist feature flags for instant sidebar paint after restart.
 * @param {string | null | undefined} repoSlug
 * @param {{ enable_review_system?: boolean, modules?: object } | null | undefined} flags
 */
export function writeRepoModulesMirror(repoSlug, flags) {
  const slug = (repoSlug || "").trim();
  if (!slug) return;
  const normalized = normalizeRepoFeatureFlags(flags);
  try {
    localStorage.setItem(mirrorKey(slug), JSON.stringify(normalized));
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Extract feature flags from a repo status payload and mirror them.
 * @param {string | null | undefined} repoSlug
 * @param {object | null | undefined} repoStatus
 */
export function mirrorRepoStatusFeatures(repoSlug, repoStatus) {
  if (!repoSlug || !repoStatus) return;
  writeRepoModulesMirror(repoSlug, {
    enable_review_system: repoStatus.enable_review_system,
    modules: repoStatus.modules,
  });
}

/** Map sidebar view key → module config key (review uses enable_review_system). */
export const VIEW_TO_MODULE_KEY = Object.freeze({
  tickets: "tickets",
  releases: "releases",
  wiki: "wiki",
  explorer: "test_repository",
  testrun: "test_run",
  automation: "automation",
});

/**
 * @param {string} viewKey
 * @param {{ enable_review_system: boolean, modules: object }} flags
 */
export function isViewEnabledByFeatures(viewKey, flags) {
  const f = normalizeRepoFeatureFlags(flags);
  if (viewKey === "review") return f.enable_review_system;
  const moduleKey = VIEW_TO_MODULE_KEY[viewKey];
  if (!moduleKey) return true;
  return f.modules[moduleKey] !== false;
}

/**
 * First enabled main-nav view, or "settings" if none.
 * @param {{ enable_review_system: boolean, modules: object }} flags
 */
export function firstEnabledNavView(flags) {
  const order = [
    "tickets",
    "releases",
    "wiki",
    "explorer",
    "testrun",
    "automation",
    "review",
  ];
  for (const key of order) {
    if (isViewEnabledByFeatures(key, flags)) return key;
  }
  return "settings";
}
