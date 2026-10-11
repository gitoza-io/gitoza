import { describe, expect, it } from "vitest";
import {
  caseListWindowQueryKey,
  hashSearchChips,
  isDirectCaseInFolder,
  mergeCaseWindowItems,
  mergePendingCaseWindowRows,
  patchAllWindowCachesRemove,
  patchCaseWindowRow,
  removeCaseWindowPaths,
  resortCaseRowsForFolder,
  sortCaseRowsByCaseId,
  upsertCaseWindowRow,
} from "./repositoryCaseWindowCache";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE_A = `${PROJECT}/login`;
const SUITE_B = `${PROJECT}/signup`;

describe("caseListWindowQueryKey", () => {
  it("distinguishes folder, chips, priority, and archive mode", () => {
    const a = caseListWindowQueryKey("repo", ".gitoza/test/cases/p", "", "high", false);
    const b = caseListWindowQueryKey("repo", ".gitoza/test/cases/p", "", "all", false);
    const c = caseListWindowQueryKey("repo", ".gitoza/test/cases/p", "tag:smoke", "high", false);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("hashSearchChips", () => {
  it("returns stable hash regardless of chip order", () => {
    const a = hashSearchChips([
      { key: "tag", value: "smoke" },
      { key: "status", value: "active" },
    ]);
    const b = hashSearchChips([
      { key: "status", value: "active" },
      { key: "tag", value: "smoke" },
    ]);
    expect(a).toBe(b);
  });

  it("includes paramKey for param chips", () => {
    const hash = hashSearchChips([
      { key: "param", paramKey: "env", value: "staging" },
      { key: "param", paramKey: "browser", value: "Chrome" },
    ]);
    expect(hash).toContain("param:env:staging");
    expect(hash).toContain("param:browser:Chrome");
  });
});

describe("mergeCaseWindowItems", () => {
  it("appends without duplicate file_path", () => {
    const existing = [{ file_path: "a.yaml", case_id: "A" }];
    const incoming = [
      { file_path: "a.yaml", case_id: "A2" },
      { file_path: "b.yaml", case_id: "B" },
    ];
    expect(mergeCaseWindowItems(existing, incoming)).toEqual([
      { file_path: "a.yaml", case_id: "A" },
      { file_path: "b.yaml", case_id: "B" },
    ]);
  });
});

describe("removeCaseWindowPaths", () => {
  it("removes rows by path", () => {
    const items = [{ file_path: "a.yaml" }, { file_path: "b.yaml" }];
    expect(removeCaseWindowPaths(items, ["a.yaml"])).toEqual([{ file_path: "b.yaml" }]);
  });
});

describe("patchAllWindowCachesRemove", () => {
  it("removes paths from every cache entry and decrements totals per entry", () => {
    const sharedPath = `${SUITE_A}/case_one.yaml`;
    const parentKey = caseListWindowQueryKey("repo", PROJECT, "", "all", false);
    const childKey = caseListWindowQueryKey("repo", SUITE_A, "", "all", false);
    const cacheMap = new Map([
      [
        parentKey,
        {
          items: [
            { file_path: sharedPath, case_id: "case_one" },
            { file_path: `${SUITE_B}/case_x.yaml`, case_id: "case_x" },
          ],
          total: 2,
        },
      ],
      [
        childKey,
        {
          items: [{ file_path: sharedPath, case_id: "case_one" }],
          total: 1,
        },
      ],
    ]);

    patchAllWindowCachesRemove(cacheMap, [sharedPath]);

    expect(cacheMap.get(parentKey)).toEqual({
      items: [{ file_path: `${SUITE_B}/case_x.yaml`, case_id: "case_x" }],
      total: 1,
    });
    expect(cacheMap.get(childKey)).toEqual({
      items: [],
      total: 0,
    });
  });

  it("no-ops when paths or cache map are empty", () => {
    const cacheMap = new Map([
      ["k", { items: [{ file_path: "a.yaml" }], total: 1 }],
    ]);
    patchAllWindowCachesRemove(cacheMap, []);
    patchAllWindowCachesRemove(null, ["a.yaml"]);
    expect(cacheMap.get("k")?.items).toHaveLength(1);
  });
});

describe("mergePendingCaseWindowRows", () => {
  it("upserts pending rows and counts new paths only", () => {
    const items = [{ file_path: "a.yaml", case_id: "A", title: "From API" }];
    const pending = [
      { file_path: "a.yaml", case_id: "A", title: "Optimistic title" },
      { file_path: "b.yaml", case_id: "B", title: "New case" },
    ];
    const { items: merged, addedCount } = mergePendingCaseWindowRows(items, pending);
    expect(merged).toEqual([
      { file_path: "a.yaml", case_id: "A", title: "Optimistic title" },
      { file_path: "b.yaml", case_id: "B", title: "New case" },
    ]);
    expect(addedCount).toBe(1);
  });

  it("returns unchanged items when pending is empty", () => {
    const items = [{ file_path: "a.yaml" }];
    expect(mergePendingCaseWindowRows(items, [])).toEqual({
      items: [{ file_path: "a.yaml" }],
      addedCount: 0,
    });
  });
});

describe("upsertCaseWindowRow", () => {
  it("updates existing row", () => {
    const items = [{ file_path: "a.yaml", title: "Old" }];
    expect(upsertCaseWindowRow(items, { file_path: "a.yaml", title: "New" })).toEqual([
      { file_path: "a.yaml", title: "New" },
    ]);
  });

  it("appends new row", () => {
    const items = [{ file_path: "a.yaml" }];
    expect(upsertCaseWindowRow(items, { file_path: "b.yaml" })).toEqual([
      { file_path: "a.yaml" },
      { file_path: "b.yaml" },
    ]);
  });
});

describe("patchCaseWindowRow", () => {
  it("patches matching row", () => {
    const items = [{ file_path: "a.yaml", title: "Old" }];
    expect(patchCaseWindowRow(items, "a.yaml", { title: "New" })).toEqual([
      { file_path: "a.yaml", title: "New" },
    ]);
  });
});

describe("isDirectCaseInFolder", () => {
  it("matches yaml direct children only", () => {
    expect(isDirectCaseInFolder(`${SUITE_A}/case_one.yaml`, SUITE_A)).toBe(true);
    expect(isDirectCaseInFolder(`${SUITE_A}/nested/case_one.yaml`, SUITE_A)).toBe(false);
    expect(isDirectCaseInFolder(`${SUITE_B}/case_one.yaml`, SUITE_A)).toBe(false);
  });
});

describe("resortCaseRowsForFolder", () => {
  it("reorders direct suite cases by case_id after rename append", () => {
    const rows = [
      { file_path: `${SUITE_A}/case_a.yaml`, case_id: "case_a" },
      { file_path: `${SUITE_A}/case_c.yaml`, case_id: "case_c" },
      { file_path: `${SUITE_A}/case_z.yaml`, case_id: "case_z" },
    ];
    const appended = [
      ...rows.filter((r) => r.file_path !== `${SUITE_A}/case_c.yaml`),
      { file_path: `${SUITE_A}/case_m.yaml`, case_id: "case_m" },
    ];
    expect(resortCaseRowsForFolder(appended, SUITE_A)).toEqual([
      { file_path: `${SUITE_A}/case_a.yaml`, case_id: "case_a" },
      { file_path: `${SUITE_A}/case_m.yaml`, case_id: "case_m" },
      { file_path: `${SUITE_A}/case_z.yaml`, case_id: "case_z" },
    ]);
  });

  it("only reorders cases in the target folder for project-level rows", () => {
    const rows = [
      { file_path: `${SUITE_A}/case_b.yaml`, case_id: "case_b" },
      { file_path: `${SUITE_B}/case_x.yaml`, case_id: "case_x" },
      { file_path: `${SUITE_A}/case_z.yaml`, case_id: "case_z" },
    ];
    const appended = [
      rows[0],
      rows[1],
      { file_path: `${SUITE_A}/case_m.yaml`, case_id: "case_m" },
    ];
    expect(resortCaseRowsForFolder(appended, SUITE_A)).toEqual([
      { file_path: `${SUITE_A}/case_b.yaml`, case_id: "case_b" },
      { file_path: `${SUITE_B}/case_x.yaml`, case_id: "case_x" },
      { file_path: `${SUITE_A}/case_m.yaml`, case_id: "case_m" },
    ]);
  });
});

describe("sortCaseRowsByCaseId", () => {
  it("sorts all rows by case_id", () => {
    const rows = [
      { file_path: `${SUITE_A}/z.yaml`, case_id: "z" },
      { file_path: `${SUITE_A}/a.yaml`, case_id: "a" },
      { file_path: `${SUITE_A}/m.yaml`, case_id: "m" },
    ];
    expect(sortCaseRowsByCaseId(rows).map((r) => r.case_id)).toEqual(["a", "m", "z"]);
  });
});
