import { describe, expect, it } from "vitest";
import {
  buildRunSummaryRollup,
  mergeSuiteStats,
  statsForCases,
} from "./runSummaryHierarchy";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE = `${PROJECT}/login`;
const NESTED_SUITE = `${SUITE}/smoke`;

describe("statsForCases", () => {
  it("counts passed, failed, skipped, and pending results", () => {
    const stats = statsForCases([
      { result: "passed" },
      { result: "failed" },
      { result: "skipped" },
      { result: "pending" },
      {},
    ]);
    expect(stats).toEqual({
      totalCases: 5,
      passed: 1,
      failed: 1,
      skipped: 1,
      pending: 2,
    });
  });
});

describe("mergeSuiteStats", () => {
  it("sums stats from multiple parts", () => {
    expect(
      mergeSuiteStats(
        { totalCases: 2, passed: 1, failed: 1, skipped: 0, pending: 0 },
        { totalCases: 3, passed: 2, failed: 0, skipped: 1, pending: 0 },
      ),
    ).toEqual({
      totalCases: 5,
      passed: 3,
      failed: 1,
      skipped: 1,
      pending: 0,
    });
  });
});

describe("buildRunSummaryRollup", () => {
  it("returns empty array for no cases", () => {
    expect(buildRunSummaryRollup([])).toEqual([]);
  });

  it("rolls up suite stats to project", () => {
    const rollup = buildRunSummaryRollup([
      { file_path: `${NESTED_SUITE}/a.yaml`, case_id: "TC-1", result: "passed" },
      { file_path: `${NESTED_SUITE}/b.yaml`, case_id: "TC-2", result: "failed" },
    ]);
    expect(rollup).toHaveLength(1);
    const project = rollup[0];
    expect(project.displayName).toBe("auth");
    expect(project.stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
    });
    const smokeSuite = project.children.find((c) => c.displayName === "smoke");
    expect(smokeSuite).toBeDefined();
    expect(smokeSuite.stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
    });
  });

  it("includes direct project-level cases in project stats", () => {
    const rollup = buildRunSummaryRollup([
      { file_path: `${PROJECT}/root.yaml`, case_id: "TC-1", result: "passed" },
      { file_path: `${SUITE}/a.yaml`, case_id: "TC-2", result: "skipped" },
    ]);
    expect(rollup[0].stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
      pending: 0,
    });
    expect(rollup[0].children).toHaveLength(1);
    expect(rollup[0].children[0].stats.totalCases).toBe(1);
  });

  it("does not include cases arrays on rollup nodes", () => {
    const rollup = buildRunSummaryRollup([
      { file_path: `${SUITE}/a.yaml`, case_id: "TC-1", result: "passed" },
    ]);
    expect(rollup[0].cases).toBeUndefined();
    expect(rollup[0].children[0].cases).toBeUndefined();
  });
});
