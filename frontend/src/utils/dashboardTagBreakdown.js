import { statsForCases } from "./runSummaryHierarchy";

/**
 * @param {object} c
 * @param {string} tagLabel
 */
export function caseMatchesTag(c, tagLabel) {
  if (!tagLabel) return false;
  const want = tagLabel.trim().toLowerCase();
  const tags = Array.isArray(c.tags) ? c.tags : [];
  return tags.some((t) => String(t).trim().toLowerCase() === want);
}

/**
 * Per-tag breakdown rows for Dashboard (selection order preserved).
 *
 * @param {Array<object>} runCases
 * @param {Array<string>} selectedTags
 * @returns {Array<{ key: string, label: string, stats: object }>}
 */
export function buildTagBreakdownRows(runCases = [], selectedTags = []) {
  if (!runCases?.length || !selectedTags?.length) return [];

  const rows = [];
  const seen = new Set();

  for (const tag of selectedTags) {
    const label = String(tag ?? "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);

    const matched = runCases.filter((c) => caseMatchesTag(c, label));
    rows.push({
      key,
      label,
      stats: statsForCases(matched),
    });
  }

  return rows;
}
