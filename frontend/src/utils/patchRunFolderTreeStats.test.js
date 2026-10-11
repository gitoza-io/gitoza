import { describe, it, expect } from "vitest";
import {
  normalizeRunResult,
  applyResultStatsDelta,
  applyRemoveStatsDelta,
  applyAddStatsDelta,
  patchFolderTreeForResultChange,
  patchFolderTreeForRemovals,
  patchFolderTreeForAdditions,
} from "./patchRunFolderTreeStats";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE = `${PROJECT}/login`;

function makeFolderTree() {
  return [
    {
      name: "auth.gitoza.test",
      display_name: "auth",
      directory_path: PROJECT,
      is_project: true,
      case_count: 3,
      result_stats: {
        totalCases: 3,
        passed: 1,
        failed: 0,
        skipped: 0,
        pending: 2,
      },
      children: [
        {
          name: "login",
          display_name: "login",
          directory_path: SUITE,
          is_project: false,
          case_count: 2,
          result_stats: {
            totalCases: 2,
            passed: 0,
            failed: 0,
            skipped: 0,
            pending: 2,
          },
          children: [],
        },
      ],
    },
  ];
}

describe("normalizeRunResult", () => {
  it("maps known results and defaults to pending", () => {
    expect(normalizeRunResult("passed")).toBe("passed");
    expect(normalizeRunResult("failed")).toBe("failed");
    expect(normalizeRunResult("skipped")).toBe("skipped");
    expect(normalizeRunResult("pending")).toBe("pending");
    expect(normalizeRunResult(null)).toBe("pending");
  });
});

describe("applyResultStatsDelta", () => {
  it("moves counts between buckets", () => {
    const stats = { totalCases: 2, passed: 0, failed: 0, skipped: 0, pending: 2 };
    expect(applyResultStatsDelta(stats, "pending", "passed")).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
  });

  it("returns null when results are equal", () => {
    expect(applyResultStatsDelta({ pending: 1 }, "passed", "passed")).toBeNull();
  });
});

describe("applyRemoveStatsDelta", () => {
  it("decrements total and result bucket", () => {
    expect(
      applyRemoveStatsDelta(
        { totalCases: 2, passed: 1, failed: 0, skipped: 0, pending: 1 },
        "passed",
      ),
    ).toEqual({
      totalCases: 1,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
  });
});

describe("patchFolderTreeForResultChange", () => {
  it("updates suite and project nodes for pending to passed", () => {
    const tree = makeFolderTree();
    const filePath = `${SUITE}/a.yaml`;
    const next = patchFolderTreeForResultChange(tree, filePath, "pending", "passed");

    expect(next).not.toBe(tree);
    expect(next[0].result_stats).toEqual({
      totalCases: 3,
      passed: 2,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
    expect(next[0].children[0].result_stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
  });

  it("updates passed to failed", () => {
    const tree = makeFolderTree();
    tree[0].result_stats.passed = 2;
    tree[0].result_stats.pending = 1;
    tree[0].children[0].result_stats = {
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    };

    const filePath = `${SUITE}/a.yaml`;
    const next = patchFolderTreeForResultChange(tree, filePath, "passed", "failed");

    expect(next[0].result_stats.passed).toBe(1);
    expect(next[0].result_stats.failed).toBe(1);
    expect(next[0].children[0].result_stats.passed).toBe(0);
    expect(next[0].children[0].result_stats.failed).toBe(1);
  });

  it("returns same reference when old and new result match", () => {
    const tree = makeFolderTree();
    const next = patchFolderTreeForResultChange(
      tree,
      `${SUITE}/a.yaml`,
      "pending",
      "pending",
    );
    expect(next).toBe(tree);
  });

  it("patches only project node for root-level case", () => {
    const tree = makeFolderTree();
    const filePath = `${PROJECT}/root.yaml`;
    const next = patchFolderTreeForResultChange(tree, filePath, "pending", "passed");

    expect(next[0].result_stats.pending).toBe(1);
    expect(next[0].result_stats.passed).toBe(2);
    expect(next[0].children[0].result_stats.pending).toBe(2);
    expect(next[0].children[0].result_stats.passed).toBe(0);
  });
});

describe("applyAddStatsDelta", () => {
  it("increments total and result bucket", () => {
    expect(
      applyAddStatsDelta(
        { totalCases: 2, passed: 1, failed: 0, skipped: 0, pending: 1 },
        "pending",
      ),
    ).toEqual({
      totalCases: 3,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 2,
    });
  });
});

describe("patchFolderTreeForAdditions", () => {
  it("increments suite and project stats for one addition", () => {
    const tree = makeFolderTree();
    const { tree: next, missingPrefixes } = patchFolderTreeForAdditions(tree, [
      { file_path: `${SUITE}/new.yaml`, result: "pending" },
    ]);

    expect(missingPrefixes).toEqual([]);
    expect(next).not.toBe(tree);
    expect(next[0].case_count).toBe(4);
    expect(next[0].result_stats).toEqual({
      totalCases: 4,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 3,
    });
    expect(next[0].children[0].case_count).toBe(3);
    expect(next[0].children[0].result_stats.pending).toBe(3);
  });

  it("reports missing project prefix when tree has no matching node", () => {
    const tree = makeFolderTree();
    const otherProject = ".gitoza/test/cases/billing";
    const { tree: next, missingPrefixes } = patchFolderTreeForAdditions(tree, [
      { file_path: `${otherProject}/case.yaml`, result: "pending" },
    ]);

    expect(next).toBe(tree);
    expect(missingPrefixes).toEqual([otherProject]);
  });
});

describe("patchFolderTreeForRemovals", () => {
  it("decrements suite and project stats for one removal", () => {
    const tree = makeFolderTree();
    const next = patchFolderTreeForRemovals(tree, [
      { file_path: `${SUITE}/a.yaml`, result: "pending" },
    ]);

    expect(next).not.toBe(tree);
    expect(next[0].case_count).toBe(2);
    expect(next[0].result_stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
    expect(next[0].children[0].case_count).toBe(1);
    expect(next[0].children[0].result_stats).toEqual({
      totalCases: 1,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
  });

  it("applies cumulative deltas for bulk remove", () => {
    const tree = makeFolderTree();
    tree[0].case_count = 2;
    tree[0].result_stats = {
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    };
    tree[0].children[0].result_stats = {
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    };

    const next = patchFolderTreeForRemovals(tree, [
      { file_path: `${SUITE}/a.yaml`, result: "pending" },
      { file_path: `${SUITE}/b.yaml`, result: "passed" },
    ]);

    expect(next[0].case_count).toBe(0);
    expect(next[0].result_stats).toEqual({
      totalCases: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    });
    expect(next[0].children[0].case_count).toBe(0);
    expect(next[0].children[0].result_stats).toEqual({
      totalCases: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    });
  });
});
