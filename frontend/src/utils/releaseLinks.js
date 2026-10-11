import { getReleases } from "../services/api";

/**
 * Display label for a release row (project · name).
 * @param {{ release_id?: string, name?: string|null, project?: string|null }} r
 */
export function formatReleaseLabel(r) {
  if (!r) return "";
  const name = (r.name || "").trim() || r.release_id || "";
  const project = (r.project || "").trim() || (r.release_id || "").split("/")[0] || "";
  return project ? `${project} · ${name}` : name;
}

/**
 * Single-line autocomplete label: canonical release_id, plus human name when it differs from the stem.
 * @param {{ release_id?: string, name?: string|null }} r
 */
export function formatReleaseSuggestionLabel(r) {
  const id = (r?.release_id || "").trim();
  if (!id) return formatReleaseLabel(r);
  const stem = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  const name = (r?.name || "").trim();
  if (name && name !== stem && name !== id) {
    return `${id} — ${name}`;
  }
  return id;
}

/**
 * Resolve composite release_id (`project/stem`) to a list row.
 */
export async function resolveReleaseById(repoSlug, releaseId) {
  const id = (releaseId || "").trim();
  if (!repoSlug || !id) return null;
  try {
    const res = await getReleases(repoSlug, {
      release_id: id,
      limit: 1,
      offset: 0,
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    return items[0] || null;
  } catch {
    return null;
  }
}

/**
 * Search releases for autocomplete.
 * Empty query lists recent/all releases (optionally scoped by project); non-empty filters via search.
 * @param {string|null} repoSlug
 * @param {string} query
 * @param {{ limit?: number, project?: string|null }} [opts]
 * @returns {Promise<object[]>}
 */
export async function searchReleasesForLink(repoSlug, query, opts = {}) {
  if (!repoSlug) return [];
  const q = (query || "").trim();
  const project = (opts.project || "").trim();
  try {
    const res = await getReleases(repoSlug, {
      ...(q ? { search: q } : {}),
      ...(project ? { project } : {}),
      limit: opts.limit ?? 12,
      offset: 0,
    });
    return Array.isArray(res?.items) ? res.items : [];
  } catch {
    return [];
  }
}
