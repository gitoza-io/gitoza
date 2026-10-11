import { describe, expect, it } from "vitest";
import {
  collectAssigneesFromCases,
  collectUpdatedByFromCases,
  mergeAssigneesIntoFilters,
  mergeFilterAssignees,
  mergeFilterUpdatedBy,
  mergeUpdatedByIntoFilters,
  paramValuesForKey,
  resolveCanonicalParamKey,
} from "./caseFilters";

describe("resolveCanonicalParamKey", () => {
  it("returns canonical key case-insensitively", () => {
    expect(resolveCanonicalParamKey("environment", ["Environment", "browser"])).toBe(
      "Environment",
    );
  });

  it("returns trimmed input when no catalog match", () => {
    expect(resolveCanonicalParamKey("  custom  ", ["browser"])).toBe("custom");
  });
});

describe("paramValuesForKey", () => {
  const catalog = {
    Environment: ["Staging", "Prod"],
    browser: ["Chrome"],
  };

  it("returns values for canonical key", () => {
    expect(paramValuesForKey("environment", catalog, ["Environment"])).toEqual([
      "Staging",
      "Prod",
    ]);
  });

  it("returns empty array for unknown key", () => {
    expect(paramValuesForKey("missing", catalog, ["Environment"])).toEqual([]);
  });
});

describe("mergeAssigneesIntoFilters", () => {
  it("dedupes assignees case-insensitively and preserves first spelling", () => {
    const result = mergeAssigneesIntoFilters(
      { assigned_to: ["Alice"] },
      ["alice", "Bob", "ALICE"],
    );
    expect(result.assigned_to).toEqual(["Alice", "Bob"]);
  });
});

describe("collectAssigneesFromCases", () => {
  it("collects distinct non-empty assignees from cases", () => {
    expect(
      collectAssigneesFromCases([
        { assigned_to: "Alice" },
        { assigned_to: "alice" },
        { assigned_to: "" },
        { assigned_to: "Bob" },
      ]),
    ).toEqual(["Alice", "Bob"]);
  });
});

describe("mergeFilterAssignees", () => {
  it("unions API, workspace, and case assignees", () => {
    const result = mergeFilterAssignees(
      { assigned_to: ["Alice"], tags: ["smoke"] },
      {
        workspaceUsernames: ["Charlie", "alice"],
        cases: [{ assigned_to: "Dave" }, { assigned_to: "Bob" }],
      },
    );
    expect(result.assigned_to).toEqual(["Alice", "Bob", "Charlie", "Dave"]);
    expect(result.tags).toEqual(["smoke"]);
  });
});

describe("mergeUpdatedByIntoFilters", () => {
  it("dedupes updated_by case-insensitively and preserves first spelling", () => {
    const result = mergeUpdatedByIntoFilters(
      { updated_by: ["Alice"] },
      ["alice", "Bob", "ALICE"],
    );
    expect(result.updated_by).toEqual(["Alice", "Bob"]);
  });
});

describe("collectUpdatedByFromCases", () => {
  it("collects distinct non-empty updated_by from cases", () => {
    expect(
      collectUpdatedByFromCases([
        { updated_by: "Alice" },
        { updated_by: "alice" },
        { updated_by: "" },
        { updated_by: "Bob" },
      ]),
    ).toEqual(["Alice", "Bob"]);
  });
});

describe("mergeFilterUpdatedBy", () => {
  it("unions API, workspace, and case updated_by values", () => {
    const result = mergeFilterUpdatedBy(
      { updated_by: ["Alice"], tags: ["smoke"] },
      {
        workspaceUsernames: ["Charlie", "alice"],
        cases: [{ updated_by: "Dave" }, { updated_by: "Bob" }],
      },
    );
    expect(result.updated_by).toEqual(["Alice", "Bob", "Charlie", "Dave"]);
    expect(result.tags).toEqual(["smoke"]);
  });
});
