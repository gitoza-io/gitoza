import { describe, expect, it } from "vitest";
import { casePathUnderFolder, filterRowsForFolder } from "./caseListWindowPatch.js";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE = `${PROJECT}/login`;

describe("casePathUnderFolder", () => {
  it("matches paths under the folder prefix", () => {
    expect(casePathUnderFolder(`${SUITE}/a.yaml`, PROJECT)).toBe(true);
    expect(casePathUnderFolder(`${SUITE}/a.yaml`, SUITE)).toBe(true);
  });

  it("does not match paths outside the folder", () => {
    expect(casePathUnderFolder(`${PROJECT}/other/a.yaml`, SUITE)).toBe(false);
  });
});

describe("filterRowsForFolder", () => {
  it("returns rows under the folder only", () => {
    const rows = [
      { file_path: `${SUITE}/a.yaml` },
      { file_path: `${PROJECT}/other/b.yaml` },
    ];
    expect(filterRowsForFolder(rows, SUITE)).toEqual([{ file_path: `${SUITE}/a.yaml` }]);
  });

  it("returns empty when folderPath is missing", () => {
    expect(filterRowsForFolder([{ file_path: `${SUITE}/a.yaml` }], null)).toEqual([]);
  });
});
