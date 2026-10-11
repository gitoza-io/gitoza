/**
 * Appearance themes: Light, Dark+ (VS Code–inspired), High Contrast.
 * Legacy localStorage key `git-test-lens-theme` (product name is Gitoza); legacy `"dark"` maps to `"dark-plus"`.
 */

export const THEME_KEY = "git-test-lens-theme";

/** @typedef {"light" | "dark-plus" | "high-contrast"} ThemeId */

/** @type {readonly ThemeId[]} */
export const THEME_IDS = Object.freeze(["light", "dark-plus", "high-contrast"]);

/** @type {Record<ThemeId, string>} */
export const THEME_LABELS = Object.freeze({
  light: "Light",
  "dark-plus": "Dark+",
  "high-contrast": "High Contrast",
});

/**
 * @param {unknown} value
 * @returns {ThemeId | null}
 */
export function normalizeTheme(value) {
  if (value === "dark") return "dark-plus";
  if (value === "light" || value === "dark-plus" || value === "high-contrast") {
    return value;
  }
  return null;
}

/**
 * @param {ThemeId} theme
 * @returns {boolean}
 */
export function isDarkTheme(theme) {
  return theme !== "light";
}

/**
 * Resolve initial theme from localStorage or OS preference.
 * @returns {ThemeId}
 */
export function readStoredTheme() {
  if (typeof window === "undefined") return "light";
  const fromStorage = normalizeTheme(localStorage.getItem(THEME_KEY));
  if (fromStorage) return fromStorage;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark-plus"
    : "light";
}

/**
 * Apply theme to documentElement (data-theme + dark class for legacy dark: utilities).
 * @param {ThemeId} theme
 */
export function applyThemeToDocument(theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", isDarkTheme(theme));
}

/**
 * Whether the document currently uses a dark theme (for Mermaid / portals).
 * @returns {boolean}
 */
export function documentIsDarkTheme() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}
