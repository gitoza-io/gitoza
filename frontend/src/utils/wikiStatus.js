/** Wiki page status options (matches wiki search filter enums). */
export const WIKI_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "outdated", label: "Outdated" },
];

/**
 * @param {string | null | undefined} status
 * @returns {string}
 */
export function formatWikiStatusLabel(status) {
  const key = String(status ?? "draft").trim().toLowerCase();
  const match = WIKI_STATUS_OPTIONS.find((opt) => opt.value === key);
  return match?.label ?? "Draft";
}

/**
 * Text color classes for metadata chip values (view + edit select).
 * @param {string | null | undefined} status
 * @returns {string}
 */
export function wikiStatusValueClassName(status) {
  const key = String(status ?? "draft").trim().toLowerCase();
  if (key === "published") {
    return "text-emerald-700 dark:text-emerald-300";
  }
  if (key === "outdated") {
    return "text-amber-800 dark:text-amber-300";
  }
  return "text-slate-900 dark:text-slate-100";
}
