import { describe, expect, it } from "vitest";
import {
  enrichCasesRequirementIdsFromLive,
  joinRequirementIds,
  mergeRunCoversFromCases,
  normalizeRequirementIds,
} from "./requirementIds";

describe("normalizeRequirementIds", () => {
  it("reads canonical list", () => {
    expect(normalizeRequirementIds({ requirement_ids: ["A", "B"] })).toEqual(["A", "B"]);
  });

  it("reads legacy scalar and comma-separated", () => {
    expect(normalizeRequirementIds({ requirement_id: "DEMO-1" })).toEqual(["DEMO-1"]);
    expect(normalizeRequirementIds({ requirement_id: "A, B" })).toEqual(["A", "B"]);
  });

  it("dedupes case-insensitively", () => {
    expect(normalizeRequirementIds({ requirement_ids: ["DEMO-1", "demo-1", ""] })).toEqual([
      "DEMO-1",
    ]);
  });

  it("joins for export", () => {
    expect(joinRequirementIds(["A", "B"])).toBe("A, B");
  });
});

describe("mergeRunCoversFromCases", () => {
  it("unions ids from multiple cases", () => {
    expect(
      mergeRunCoversFromCases(["EXIST-1"], [
        { requirement_ids: ["DEMO-1"] },
        { requirement_ids: ["DEMO-2", "DEMO-3"] },
      ]),
    ).toEqual(["EXIST-1", "DEMO-1", "DEMO-2", "DEMO-3"]);
  });

  it("skips duplicates and case-insensitive dupes", () => {
    expect(
      mergeRunCoversFromCases(["DEMO-1"], [
        { requirement_ids: ["demo-1", "DEMO-2"] },
        { requirement_id: "DEMO-2" },
      ]),
    ).toEqual(["DEMO-1", "DEMO-2"]);
  });

  it("ignores cases with empty requirement fields", () => {
    expect(
      mergeRunCoversFromCases([], [
        { case_id: "a" },
        { requirement_ids: [] },
        { requirement_id: "" },
        { requirement_ids: ["KEEP-1"] },
      ]),
    ).toEqual(["KEEP-1"]);
  });
});

describe("enrichCasesRequirementIdsFromLive", () => {
  it("fills empty run-case snapshots from live case detail", async () => {
    const getDetail = async (fp) => {
      if (fp === "a.md") return { requirement_ids: ["TICK-1"] };
      return { requirement_ids: [] };
    };
    const out = await enrichCasesRequirementIdsFromLive(
      [
        { file_path: "a.md", requirement_ids: [] },
        { file_path: "b.md", requirement_ids: ["KEEP"] },
      ],
      getDetail,
    );
    expect(normalizeRequirementIds(out[0])).toEqual(["TICK-1"]);
    expect(normalizeRequirementIds(out[1])).toEqual(["KEEP"]);
  });
});
