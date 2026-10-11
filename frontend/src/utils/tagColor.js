/**
 * Deterministic tag color: same tag (case-insensitive) gets the same color everywhere.
 * Uses a hash of the lowercased tag to pick from a fixed palette. No backend or storage.
 */

const TAG_PALETTE = [
  "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400",
  "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400",
  "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400",
  "bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400",
  "bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400",
  "bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400",
  "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400",
  "bg-lime-50 text-lime-600 dark:bg-lime-500/15 dark:text-lime-400",
];

/**
 * Simple string hash (djb2) for deterministic index. Uses lowercased tag so "Auth" and "auth" share a color.
 * @param {string} tag
 * @returns {number}
 */
function hashTag(tag) {
  const s = String(tag || "").toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Returns Tailwind classes for the tag pill (background + text, including dark). Same tag → same color.
 * @param {string} tag
 * @returns {string} e.g. "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400"
 */
export function getTagColorClass(tag) {
  const index = hashTag(tag) % TAG_PALETTE.length;
  return TAG_PALETTE[index];
}

/**
 * Light-theme pill colors for HTML/PDF export (no Tailwind). Same hash as getTagColorClass.
 * @param {string} tag
 * @returns {{ background: string; color: string }}
 */
export function getTagExportPillStyle(tag) {
  const styles = [
    { background: "#eef2ff", color: "#4f46e5" },
    { background: "#ecfdf5", color: "#059669" },
    { background: "#fffbeb", color: "#d97706" },
    { background: "#eff6ff", color: "#2563eb" },
    { background: "#f5f3ff", color: "#7c3aed" },
    { background: "#fff1f2", color: "#e11d48" },
    { background: "#f0f9ff", color: "#0284c7" },
    { background: "#f0fdfa", color: "#0d9488" },
    { background: "#fff7ed", color: "#ea580c" },
    { background: "#fdf4ff", color: "#c026d3" },
    { background: "#ecfeff", color: "#0891b2" },
    { background: "#f7fee7", color: "#65a30d" },
  ];
  const index = hashTag(tag) % styles.length;
  return styles[index];
}
