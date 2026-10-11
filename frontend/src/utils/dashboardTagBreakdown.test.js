import { describe, expect, it } from "vitest";
import { buildTagBreakdownRows, caseMatchesTag } from "./dashboardTagBreakdown";

describe("caseMatchesTag", () => {
  it("matches tag case-insensitively", () => {
    expect(caseMatchesTag({ tags: ["Smoke"] }, "smoke")).toBe(true);
    expect(caseMatchesTag({ tags: ["API"] }, "other")).toBe(false);
  });
});

describe("buildTagBreakdownRows", () => {
  const cases = [
    { tags: ["Adm"], result: "passed" },
    { tags: ["Adm"], result: "failed" },
    { tags: ["Smoke"], result: "skipped" },
    { tags: ["api"], result: "pending" },
  ];

  it("returns empty for no selection", () => {
    expect(buildTagBreakdownRows(cases, [])).toEqual([]);
    expect(buildTagBreakdownRows([], ["Adm"])).toEqual([]);
  });

  it("builds stats for one tag", () => {
    const rows = buildTagBreakdownRows(cases, ["Adm"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Adm");
    expect(rows[0].stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
    });
  });

  it("builds one row per tag in selection order", () => {
    const rows = buildTagBreakdownRows(cases, ["Smoke", "api"]);
    expect(rows.map((r) => r.label)).toEqual(["Smoke", "api"]);
    expect(rows[0].stats.totalCases).toBe(1);
    expect(rows[1].stats.pending).toBe(1);
  });

  it("dedupes duplicate selections case-insensitively", () => {
    const rows = buildTagBreakdownRows(cases, ["Adm", "adm"]);
    expect(rows).toHaveLength(1);
  });
});
