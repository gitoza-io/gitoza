import { describe, it, expect } from "vitest";
import {
  mergeListRunCasesIntoDetail,
  mergeRunResultsFromBatchResponse,
  mergeSavedRunResultsPreservingDirty,
  mergeSearchCaseIntoRunDetail,
} from "./mergeRunDetailFromServer";

describe("mergeSearchCaseIntoRunDetail", () => {
  const detail = {
    run: { run_id: "run-a", updated_by: "Alice" },
    cases: [],
  };

  const searchRow = {
    run_id: "run-a",
    file_path: ".gitoza/test/cases/auth/login/a.yaml",
    case_id: "TC-1",
    title: "Login",
    result: "failed",
    priority: "high",
    tags: ["smoke"],
  };

  it("appends a normalized case when missing from cache", () => {
    const merged = mergeSearchCaseIntoRunDetail(detail, searchRow);
    expect(merged.cases).toHaveLength(1);
    expect(merged.cases[0]).toMatchObject({
      file_path: searchRow.file_path,
      case_id: "TC-1",
      title: "Login",
      result: "failed",
      priority: "high",
      tags: ["smoke"],
      directory: ".gitoza/test/cases/auth/login",
    });
  });

  it("does not duplicate an existing cached case", () => {
    const withCase = {
      ...detail,
      cases: [
        {
          file_path: searchRow.file_path,
          case_id: "TC-1",
          title: "Cached title",
          result: "pending",
        },
      ],
    };
    const merged = mergeSearchCaseIntoRunDetail(withCase, searchRow);
    expect(merged).toBe(withCase);
    expect(merged.cases).toHaveLength(1);
    expect(merged.cases[0].title).toBe("Cached title");
  });
});

describe("mergeRunResultsFromBatchResponse", () => {
  it("patches result and preserves title from cache", () => {
    const prev = {
      run: { passed: 0, failed: 0, skipped: 0, updated_at: "old" },
      cases: [
        {
          file_path: ".gitoza/test/cases/a/c1.yaml",
          case_id: "C1",
          title: "Real Title",
          result: "pending",
        },
      ],
    };
    const response = {
      status: "ok",
      updated: 1,
      run: {
        passed: 1,
        failed: 0,
        skipped: 0,
        updated_at: "2026-06-09T12:00:00Z",
        updated_by: "Alice",
      },
      cases: [
        {
          file_path: ".gitoza/test/cases/a/c1.yaml",
          result: "passed",
          executed_at: "2026-06-09T12:00:00Z",
          executed_by: "Alice",
        },
      ],
    };

    const merged = mergeRunResultsFromBatchResponse(prev, response);
    expect(merged.cases[0].title).toBe("Real Title");
    expect(merged.cases[0].result).toBe("passed");
    expect(merged.cases[0].executed_by).toBe("Alice");
    expect(merged.run.passed).toBe(1);
    expect(merged.run.updated_by).toBe("Alice");
  });
});

