import { describe, expect, it } from "vitest";
import {
  buildMergedRunDiff,
  formatRunGroupSubtitle,
  groupRunChangedFiles,
  parseRunDirFromShardPath,
  parseRunTitleFromHeadDiff,
  runGroupFallbackLabel,
} from "./confirmChangesRunGroups.js";

const RUN_DIR = ".gitoza/test/runs/sprint_42";
const ARCHIVE_DIR = ".gitoza/test/runs/.archive/old_run";

describe("parseRunDirFromShardPath", () => {
  it("parses triplet shard paths", () => {
    expect(parseRunDirFromShardPath(`${RUN_DIR}/head.yaml`)).toBe(RUN_DIR);
    expect(parseRunDirFromShardPath(`${RUN_DIR}/cases.yml`)).toBe(RUN_DIR);
    expect(parseRunDirFromShardPath(`${RUN_DIR}/results.yaml`)).toBe(RUN_DIR);
  });

  it("returns null for non-shard paths", () => {
    expect(parseRunDirFromShardPath(".gitoza/test/runs/sprint_42/notes.txt")).toBeNull();
    expect(parseRunDirFromShardPath(".gitoza/test/cases/a/c1.yaml")).toBeNull();
  });
});

describe("groupRunChangedFiles", () => {
  it("groups three shard paths into one run with ordered paths", () => {
    const paths = [
      `${RUN_DIR}/results.yaml`,
      `${RUN_DIR}/head.yaml`,
      `${RUN_DIR}/cases.yaml`,
    ];
    const groups = groupRunChangedFiles(paths);
    expect(groups).toHaveLength(1);
    expect(groups[0].runId).toBe("sprint_42");
    expect(groups[0].archived).toBe(false);
    expect(groups[0].paths).toEqual([
      `${RUN_DIR}/head.yaml`,
      `${RUN_DIR}/cases.yaml`,
      `${RUN_DIR}/results.yaml`,
    ]);
  });

  it("marks archive groups and formats fallback label", () => {
    const paths = [`${ARCHIVE_DIR}/head.yaml`, `${ARCHIVE_DIR}/cases.yaml`];
    const groups = groupRunChangedFiles(paths);
    expect(groups).toHaveLength(1);
    expect(groups[0].archived).toBe(true);
    expect(runGroupFallbackLabel(groups[0].runDir)).toBe("old_run (archived)");
  });

  it("creates separate groups for different runs", () => {
    const groups = groupRunChangedFiles([
      `${RUN_DIR}/head.yaml`,
      ".gitoza/test/runs/other_run/head.yaml",
    ]);
    expect(groups).toHaveLength(2);
  });

  it("omits non-shard run paths", () => {
    const groups = groupRunChangedFiles([
      `${RUN_DIR}/head.yaml`,
      ".gitoza/test/runs/legacy/single.yaml",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].paths).toEqual([`${RUN_DIR}/head.yaml`]);
  });
});

describe("formatRunGroupSubtitle", () => {
  it("lists changed shards in order", () => {
    expect(
      formatRunGroupSubtitle([`${RUN_DIR}/results.yaml`, `${RUN_DIR}/head.yaml`]),
    ).toBe("head · results");
  });
});

describe("buildMergedRunDiff", () => {
  it("joins sections with headers in pair order", () => {
    const merged = buildMergedRunDiff([
      { path: `${RUN_DIR}/head.yaml`, diff: "+name: Sprint\n" },
      { path: `${RUN_DIR}/cases.yaml`, diff: "+cases: []\n" },
    ]);
    expect(merged).toContain(`# --- ${RUN_DIR}/head.yaml ---`);
    expect(merged).toContain("+name: Sprint");
    expect(merged.indexOf("head.yaml")).toBeLessThan(merged.indexOf("cases.yaml"));
  });

  it("uses placeholder for empty diff", () => {
    const merged = buildMergedRunDiff([{ path: `${RUN_DIR}/head.yaml`, diff: "" }]);
    expect(merged).toContain("(no diff)");
  });
});

describe("parseRunTitleFromHeadDiff", () => {
  it("extracts name from diff lines", () => {
    const diff = [
      "@@ -1,2 +1,3 @@",
      "-name: Old",
      "+name: Sprint 42",
    ].join("\n");
    expect(parseRunTitleFromHeadDiff(diff)).toBe("Sprint 42");
  });
});
