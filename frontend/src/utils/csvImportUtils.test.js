import { describe, expect, it } from "vitest";
import { buildCasePayloadFromRow } from "./csvImportUtils";

describe("buildCasePayloadFromRow status", () => {
  const baseOptions = {
    directory: ".gitoza/test/cases/proj.gitoza.test",
  };

  const mapping = {
    caseIdColumn: "id",
    titleColumn: "title",
    statusColumn: "status",
  };

  it("maps archived CSV status to default active", () => {
    const result = buildCasePayloadFromRow(
      { id: "TC-1", title: "Case", status: "archived" },
      mapping,
      baseOptions,
      1,
    );
    expect(result.payload?.status).toBe("active");
  });

  it("preserves active status", () => {
    const result = buildCasePayloadFromRow(
      { id: "TC-1", title: "Case", status: "active" },
      mapping,
      baseOptions,
      1,
    );
    expect(result.payload?.status).toBe("active");
  });

  it("splits comma-separated requirement ids", () => {
    const result = buildCasePayloadFromRow(
      { id: "TC-1", title: "Case", req: "DEMO-A, DEMO-B" },
      { ...mapping, requirementIdColumn: "req" },
      baseOptions,
      1,
    );
    expect(result.payload?.requirement_ids).toEqual(["DEMO-A", "DEMO-B"]);
  });

  it("allows empty case id for backend auto-mint", () => {
    const result = buildCasePayloadFromRow(
      { id: "", title: "Auto id case" },
      mapping,
      baseOptions,
      1,
    );
    expect(result.payload?.case_id).toBe("");
    expect(result.payload?.title).toBe("Auto id case");
  });
});
