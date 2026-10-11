/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  applyThemeToDocument,
  isDarkTheme,
  normalizeTheme,
  readStoredTheme,
  THEME_KEY,
} from "./theme.js";

describe("normalizeTheme", () => {
  it("maps legacy dark to dark-plus", () => {
    expect(normalizeTheme("dark")).toBe("dark-plus");
  });

  it("accepts known ids", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark-plus")).toBe("dark-plus");
    expect(normalizeTheme("high-contrast")).toBe("high-contrast");
  });

  it("rejects unknown", () => {
    expect(normalizeTheme("sepia")).toBeNull();
    expect(normalizeTheme(null)).toBeNull();
  });
});

describe("isDarkTheme", () => {
  it("is false only for light", () => {
    expect(isDarkTheme("light")).toBe(false);
    expect(isDarkTheme("dark-plus")).toBe(true);
    expect(isDarkTheme("high-contrast")).toBe(true);
  });
});

describe("readStoredTheme / applyThemeToDocument", () => {
  beforeEach(() => {
    const data = /** @type {Record<string, string>} */ ({});
    vi.stubGlobal("localStorage", {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem(key, value) {
        data[key] = String(value);
      },
      removeItem(key) {
        delete data[key];
      },
      clear() {
        for (const k of Object.keys(data)) delete data[k];
      },
    });
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("migrates stored dark", () => {
    localStorage.setItem(THEME_KEY, "dark");
    expect(readStoredTheme()).toBe("dark-plus");
  });

  it("applies data-theme and dark class", () => {
    applyThemeToDocument("dark-plus");
    expect(document.documentElement.dataset.theme).toBe("dark-plus");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    applyThemeToDocument("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
