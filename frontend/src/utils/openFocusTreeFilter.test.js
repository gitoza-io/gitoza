import { describe, expect, it } from "vitest";
import {
  effectiveSearchFolderPath,
  filterRowsByRunId,
  filterRowsUnderPathPrefix,
  filterTreeToOpenedRoot,
  pathIsUnderOrEqual,
} from "./openFocusTreeFilter";

describe("filterTreeToOpenedRoot", () => {
  const tree = [
    { directory_path: ".gitoza/test/cases/a", name: "a" },
    { directory_path: ".gitoza/test/cases/b", name: "b" },
  ];

  it("returns full tree when nothing is opened", () => {
    expect(filterTreeToOpenedRoot(tree, null)).toEqual(tree);
  });

  it("filters to a single root by directory_path", () => {
    expect(filterTreeToOpenedRoot(tree, ".gitoza/test/cases/b")).toEqual([
      { directory_path: ".gitoza/test/cases/b", name: "b" },
    ]);
  });

  it("returns empty when opened path is missing", () => {
    expect(filterTreeToOpenedRoot(tree, ".gitoza/test/cases/missing")).toEqual([]);
  });
});

describe("pathIsUnderOrEqual", () => {
  it("treats missing root as unrestricted", () => {
    expect(pathIsUnderOrEqual("any", null)).toBe(true);
  });

  it("matches equal and descendant paths", () => {
    expect(pathIsUnderOrEqual("a/b", "a")).toBe(true);
    expect(pathIsUnderOrEqual("a", "a")).toBe(true);
    expect(pathIsUnderOrEqual("ab", "a")).toBe(false);
  });
});

describe("effectiveSearchFolderPath", () => {
  it("returns selected path when nothing is open-focused", () => {
    expect(effectiveSearchFolderPath("a/suite", null)).toBe("a/suite");
    expect(effectiveSearchFolderPath(null, null)).toBe(null);
  });

  it("defaults to opened root when no folder is selected", () => {
    expect(effectiveSearchFolderPath(null, "proj")).toBe("proj");
  });

  it("keeps selection under the opened root", () => {
    expect(effectiveSearchFolderPath("proj/suite", "proj")).toBe("proj/suite");
  });

  it("falls back to opened root when selection is outside", () => {
    expect(effectiveSearchFolderPath("other/suite", "proj")).toBe("proj");
  });
});

describe("filterRowsUnderPathPrefix", () => {
  const rows = [
    { file_path: "proj/a.yaml", directory: "proj" },
    { file_path: "proj/suite/b.yaml", directory: "proj/suite" },
    { file_path: "other/c.yaml", directory: "other" },
  ];

  it("returns all rows without a prefix", () => {
    expect(filterRowsUnderPathPrefix(rows, null)).toEqual(rows);
  });

  it("keeps rows under the project prefix", () => {
    expect(filterRowsUnderPathPrefix(rows, "proj")).toEqual([
      { file_path: "proj/a.yaml", directory: "proj" },
      { file_path: "proj/suite/b.yaml", directory: "proj/suite" },
    ]);
  });
});

describe("filterRowsByRunId", () => {
  const rows = [
    { run_id: "R-1", file_path: "a.yaml" },
    { run_id: "R-2", file_path: "b.yaml" },
  ];

  it("returns all rows without a run id", () => {
    expect(filterRowsByRunId(rows, null)).toEqual(rows);
  });

  it("keeps only matching run_id", () => {
    expect(filterRowsByRunId(rows, "R-1")).toEqual([
      { run_id: "R-1", file_path: "a.yaml" },
    ]);
  });
});
