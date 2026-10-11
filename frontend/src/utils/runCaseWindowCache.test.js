import { describe, expect, it } from "vitest";
import {
  clearRunWindowCachesForRun,
  mergeRunWindowItems,
  patchAllRunWindowCachesRemove,
  patchRunWindowRow,
  removeRunWindowPaths,
  runCaseWindowQueryKey,
  upsertRunWindowRow,
} from "./runCaseWindowCache";

const RUN_ID = "run-1";
const PROJECT = ".gitoza/test/cases/auth";
const SUITE_A = `${PROJECT}/login`;

describe("runCaseWindowQueryKey", () => {
  it("distinguishes run and folder prefix", () => {
    const a = runCaseWindowQueryKey(RUN_ID, PROJECT);
    const b = runCaseWindowQueryKey(RUN_ID, SUITE_A);
    const c = runCaseWindowQueryKey("run-2", PROJECT);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("mergeRunWindowItems", () => {
  it("appends without duplicate file_path", () => {
    const existing = [{ file_path: "a.yaml", case_id: "A" }];
    const incoming = [
      { file_path: "a.yaml", case_id: "A2" },
      { file_path: "b.yaml", case_id: "B" },
    ];
    expect(mergeRunWindowItems(existing, incoming)).toEqual([
      { file_path: "a.yaml", case_id: "A" },
      { file_path: "b.yaml", case_id: "B" },
    ]);
  });
});

describe("removeRunWindowPaths", () => {
  it("removes rows by path", () => {
    const items = [{ file_path: "a.yaml" }, { file_path: "b.yaml" }];
    expect(removeRunWindowPaths(items, ["a.yaml"])).toEqual([{ file_path: "b.yaml" }]);
  });
});

describe("patchAllRunWindowCachesRemove", () => {
  it("removes paths only from caches for the given run", () => {
    const sharedPath = `${SUITE_A}/case_one.yaml`;
    const run1Parent = runCaseWindowQueryKey(RUN_ID, PROJECT);
    const run1Child = runCaseWindowQueryKey(RUN_ID, SUITE_A);
    const run2Parent = runCaseWindowQueryKey("run-2", PROJECT);
    const cacheMap = new Map([
      [
        run1Parent,
        {
          items: [
            { file_path: sharedPath },
            { file_path: `${SUITE_A}/other.yaml` },
          ],
          total: 2,
        },
      ],
      [run1Child, { items: [{ file_path: sharedPath }], total: 1 }],
      [run2Parent, { items: [{ file_path: sharedPath }], total: 1 }],
    ]);

    patchAllRunWindowCachesRemove(cacheMap, RUN_ID, [sharedPath]);

    expect(cacheMap.get(run1Parent)).toEqual({
      items: [{ file_path: `${SUITE_A}/other.yaml` }],
      total: 1,
    });
    expect(cacheMap.get(run1Child)).toEqual({ items: [], total: 0 });
    expect(cacheMap.get(run2Parent)).toEqual({
      items: [{ file_path: sharedPath }],
      total: 1,
    });
  });
});

describe("clearRunWindowCachesForRun", () => {
  it("deletes all cache entries for a run", () => {
    const cacheMap = new Map([
      [runCaseWindowQueryKey(RUN_ID, PROJECT), { items: [], total: 0 }],
      [runCaseWindowQueryKey("run-2", PROJECT), { items: [], total: 0 }],
    ]);
    clearRunWindowCachesForRun(cacheMap, RUN_ID);
    expect(cacheMap.has(runCaseWindowQueryKey(RUN_ID, PROJECT))).toBe(false);
    expect(cacheMap.has(runCaseWindowQueryKey("run-2", PROJECT))).toBe(true);
  });
});

describe("upsertRunWindowRow", () => {
  it("updates existing row", () => {
    const items = [{ file_path: "a.yaml", result: "pending" }];
    expect(upsertRunWindowRow(items, { file_path: "a.yaml", result: "passed" })).toEqual([
      { file_path: "a.yaml", result: "passed" },
    ]);
  });
});

describe("patchRunWindowRow", () => {
  it("patches matching row", () => {
    const items = [{ file_path: "a.yaml", result: "pending" }];
    expect(patchRunWindowRow(items, "a.yaml", { result: "failed" })).toEqual([
      { file_path: "a.yaml", result: "failed" },
    ]);
  });
});
