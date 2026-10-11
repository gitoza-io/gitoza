/**
 * Client-side filter helpers for tree search matchers.
 */

/**
 * Case-insensitive substring match against one or more string / string[] fields.
 * Empty query matches everything.
 *
 * @param {Record<string, unknown>} item
 * @param {string} query
 * @param {string[]} fields
 * @returns {boolean}
 */
export function itemMatchesQuery(item, query, fields) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  if (!item || !Array.isArray(fields)) return false;

  for (const field of fields) {
    const raw = item[field];
    if (raw == null) continue;
    if (Array.isArray(raw)) {
      if (raw.some((v) => String(v).toLowerCase().includes(q))) return true;
    } else if (String(raw).toLowerCase().includes(q)) {
      return true;
    }
  }
  return false;
}

/**
 * Exact case-insensitive match on an enum frontmatter field.
 * Empty value matches everything.
 *
 * @param {Record<string, unknown>} item
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function itemMatchesEnum(item, key, value) {
  const filter = String(value ?? "").trim().toLowerCase();
  if (!filter) return true;
  if (!item) return false;
  return (
    String(item[key] ?? "")
      .trim()
      .toLowerCase() === filter
  );
}
