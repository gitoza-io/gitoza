import { describe, it, expect } from "vitest";
import {
  applyMembershipToStale,
  browseFolderKey,
  filterCasesByMembership,
  pageCacheKey,
  patchPageCacheRemovePaths,
  resolveBrowseListDisplay,
} from "./runCasesPageCache";

describe("pageCacheKey", () => {
  it("returns stable key for same inputs", () => {
    const a = pageCacheKey("run-1", ".gitoza/test/cases/auth", 1);
    const b = pageCacheKey("run-1", ".gitoza/test/cases/auth", 1);
    expect(a).toBe(b);
    expect(a).toBe(`run-1${"\0"}.gitoza/test/cases/auth${"\0"}1`);
  });

  it("distinguishes folder prefix and page", () => {
    const page1 = pageCacheKey("run-1", "auth/login", 1);
    const page2 = pageCacheKey("run-1", "auth/login", 2);
    const otherFolder = pageCacheKey("run-1", "auth/debug", 1);
    expect(page1).not.toBe(page2);
    expect(page1).not.toBe(otherFolder);
  });

  it("handles null folder prefix for run root", () => {
    expect(pageCacheKey("run-1", null, 1)).toBe(`run-1${"\0"}${"\0"}1`);
  });
});

describe("browseFolderKey", () => {
  it("combines run, folder path, and page", () => {
    expect(browseFolderKey("r1", "path/a", 2)).toBe(`r1${"\0"}path/a${"\0"}2`);
  });
});

describe("filterCasesByMembership", () => {
  it("filters rows not in cachedCases", () => {
    const cases = [
      { file_path: "a.yaml" },
      { file_path: "b.yaml" },
    ];
    const cached = [{ file_path: "a.yaml" }];
    expect(filterCasesByMembership(cases, cached)).toEqual([{ file_path: "a.yaml" }]);
  });

  it("passes through when cachedCases is undefined", () => {
    const cases = [{ file_path: "a.yaml" }];
    expect(filterCasesByMembership(cases, undefined)).toEqual(cases);
  });
});

describe("patchPageCacheRemovePaths", () => {
  const runId = "run-1";
  const key1 = pageCacheKey(runId, "auth", 1);
  const key2 = pageCacheKey("run-2", "auth", 1);

  it("removes rows and decrements total on matching run page keys only", () => {
    const cache = {
      [key1]: {
        items: [
          { file_path: "a.yaml" },
          { file_path: "b.yaml" },
        ],
        total: 5,
      },
      [key2]: {
        items: [{ file_path: "a.yaml" }],
        total: 1,
      },
    };

    const next = patchPageCacheRemovePaths(cache, runId, ["b.yaml"]);

    expect(next[key1].items).toEqual([{ file_path: "a.yaml" }]);
    expect(next[key1].total).toBe(4);
    expect(next[key2]).toEqual(cache[key2]);
  });
});

describe("applyMembershipToStale", () => {
  it("filters stale cases and decrements total", () => {
    const stale = {
      cases: [
        { file_path: "a.yaml" },
        { file_path: "b.yaml" },
      ],
      total: 10,
    };
    const cached = [{ file_path: "a.yaml" }];

    expect(applyMembershipToStale(stale, cached)).toEqual({
      cases: [{ file_path: "a.yaml" }],
      total: 9,
    });
  });
});

describe("resolveBrowseListDisplay", () => {
  const stale = {
    cases: [{ file_path: "a.yaml", result: "passed" }],
    total: 10,
  };

  it("shows stale rows while loading with empty display", () => {
    const result = resolveBrowseListDisplay({
      displayCases: [],
      displayTotal: 0,
      currentPageLoading: true,
      searchActive: false,
      staleSnapshot: stale,
    });
    expect(result.showStale).toBe(true);
    expect(result.casesForList).toEqual(stale.cases);
    expect(result.totalForList).toBe(10);
    expect(result.listRefreshing).toBe(true);
    expect(result.listLoading).toBe(false);
  });

  it("uses display cases when loaded", () => {
    const display = [{ file_path: "b.yaml", result: "pending" }];
    const result = resolveBrowseListDisplay({
      displayCases: display,
      displayTotal: 5,
      currentPageLoading: false,
      searchActive: false,
      staleSnapshot: stale,
    });
    expect(result.casesForList).toEqual(display);
    expect(result.totalForList).toBe(5);
    expect(result.listRefreshing).toBe(false);
  });

  it("shows loading when no stale fallback", () => {
    const result = resolveBrowseListDisplay({
      displayCases: [],
      displayTotal: 0,
      currentPageLoading: true,
      searchActive: false,
      staleSnapshot: { cases: [], total: 0 },
    });
    expect(result.listLoading).toBe(true);
    expect(result.casesForList).toEqual([]);
  });

  it("does not use stale in search mode", () => {
    const result = resolveBrowseListDisplay({
      displayCases: [],
      displayTotal: 0,
      currentPageLoading: true,
      searchActive: true,
      staleSnapshot: stale,
    });
    expect(result.showStale).toBe(false);
    expect(result.casesForList).toEqual([]);
  });

  it("filters stale ghost rows by cachedCases membership", () => {
    const ghostStale = {
      cases: [
        { file_path: "a.yaml", result: "passed" },
        { file_path: "removed.yaml", result: "pending" },
      ],
      total: 10,
    };
    const cached = [{ file_path: "a.yaml", result: "passed" }];

    const result = resolveBrowseListDisplay({
      displayCases: [],
      displayTotal: 0,
      currentPageLoading: true,
      searchActive: false,
      staleSnapshot: ghostStale,
      cachedCases: cached,
    });

    expect(result.showStale).toBe(true);
    expect(result.casesForList).toEqual([{ file_path: "a.yaml", result: "passed" }]);
    expect(result.totalForList).toBe(9);
  });

  it("shows loading when membership filters all stale rows", () => {
    const ghostStale = {
      cases: [{ file_path: "removed.yaml", result: "pending" }],
      total: 5,
    };

    const result = resolveBrowseListDisplay({
      displayCases: [],
      displayTotal: 0,
      currentPageLoading: true,
      searchActive: false,
      staleSnapshot: ghostStale,
      cachedCases: [],
    });

    expect(result.showStale).toBe(false);
    expect(result.listLoading).toBe(true);
    expect(result.casesForList).toEqual([]);
  });
});
