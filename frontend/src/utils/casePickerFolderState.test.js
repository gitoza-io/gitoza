import { describe, expect, it } from "vitest";
import { buildDirectoryRowIndex } from "./casePickerSelection.js";
import {
  countSelectableUnderDirectory,
  countSelectedUnderDirectory,
  formatPickerSelectionLabel,
  getFolderPickerCheckboxState,
  getPickerFolderBadgeCount,
  isPrefixCoveredByLoadedPrefixes,
} from "./casePickerFolderState.js";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE = `${PROJECT}/login`;

describe("countSelectedUnderDirectory", () => {
  it("counts paths under the directory prefix", () => {
    const selected = new Set([
      `${SUITE}/a.yaml`,
      `${SUITE}/b.yaml`,
      `${PROJECT}/other/x.yaml`,
    ]);
    expect(countSelectedUnderDirectory(selected, SUITE)).toBe(2);
  });
});

describe("countSelectableUnderDirectory", () => {
  it("counts rows under prefix with optional filter", () => {
    const rows = [
      { file_path: `${SUITE}/a.yaml` },
      { file_path: `${SUITE}/b.yaml` },
      { file_path: `${PROJECT}/other/x.yaml` },
    ];
    expect(countSelectableUnderDirectory(rows, SUITE)).toBe(2);
    expect(
      countSelectableUnderDirectory(rows, SUITE, (p) => p.endsWith("a.yaml")),
    ).toBe(1);
  });
});

describe("getFolderPickerCheckboxState", () => {
  const rows = [
    { file_path: `${SUITE}/a.yaml` },
    { file_path: `${SUITE}/b.yaml` },
  ];

  it("returns unchecked when nothing selected", () => {
    expect(
      getFolderPickerCheckboxState({
        directoryPath: SUITE,
        rows,
        selectedFilePaths: new Set(),
      }),
    ).toEqual({
      checked: false,
      indeterminate: false,
      selectableCount: 2,
      pathsForState: [`${SUITE}/a.yaml`, `${SUITE}/b.yaml`],
    });
  });

  it("returns indeterminate when partially selected", () => {
    const state = getFolderPickerCheckboxState({
      directoryPath: SUITE,
      rows,
      selectedFilePaths: new Set([`${SUITE}/a.yaml`]),
    });
    expect(state.checked).toBe(false);
    expect(state.indeterminate).toBe(true);
  });

  it("returns checked when all paths under prefix are selected", () => {
    const state = getFolderPickerCheckboxState({
      directoryPath: SUITE,
      rows,
      selectedFilePaths: new Set([`${SUITE}/a.yaml`, `${SUITE}/b.yaml`]),
    });
    expect(state.checked).toBe(true);
    expect(state.indeterminate).toBe(false);
  });

  it("includes selected paths not yet in loaded rows for tri-state", () => {
    const state = getFolderPickerCheckboxState({
      directoryPath: SUITE,
      rows: [{ file_path: `${SUITE}/a.yaml` }],
      selectedFilePaths: new Set([`${SUITE}/a.yaml`, `${SUITE}/b.yaml`]),
    });
    expect(state.indeterminate).toBe(false);
    expect(state.checked).toBe(true);
    expect(state.pathsForState).toContain(`${SUITE}/b.yaml`);
  });

  it("respects filterPath", () => {
    const state = getFolderPickerCheckboxState({
      directoryPath: SUITE,
      rows,
      selectedFilePaths: new Set([`${SUITE}/a.yaml`]),
      filterPath: (p) => p.endsWith("a.yaml"),
    });
    expect(state.selectableCount).toBe(1);
    expect(state.checked).toBe(true);
  });
});

describe("isPrefixCoveredByLoadedPrefixes", () => {
  it("returns true for exact or ancestor loaded prefix", () => {
    const loaded = new Set([PROJECT]);
    expect(isPrefixCoveredByLoadedPrefixes(PROJECT, loaded)).toBe(true);
    expect(isPrefixCoveredByLoadedPrefixes(SUITE, loaded)).toBe(true);
    expect(isPrefixCoveredByLoadedPrefixes(`${PROJECT}/other`, loaded)).toBe(true);
  });

  it("returns false when only descendant prefix is loaded", () => {
    const loaded = new Set([SUITE]);
    expect(isPrefixCoveredByLoadedPrefixes(PROJECT, loaded)).toBe(false);
    expect(isPrefixCoveredByLoadedPrefixes(SUITE, loaded)).toBe(true);
  });
});

describe("getPickerFolderBadgeCount", () => {
  const rows = [
    { file_path: `${SUITE}/a.yaml` },
    { file_path: `${SUITE}/b.yaml` },
  ];

  it("falls back to server count before lazy data is available", () => {
    expect(
      getPickerFolderBadgeCount({
        directoryPath: SUITE,
        pickerRows: [],
        loadedPrefixes: new Set(),
        serverCaseCount: 5,
      }),
    ).toBe(5);
  });

  it("uses lazy count once prefix is covered", () => {
    expect(
      getPickerFolderBadgeCount({
        directoryPath: SUITE,
        pickerRows: rows,
        loadedPrefixes: new Set([PROJECT]),
        serverCaseCount: 99,
      }),
    ).toBe(2);
  });

  it("uses lazy count when rows are present even if loadedPrefixes is empty", () => {
    expect(
      getPickerFolderBadgeCount({
        directoryPath: SUITE,
        pickerRows: rows,
        loadedPrefixes: new Set(),
        serverCaseCount: 99,
      }),
    ).toBe(2);
  });

  it("uses precomputed directoryIndex when provided", () => {
    const directoryIndex = buildDirectoryRowIndex(rows);
    expect(
      getPickerFolderBadgeCount({
        directoryPath: SUITE,
        pickerRows: [],
        loadedPrefixes: new Set(),
        serverCaseCount: 99,
        directoryIndex,
      }),
    ).toBe(2);
  });

  it("uses server count when lazy rows are absent even if prefix is loaded", () => {
    expect(
      getPickerFolderBadgeCount({
        directoryPath: SUITE,
        pickerRows: [],
        loadedPrefixes: new Set([PROJECT]),
        serverCaseCount: 42,
      }),
    ).toBe(42);
  });
});

describe("formatPickerSelectionLabel", () => {
  it("formats N of M selected", () => {
    expect(formatPickerSelectionLabel(3, 10)).toBe("3 of 10 selected");
  });

  it("returns null when total is zero", () => {
    expect(formatPickerSelectionLabel(0, 0)).toBeNull();
  });
});
