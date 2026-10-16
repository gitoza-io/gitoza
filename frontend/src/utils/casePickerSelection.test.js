import { describe, expect, it, vi } from "vitest";
import {
  buildDirectoryRowIndex,
  countFromDirectoryIndex,
  pathsUnderDirectory,
  toggleFolderSelection,
  toggleProjectSelection,
  toggleSuiteSelection,
} from "./casePickerSelection.js";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE = `${PROJECT}/login`;

describe("pathsUnderDirectory", () => {
  it("returns paths under the given directory prefix", () => {
    const rows = [
      { file_path: `${SUITE}/a.md` },
      { file_path: `${SUITE}/b.md` },
      { file_path: `${PROJECT}/other/x.md` },
      { file_path: ".gitoza/test/cases/other/c.md" },
    ];
    expect(pathsUnderDirectory(rows, SUITE)).toEqual([
      `${SUITE}/a.md`,
      `${SUITE}/b.md`,
    ]);
  });
});

describe("toggleFolderSelection", () => {
  it("calls loadCasesForPrefix when toggling", async () => {
    const loadCasesForPrefix = vi.fn(async () => [
      { file_path: `${SUITE}/a.md` },
    ]);
    const setSelectedFilePaths = vi.fn();

    await toggleFolderSelection({
      directoryPath: SUITE,
      rows: [],
      setSelectedFilePaths,
      loadCasesForPrefix,
    });

    expect(loadCasesForPrefix).toHaveBeenCalledWith(SUITE);
    expect(setSelectedFilePaths).toHaveBeenCalledTimes(1);
    const updater = setSelectedFilePaths.mock.calls[0][0];
    const next = updater(new Set());
    expect(next.has(`${SUITE}/a.md`)).toBe(true);
  });

  it("selects all paths on first toggle and deselects on second", async () => {
    const paths = [`${SUITE}/a.md`, `${SUITE}/b.md`];
    const loadCasesForPrefix = vi.fn(async () =>
      paths.map((file_path) => ({ file_path })),
    );
    let selected = new Set();
    const setSelectedFilePaths = vi.fn((updater) => {
      selected = typeof updater === "function" ? updater(selected) : updater;
    });

    await toggleFolderSelection({
      directoryPath: SUITE,
      rows: [],
      setSelectedFilePaths,
      loadCasesForPrefix,
    });
    expect(selected).toEqual(new Set(paths));

    await toggleFolderSelection({
      directoryPath: SUITE,
      rows: [],
      setSelectedFilePaths,
      loadCasesForPrefix,
    });
    expect(selected).toEqual(new Set());
  });

  it("uses rows fallback when load returns empty", async () => {
    const loadCasesForPrefix = vi.fn(async () => []);
    const setSelectedFilePaths = vi.fn();
    const rows = [{ file_path: `${SUITE}/cached.md` }];

    await toggleFolderSelection({
      directoryPath: SUITE,
      rows,
      setSelectedFilePaths,
      loadCasesForPrefix,
    });

    const updater = setSelectedFilePaths.mock.calls[0][0];
    const next = updater(new Set());
    expect(next.has(`${SUITE}/cached.md`)).toBe(true);
  });

  it("applies filterPath to exclude paths (Add Cases scenario)", async () => {
    const inRun = `${SUITE}/in-run.md`;
    const addable = `${SUITE}/addable.md`;
    const loadCasesForPrefix = vi.fn(async () => [
      { file_path: inRun },
      { file_path: addable },
    ]);
    const setSelectedFilePaths = vi.fn();
    const existingInRun = new Set([inRun]);

    await toggleFolderSelection({
      directoryPath: SUITE,
      rows: [],
      setSelectedFilePaths,
      loadCasesForPrefix,
      filterPath: (p) => !existingInRun.has(p),
    });

    const updater = setSelectedFilePaths.mock.calls[0][0];
    const next = updater(new Set());
    expect(next.has(addable)).toBe(true);
    expect(next.has(inRun)).toBe(false);
  });

  it("no-ops when no paths remain after filter", async () => {
    const loadCasesForPrefix = vi.fn(async () => [
      { file_path: `${SUITE}/in-run.md` },
    ]);
    const setSelectedFilePaths = vi.fn();
    const existingInRun = new Set([`${SUITE}/in-run.md`]);

    await toggleFolderSelection({
      directoryPath: SUITE,
      rows: [],
      setSelectedFilePaths,
      loadCasesForPrefix,
      filterPath: (p) => !existingInRun.has(p),
    });

    expect(setSelectedFilePaths).not.toHaveBeenCalled();
  });

  it("no-ops when directoryPath or loadCasesForPrefix is missing", async () => {
    const setSelectedFilePaths = vi.fn();
    await toggleFolderSelection({
      directoryPath: "",
      rows: [],
      setSelectedFilePaths,
      loadCasesForPrefix: vi.fn(),
    });
    expect(setSelectedFilePaths).not.toHaveBeenCalled();
  });
});

describe("buildDirectoryRowIndex", () => {
  const rows = [
    { file_path: `${SUITE}/a.md` },
    { file_path: `${SUITE}/b.md` },
    { file_path: `${SUITE}/nested/c.md` },
    { file_path: `${PROJECT}/other/x.md` },
  ];

  it("builds recursive counts for ancestor directories", () => {
    const { counts } = buildDirectoryRowIndex(rows);
    expect(countFromDirectoryIndex(counts, SUITE)).toBe(3);
    expect(countFromDirectoryIndex(counts, PROJECT)).toBe(4);
    expect(countFromDirectoryIndex(counts, `${PROJECT}/other`)).toBe(1);
  });

  it("groups paths by directory prefix", () => {
    const { pathsByDirectory } = buildDirectoryRowIndex(rows);
    expect(pathsByDirectory.get(SUITE)).toEqual([
      `${SUITE}/a.md`,
      `${SUITE}/b.md`,
      `${SUITE}/nested/c.md`,
    ]);
  });

  it("applies filterPath at build time", () => {
    const { counts } = buildDirectoryRowIndex(rows, {
      filterPath: (p) => p.endsWith("a.md"),
    });
    expect(countFromDirectoryIndex(counts, SUITE)).toBe(1);
    expect(countFromDirectoryIndex(counts, PROJECT)).toBe(1);
  });
});

describe("toggleProjectSelection and toggleSuiteSelection", () => {
  it("are aliases of toggleFolderSelection", () => {
    expect(toggleProjectSelection).toBe(toggleFolderSelection);
    expect(toggleSuiteSelection).toBe(toggleFolderSelection);
  });
});
