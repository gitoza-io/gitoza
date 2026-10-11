import { describe, expect, it } from "vitest";
import { buildSuiteBreakdownRows } from "./runSuiteBreakdown";

const PROJECT = ".gitoza/test/cases/auth.gitoza.test";
const SUITE = `${PROJECT}/login`;

describe("buildSuiteBreakdownRows", () => {
  it("returns empty array for no cases", () => {
    expect(buildSuiteBreakdownRows([])).toEqual([]);
  });

  it("returns flat rows with breadcrumb labels for nested suites", () => {
    const rows = buildSuiteBreakdownRows([
      {
        file_path: `${PROJECT}/root.yaml`,
        case_id: "TC-1",
        result: "passed",
      },
      {
        file_path: `${SUITE}/a.yaml`,
        case_id: "TC-2",
        result: "failed",
      },
    ]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.some((r) => r.label.includes("auth") && r.stats.totalCases > 0)).toBe(true);
    expect(rows.some((r) => r.label.includes("login"))).toBe(true);
  });

  it("appends Other locations row for non-standard paths", () => {
    const rows = buildSuiteBreakdownRows([
      {
        file_path: "custom/path/case.yaml",
        case_id: "TC-X",
        result: "passed",
      },
    ]);
    const other = rows.find((r) => r.key === "__other_locations__");
    expect(other).toMatchObject({
      label: "Other locations",
      stats: { totalCases: 1, passed: 1, failed: 0, skipped: 0, pending: 0 },
    });
  });
});