describe("mergeListRunCasesIntoDetail", () => {
  const pathA = ".gitoza/test/cases/suite-a/c1.yaml";
  const pathB = ".gitoza/test/cases/suite-b/c2.yaml";

  it("preserves unsaved draft when local differs from autosave baseline", () => {
    const prev = {
      run: { run_id: "run-1", passed: 1, failed: 0, skipped: 0 },
      cases: [
        {
          file_path: pathA,
          case_id: "C1",
          title: "Case A",
          result: "passed",
          executed_at: "2026-08-27T10:00:00Z",
          executed_by: "Alice",
        },
      ],
    };
    const prevSaved = [{ file_path: pathA, result: "failed" }];
    const serverItems = [
      {
        file_path: pathA,
        case_id: "C1",
        title: "Case A",
        result: "failed",
        executed_at: "2026-08-01T00:00:00Z",
        executed_by: "Bob",
      },
      {
        file_path: pathB,
        case_id: "C2",
        title: "Case B",
        result: "pending",
      },
    ];

    const { detail, dirtyPaths } = mergeListRunCasesIntoDetail(prev, serverItems, prevSaved);

    expect(dirtyPaths.has(pathA)).toBe(true);
    expect(detail.cases.find((c) => c.file_path === pathA)).toMatchObject({
      result: "passed",
      executed_by: "Alice",
      executed_at: "2026-08-27T10:00:00Z",
    });
    expect(detail.cases.find((c) => c.file_path === pathB)?.result).toBe("pending");
    // Header counts stay authoritative (not recomputed from mixed draft/server rows).
    expect(detail.run.passed).toBe(1);
    expect(detail.run.failed).toBe(0);
    expect(detail.run.skipped).toBe(0);
  });

  it("takes server when local matches autosave baseline (restore/pull)", () => {
    const prev = {
      run: { run_id: "run-1", passed: 1, failed: 0, skipped: 0 },
      cases: [{ file_path: pathA, result: "passed" }],
    };
    const prevSaved = [{ file_path: pathA, result: "passed" }];
    const serverItems = [{ file_path: pathA, result: "failed", title: "Restored" }];

    const { detail, dirtyPaths } = mergeListRunCasesIntoDetail(prev, serverItems, prevSaved);

    expect(dirtyPaths.size).toBe(0);
    expect(detail.cases[0]).toMatchObject({ result: "failed", title: "Restored" });
    // Stale header is preserved here; loadRunHeader / folder-tree rollup refresh counts.
    expect(detail.run.passed).toBe(1);
    expect(detail.run.failed).toBe(0);
  });

  it("preserves existing header counts when merging a case window", () => {
    const prev = {
      run: { run_id: "run-1", passed: 0, failed: 9, skipped: 0 },
      cases: [
        { file_path: pathA, result: "passed" },
        { file_path: pathB, result: "passed" },
      ],
    };
    const prevSaved = [
      { file_path: pathA, result: "passed" },
      { file_path: pathB, result: "passed" },
    ];
    const serverItems = [
      { file_path: pathA, result: "failed" },
      { file_path: pathB, result: "failed" },
    ];

    const { detail, dirtyPaths } = mergeListRunCasesIntoDetail(prev, serverItems, prevSaved);

    expect(dirtyPaths.size).toBe(0);
    expect(detail.cases.find((c) => c.file_path === pathA)?.result).toBe("failed");
    expect(detail.cases.find((c) => c.file_path === pathB)?.result).toBe("failed");
    expect(detail.run.passed).toBe(0);
    expect(detail.run.failed).toBe(9);
    expect(detail.run.skipped).toBe(0);
  });

  it("fills header counts from cases when the run has no counts yet", () => {
    const prev = {
      run: { run_id: "run-1" },
      cases: [{ file_path: pathA, result: "failed" }],
    };
    const serverItems = [{ file_path: pathA, result: "failed", title: "Updated" }];

    const { detail, dirtyPaths } = mergeListRunCasesIntoDetail(prev, serverItems);

    expect(dirtyPaths.size).toBe(0);
    expect(detail.cases[0].title).toBe("Updated");
    expect(detail.run.failed).toBe(1);
    expect(detail.run.passed).toBe(0);
  });
});

describe("mergeSavedRunResultsPreservingDirty", () => {
  const pathA = ".gitoza/test/cases/suite-a/c1.yaml";
  const pathB = ".gitoza/test/cases/suite-b/c2.yaml";

  it("does not reset baseline for dirty paths", () => {
    const prevSaved = [
      { file_path: pathA, result: "failed" },
      { file_path: pathB, result: "pending" },
    ];
    const items = [
      { file_path: pathA, result: "failed" },
      { file_path: pathB, result: "passed" },
    ];
    const dirtyPaths = new Set([pathA]);

    const next = mergeSavedRunResultsPreservingDirty(prevSaved, items, dirtyPaths);

    expect(next.find((r) => r.file_path === pathA)?.result).toBe("failed");
    expect(next.find((r) => r.file_path === pathB)?.result).toBe("passed");
  });
});
