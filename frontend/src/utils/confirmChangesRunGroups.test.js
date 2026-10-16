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
    expect(parseRunDirFromShardPath(`${RUN_DIR}/head.md`)).toBe(RUN_DIR);
    expect(parseRunDirFromShardPath(`${RUN_DIR}/cases.md`)).toBe(RUN_DIR);
    expect(parseRunDirFromShardPath(`${RUN_DIR}/results.md`)).toBe(RUN_DIR);
  });

  it("returns null for non-shard paths", () => {
    expect(parseRunDirFromShardPath(".gitoza/test/runs/sprint_42/notes.txt")).toBeNull();
    expect(parseRunDirFromShardPath(".gitoza/test/cases/a/c1.md")).toBeNull();
  });
});

describe("groupRunChangedFiles", () => {
  it("groups three shard paths into one run with ordered paths", () => {
    const paths = [
      `${RUN_DIR}/results.md`,
      `${RUN_DIR}/head.md`,
      `${RUN_DIR}/cases.md`,
    ];
    const groups = groupRunChangedFiles(paths);
    expect(groups).toHaveLength(1);
    expect(groups[0].runId).toBe("sprint_42");
    expect(groups[0].archived).toBe(false);
    expect(groups[0].paths).toEqual([
      `${RUN_DIR}/head.md`,
      `${RUN_DIR}/cases.md`,
      `${RUN_DIR}/results.md`,
    ]);
  });

  it("marks archive groups and formats fallback label", () => {
    const paths = [`${ARCHIVE_DIR}/head.md`, `${ARCHIVE_DIR}/cases.md`];
    const groups = groupRunChangedFiles(paths);
    expect(groups).toHaveLength(1);
    expect(groups[0].archived).toBe(true);
    expect(runGroupFallbackLabel(groups[0].runDir)).toBe("old_run (archived)");
  });

  it("creates separate groups for different runs", () => {
    const groups = groupRunChangedFiles([
      `${RUN_DIR}/head.md`,
      ".gitoza/test/runs/other_run/head.md",
    ]);
    expect(groups).toHaveLength(2);
  });

  it("omits non-shard run paths", () => {
    const groups = groupRunChangedFiles([
      `${RUN_DIR}/head.md`,
      ".gitoza/test/runs/legacy/single.md",
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].paths).toEqual([`${RUN_DIR}/head.md`]);
  });
});

describe("formatRunGroupSubtitle", () => {
  it("lists changed shards in order", () => {
    expect(
      formatRunGroupSubtitle([`${RUN_DIR}/results.md`, `${RUN_DIR}/head.md`]),
    ).toBe("head · results");
  });
});

describe("buildMergedRunDiff", () => {
  it("joins sections with headers in pair order", () => {
    const merged = buildMergedRunDiff([
      { path: `${RUN_DIR}/head.md`, diff: "+name: Sprint\n" },
      { path: `${RUN_DIR}/cases.md`, diff: "+cases: []\n" },
    ]);
    expect(merged).toContain(`# --- ${RUN_DIR}/head.md ---`);
    expect(merged).toContain("+name: Sprint");
    expect(merged.indexOf("head.md")).toBeLessThan(merged.indexOf("cases.md"));
  });

  it("uses placeholder for empty diff", () => {
    const merged = buildMergedRunDiff([{ path: `${RUN_DIR}/head.md`, diff: "" }]);
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
