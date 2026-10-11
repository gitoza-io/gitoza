/**
 * Commit / cancel rules for entity-link fields (parent, release, requirement ids).
 * Pickers persist only ids that resolve; unmatched blur/Enter reverts instead of
 * writing a dead id. Already-saved unresolved ids are kept if the user does not edit.
 */

export function idsEqual(a, b) {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

/**
 * Canonical id from suggestions whose id equals `query` (case-insensitive).
 * @param {string} query
 * @param {object[]} suggestions
 * @param {(row: object) => string} getId
 * @returns {string|null}
 */
export function findExactSuggestionId(query, suggestions, getId) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q || !Array.isArray(suggestions) || typeof getId !== "function") return null;
  for (const row of suggestions) {
    const id = String(getId(row) ?? "").trim();
    if (id && id.toLowerCase() === q) return id;
  }
  return null;
}

/**
 * Decide what to persist for an entity-link field.
 * @param {{
 *   query?: string,
 *   committedValue?: string,
 *   excludeId?: string|null,
 *   exactSuggestionId?: string|null,
 *   resolvedId?: string|null,
 * }} [opts]
 * @returns {{ action: "commit", id: string } | { action: "clear" } | { action: "keep" } | { action: "revert" }}
 */
export function decideLinkedIdCommit({
  query = "",
  committedValue = "",
  excludeId = null,
  exactSuggestionId = null,
  resolvedId = null,
} = {}) {
  const q = String(query ?? "").trim();
  const committed = String(committedValue ?? "").trim();
  const exclude = String(excludeId ?? "").trim();

  if (!q) {
    return { action: "clear" };
  }

  if (idsEqual(q, committed)) {
    return { action: "keep" };
  }

  const candidate =
    String(exactSuggestionId ?? "").trim() || String(resolvedId ?? "").trim();
  if (!candidate) {
    return { action: "revert" };
  }
  if (exclude && idsEqual(candidate, exclude)) {
    return { action: "revert" };
  }
  return { action: "commit", id: candidate };
}
