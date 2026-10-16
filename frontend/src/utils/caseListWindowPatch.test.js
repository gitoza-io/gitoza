import { describe, expect, it } from "vitest";
import { casePathUnderFolder, filterRowsForFolder } from "./caseListWindowPatch.js";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE = `${PROJECT}/login`;

describe("casePathUnderFolder", () => {
  it("matches paths under the folder prefix", () => {
    expect(casePathUnderFolder(`${SUITE}/a.md`, PROJECT)).toBe(true);
    expect(casePathUnderFolder(`${SUITE}/a.md`, SUITE)).toBe(true);
  });

  it("does not match paths outside the folder", () => {
    expect(casePathUnderFolder(`${PROJECT}/other/a.md`, SUITE)).toBe(false);
  });
});

describe("filterRowsForFolder", () => {
  it("returns rows under the folder only", () => {
    const rows = [
      { file_path: `${SUITE}/a.md` },
      { file_path: `${PROJECT}/other/b.md` },
    ];
    expect(filterRowsForFolder(rows, SUITE)).toEqual([{ file_path: `${SUITE}/a.md` }]);
  });

  it("returns empty when folderPath is missing", () => {
    expect(filterRowsForFolder([{ file_path: `${SUITE}/a.md` }], null)).toEqual([]);
  });
});
