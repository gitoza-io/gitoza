import { describe, expect, it } from "vitest";
import {
  applyCaseMovesToCatalogMaps,
  buildCaseActionPayload,
  buildCaseMoves,
  buildMovedCaseRows,
  computeCaseMovePath,
  computeRenamedCasePath,
  findCaseRowInCatalog,
  parentFolderOfCasePath,
  resolveCaseRowsForSnapshot,
} from "./caseCatalogMove";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE_A = `${PROJECT}/login`;
const SUITE_B = `${PROJECT}/signup`;
const CASE_A = `${SUITE_A}/case_one.yaml`;
const CASE_B = `${SUITE_A}/case_two.yaml`;

describe("computeCaseMovePath", () => {
  it("joins target folder with filename", () => {
    expect(computeCaseMovePath(CASE_A, SUITE_B)).toBe(`${SUITE_B}/case_one.yaml`);
  });

  it("normalizes trailing slashes on target", () => {
    expect(computeCaseMovePath(CASE_A, `${SUITE_B}/`)).toBe(`${SUITE_B}/case_one.yaml`);
  });
});

describe("computeRenamedCasePath", () => {
  it("replaces filename stem and preserves extension", () => {
    expect(computeRenamedCasePath(CASE_A, "renamed_case")).toBe(`${SUITE_A}/renamed_case.yaml`);
  });

  it("preserves .yml extension", () => {
    const ymlPath = `${SUITE_A}/old_name.yml`;
    expect(computeRenamedCasePath(ymlPath, "new_name")).toBe(`${SUITE_A}/new_name.yml`);
  });

  it("normalizes backslashes", () => {
    expect(computeRenamedCasePath(CASE_A.replace(/\//g, "\\"), "renamed")).toBe(
      `${SUITE_A}/renamed.yaml`,
    );
  });
});

describe("parentFolderOfCasePath", () => {
  it("returns parent directory", () => {
    expect(parentFolderOfCasePath(CASE_A)).toBe(SUITE_A);
  });
});

describe("buildCaseMoves", () => {
  it("builds moves for paths not already in target", () => {
    const moves = buildCaseMoves([CASE_A, CASE_B], SUITE_B);
    expect(moves).toEqual([
      { oldPath: CASE_A, newPath: `${SUITE_B}/case_one.yaml` },
      { oldPath: CASE_B, newPath: `${SUITE_B}/case_two.yaml` },
    ]);
  });

  it("skips paths already in target folder", () => {
    const moves = buildCaseMoves([`${SUITE_B}/existing.yaml`, CASE_A], SUITE_B);
    expect(moves).toEqual([{ oldPath: CASE_A, newPath: `${SUITE_B}/case_one.yaml` }]);
  });

  it("returns empty when all paths are no-ops", () => {
    expect(buildCaseMoves([`${SUITE_B}/existing.yaml`], SUITE_B)).toEqual([]);
  });
});

describe("buildMovedCaseRows", () => {
  it("preserves title and case_id with updated file_path", () => {
    const moves = buildCaseMoves([CASE_A], SUITE_B);
    const sourceRows = [
      { file_path: CASE_A, case_id: "TLS-0001", title: "Login flow" },
    ];
    expect(buildMovedCaseRows(moves, sourceRows)).toEqual([
      {
        file_path: `${SUITE_B}/case_one.yaml`,
        case_id: "TLS-0001",
        title: "Login flow",
      },
    ]);
  });

  it("falls back to minimal row when source metadata is missing", () => {
    const moves = buildCaseMoves([CASE_A], SUITE_B);
    expect(buildMovedCaseRows(moves, [])).toEqual([
      { file_path: `${SUITE_B}/case_one.yaml` },
    ]);
  });

  it("maps each move independently for multi-select", () => {
    const moves = buildCaseMoves([CASE_A, CASE_B], SUITE_B);
    const sourceRows = [
      { file_path: CASE_A, case_id: "TLS-0001", title: "One" },
      { file_path: CASE_B, case_id: "TLS-0002", title: "Two" },
    ];
    expect(buildMovedCaseRows(moves, sourceRows)).toEqual([
      {
        file_path: `${SUITE_B}/case_one.yaml`,
        case_id: "TLS-0001",
        title: "One",
      },
      {
        file_path: `${SUITE_B}/case_two.yaml`,
        case_id: "TLS-0002",
        title: "Two",
      },
    ]);
  });
});

describe("findCaseRowInCatalog", () => {
  it("finds row in prefix map", () => {
    const map = new Map([
      [PROJECT, [{ file_path: CASE_A, title: "One" }]],
    ]);
    expect(findCaseRowInCatalog(map, [], CASE_A)).toEqual({
      file_path: CASE_A,
      title: "One",
    });
  });

  it("falls back to search results", () => {
    const map = new Map();
    const search = [{ file_path: CASE_A, title: "Search hit" }];
    expect(findCaseRowInCatalog(map, search, CASE_A)).toEqual({
      file_path: CASE_A,
      title: "Search hit",
    });
  });
});

describe("resolveCaseRowsForSnapshot", () => {
  it("prefers UI row, then list window, then catalog", () => {
    const rows = resolveCaseRowsForSnapshot(
      [CASE_A, CASE_B],
      { row: { file_path: CASE_A, title: "From payload" } },
      [{ file_path: CASE_B, title: "From list window" }],
      [{ file_path: CASE_A, title: "From catalog" }],
    );
    expect(rows).toEqual([
      { file_path: CASE_A, title: "From payload" },
      { file_path: CASE_B, title: "From list window" },
    ]);
  });

  it("falls back to minimal rows when no source has data", () => {
    expect(resolveCaseRowsForSnapshot([CASE_A], {}, [], [])).toEqual([{ file_path: CASE_A }]);
  });
});

describe("buildCaseActionPayload", () => {
  it("returns single-row payload", () => {
    const clicked = { file_path: CASE_A, title: "One" };
    expect(buildCaseActionPayload([CASE_A], clicked)).toEqual({
      file_path: CASE_A,
      row: clicked,
    });
  });

  it("returns bulk payload with known rows", () => {
    const clicked = { file_path: CASE_A, title: "One" };
    const known = [{ file_path: CASE_B, title: "Two" }];
    expect(buildCaseActionPayload([CASE_A, CASE_B], clicked, known)).toEqual({
      file_paths: [CASE_A, CASE_B],
      rows: [clicked, { file_path: CASE_B, title: "Two" }],
    });
  });
});

describe("applyCaseMovesToCatalogMaps", () => {
  it("removes from source prefix and adds to target prefix", () => {
    const casesByPrefix = new Map([
      [PROJECT, [{ file_path: CASE_A, title: "One" }]],
    ]);
    const { casesByPrefix: next, applied } = applyCaseMovesToCatalogMaps(
      casesByPrefix,
      [],
      [{ oldPath: CASE_A, newPath: `${SUITE_B}/case_one.yaml` }],
    );

    expect(applied).toHaveLength(1);
    expect(casesByPrefix.get(PROJECT)).toHaveLength(1);
    expect(next.get(PROJECT)).toHaveLength(0);
    expect(next.get(SUITE_B)).toEqual([
      { file_path: `${SUITE_B}/case_one.yaml`, title: "One" },
    ]);
  });

  it("updates search results when row was in search", () => {
    const casesByPrefix = new Map();
    const searchResults = [{ file_path: CASE_A, title: "One" }];
    const { searchResults: next } = applyCaseMovesToCatalogMaps(
      casesByPrefix,
      searchResults,
      [{ oldPath: CASE_A, newPath: `${SUITE_B}/case_one.yaml` }],
    );

    expect(next).toEqual([{ file_path: `${SUITE_B}/case_one.yaml`, title: "One" }]);
  });

  it("supports rollback by removing new paths and re-adding original rows", () => {
    const casesByPrefix = new Map([
      [SUITE_A, [{ file_path: CASE_A, title: "One" }]],
    ]);
    const move = [{ oldPath: CASE_A, newPath: `${SUITE_B}/case_one.yaml` }];
    const { casesByPrefix: moved, applied } = applyCaseMovesToCatalogMaps(
      casesByPrefix,
      [],
      move,
    );

    const originalRows = applied.filter((a) => a.row).map((a) => a.row);
    const newPaths = new Set(applied.map((a) => a.newPath));
    const rolled = new Map(moved);

    for (const [prefix, rows] of rolled.entries()) {
      rolled.set(
        prefix,
        rows.filter((r) => !newPaths.has(r.file_path)),
      );
    }
    for (const row of originalRows) {
      const parent = parentFolderOfCasePath(row.file_path);
      const existing = rolled.get(parent) ?? [];
      rolled.set(parent, [...existing, row]);
    }

    expect(rolled.get(SUITE_A)).toEqual([{ file_path: CASE_A, title: "One" }]);
    expect(rolled.get(SUITE_B) ?? []).toHaveLength(0);
  });
});
