import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_PROJECT_MODULES,
  featureFlagsEqual,
  firstEnabledNavView,
  isViewEnabledByFeatures,
  normalizeProjectModules,
  normalizeRepoFeatureFlags,
  readRepoModulesMirror,
  writeRepoModulesMirror,
} from "./repoModulesMirror.js";

describe("repoModulesMirror", () => {
  const store = new Map();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        store.set(k, String(v));
      },
      removeItem: (k) => {
        store.delete(k);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults missing module keys to true", () => {
    expect(normalizeProjectModules({ tickets: false })).toEqual({
      ...DEFAULT_PROJECT_MODULES,
      tickets: false,
    });
  });

  it("round-trips mirror read/write", () => {
    writeRepoModulesMirror("my-repo", {
      enable_review_system: false,
      modules: { wiki: false, automation: false },
    });
    const got = readRepoModulesMirror("my-repo");
    expect(got.enable_review_system).toBe(false);
    expect(got.modules.wiki).toBe(false);
    expect(got.modules.automation).toBe(false);
    expect(got.modules.tickets).toBe(true);
  });

  it("returns defaults when mirror missing", () => {
    const got = readRepoModulesMirror("unknown");
    expect(got).toEqual(normalizeRepoFeatureFlags(null));
  });

  it("gates views by modules and review", () => {
    const flags = {
      enable_review_system: false,
      modules: { ...DEFAULT_PROJECT_MODULES, wiki: false, test_run: false },
    };
    expect(isViewEnabledByFeatures("wiki", flags)).toBe(false);
    expect(isViewEnabledByFeatures("testrun", flags)).toBe(false);
    expect(isViewEnabledByFeatures("review", flags)).toBe(false);
    expect(isViewEnabledByFeatures("explorer", flags)).toBe(true);
    expect(firstEnabledNavView(flags)).toBe("tickets");
  });

  it("featureFlagsEqual detects module diffs", () => {
    const a = normalizeRepoFeatureFlags({ modules: { wiki: false } });
    const b = normalizeRepoFeatureFlags({ modules: { wiki: false } });
    const c = normalizeRepoFeatureFlags({ modules: { wiki: true } });
    expect(featureFlagsEqual(a, b)).toBe(true);
    expect(featureFlagsEqual(a, c)).toBe(false);
  });
});
