import { describe, expect, it } from "vitest";
import {
  buildRunCaseTree,
  buildRunCaseLocationMap,
  buildRunFolderTree,
  buildGroupedRunCaseListEntries,
  buildUnifiedRunTree,
  buildUnifiedRunTreeFromFolderTrees,
  buildUnifiedRunTreeFromSearchResults,
  flattenRunCasePathsInDisplayOrder,
  getRunCasesForFolderSelection,
  findRunFolderDisplayName,
  folderPrefixFromTreePath,
  parseRunTreePath,
  runTreePathForRunId,
} from "./runCaseTree";

const PROJECT = ".gitoza/test/cases/auth";
const SUITE = `${PROJECT}/login`;

describe("buildRunCaseTree", () => {
  it("sorts cases within a suite by case_id, not title", () => {
    const runCases = [
      {
        file_path: `${SUITE}/beta.yaml`,
        case_id: "TC-002",
        title: "Alpha",
      },
      {
        file_path: `${SUITE}/alpha.yaml`,
        case_id: "TC-001",
        title: "Zeta",
      },
    ];

    const tree = buildRunCaseTree(runCases);
    const suite = tree[0].children[0];
    expect(suite.cases.map((c) => c.case_id)).toEqual(["TC-001", "TC-002"]);
  });

  it("sorts direct project cases by case_id, not title", () => {
    const runCases = [
      {
        file_path: `${PROJECT}/beta.yaml`,
        case_id: "TC-002",
        title: "Alpha",
      },
      {
        file_path: `${PROJECT}/alpha.yaml`,
        case_id: "TC-001",
        title: "Zeta",
      },
    ];

    const tree = buildRunCaseTree(runCases);
    expect(tree[0].cases.map((c) => c.case_id)).toEqual(["TC-001", "TC-002"]);
  });
});

describe("flattenRunCasePathsInDisplayOrder", () => {
  it("follows case_id order from buildRunCaseTree", () => {
    const runCases = [
      {
        file_path: `${SUITE}/beta.yaml`,
        case_id: "TC-002",
        title: "Alpha",
      },
      {
        file_path: `${SUITE}/alpha.yaml`,
        case_id: "TC-001",
        title: "Zeta",
      },
    ];

    expect(flattenRunCasePathsInDisplayOrder(runCases)).toEqual([
      `${SUITE}/alpha.yaml`,
      `${SUITE}/beta.yaml`,
    ]);
  });
});

describe("buildRunCaseLocationMap", () => {
  it("maps file_path to listId, index, and listCaseCount", () => {
    const runCases = [
      { file_path: `${SUITE}/b.yaml`, case_id: "TC-002", title: "B" },
      { file_path: `${SUITE}/a.yaml`, case_id: "TC-001", title: "A" },
    ];
    const tree = buildRunCaseTree(runCases);
    const map = buildRunCaseLocationMap(tree);

    expect(map.get(`${SUITE}/a.yaml`)).toEqual({
      listId: SUITE,
      index: 0,
      listCaseCount: 2,
    });
    expect(map.get(`${SUITE}/b.yaml`)).toEqual({
      listId: SUITE,
      index: 1,
      listCaseCount: 2,
    });
  });
});

describe("buildRunFolderTree", () => {
  it("produces RepositoryFolderTree-compatible nodes with case_count", () => {
    const runCases = [
      { file_path: `${PROJECT}/root.yaml`, case_id: "TC-1", title: "Root", result: "passed" },
      { file_path: `${SUITE}/a.yaml`, case_id: "TC-2", title: "A", result: "failed" },
    ];
    const folderTree = buildRunFolderTree(runCases);
    expect(folderTree).toHaveLength(1);
    expect(folderTree[0].directory_path).toBe(PROJECT);
    expect(folderTree[0].is_project).toBe(true);
    expect(folderTree[0].case_count).toBe(2);
    expect(folderTree[0].children).toHaveLength(1);
    expect(folderTree[0].children[0].case_count).toBe(1);
  });

  it("includes result_stats with failed and pending counts", () => {
    const runCases = [
      { file_path: `${PROJECT}/root.yaml`, case_id: "TC-1", title: "Root", result: "passed" },
      { file_path: `${PROJECT}/pending.yaml`, case_id: "TC-2", title: "Pending", result: "pending" },
      { file_path: `${SUITE}/a.yaml`, case_id: "TC-3", title: "A", result: "failed" },
    ];
    const folderTree = buildRunFolderTree(runCases);
    expect(folderTree[0].result_stats).toEqual({
      totalCases: 3,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 1,
    });
    expect(folderTree[0].children[0].result_stats).toEqual({
      totalCases: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      pending: 0,
    });
  });

  it("nests sub-suites under parent suite, not as project siblings", () => {
    const PARENT = `${PROJECT}/02_user_registration`;
    const CHILD = `${PARENT}/01 test`;
    const runCases = [
      { file_path: `${PARENT}/direct.yaml`, case_id: "TC-1", title: "Direct", result: "passed" },
      { file_path: `${CHILD}/nested.yaml`, case_id: "TC-2", title: "Nested", result: "failed" },
    ];
    const folderTree = buildRunFolderTree(runCases);
    expect(folderTree[0].children).toHaveLength(1);
    const parentNode = folderTree[0].children[0];
    expect(parentNode.directory_path).toBe(PARENT);
    expect(parentNode.case_count).toBe(2);
    expect(parentNode.children).toHaveLength(1);
    expect(parentNode.children[0].directory_path).toBe(CHILD);
    expect(parentNode.children[0].case_count).toBe(1);
  });

  it("rolls up parent suite result_stats from nested cases", () => {
    const PARENT = `${PROJECT}/02_user_registration`;
    const CHILD = `${PARENT}/01 test`;
    const runCases = [
      { file_path: `${PARENT}/direct.yaml`, case_id: "TC-1", title: "Direct", result: "passed" },
      { file_path: `${CHILD}/nested.yaml`, case_id: "TC-2", title: "Nested", result: "failed" },
    ];
    const folderTree = buildRunFolderTree(runCases);
    const parentNode = folderTree[0].children[0];
    expect(parentNode.result_stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      pending: 0,
    });
  });
});

describe("getRunCasesForFolderSelection", () => {
  const runCases = [
    { file_path: `${PROJECT}/root.yaml`, case_id: "TC-1", title: "Root", result: "passed" },
    { file_path: `${SUITE}/a.yaml`, case_id: "TC-2", title: "A", result: "failed" },
  ];
  const folderTree = buildRunFolderTree(runCases);

  it("returns recursive cases for project with result preserved", () => {
    const cases = getRunCasesForFolderSelection(runCases, folderTree, PROJECT);
    expect(cases.map((c) => c.case_id)).toEqual(["TC-1", "TC-2"]);
    expect(cases.find((c) => c.case_id === "TC-2")?.result).toBe("failed");
  });

  it("returns recursive cases for leaf suite", () => {
    const cases = getRunCasesForFolderSelection(runCases, folderTree, SUITE);
    expect(cases.map((c) => c.case_id)).toEqual(["TC-2"]);
  });

  it("returns recursive cases for parent suite with nested child folder", () => {
    const PARENT = `${PROJECT}/registration`;
    const CHILD = `${PARENT}/01 test`;
    const nestedRunCases = [
      { file_path: `${PARENT}/direct.yaml`, case_id: "TC-1", title: "Direct", result: "passed" },
      { file_path: `${CHILD}/nested.yaml`, case_id: "TC-2", title: "Nested", result: "failed" },
    ];
    const nestedTree = buildRunFolderTree(nestedRunCases);
    const cases = getRunCasesForFolderSelection(nestedRunCases, nestedTree, PARENT);
    expect(cases.map((c) => c.case_id)).toEqual(["TC-1", "TC-2"]);
    expect(cases.find((c) => c.case_id === "TC-2")?.result).toBe("failed");
  });

  it("scopes folder selection to the selected run when the same file_path exists in multiple runs", () => {
    const runA = "run-a";
    const runB = "run-b";
    const sharedPath = `${SUITE}/a.yaml`;
    const allCases = [
      { run_id: runA, file_path: sharedPath, case_id: "TC-1", title: "A failed", result: "failed" },
      { run_id: runB, file_path: sharedPath, case_id: "TC-1", title: "B passed", result: "passed" },
    ];
    const unified = buildUnifiedRunTreeFromSearchResults(
      [
        { run_id: runA, name: "Smoke", total_cases: 1 },
        { run_id: runB, name: "Regression", total_cases: 1 },
      ],
      allCases,
    );
    const projectPath = `${runTreePathForRunId(runA)}/${PROJECT}`;
    const cases = getRunCasesForFolderSelection(allCases, unified, projectPath);
    expect(cases).toHaveLength(1);
    expect(cases[0].result).toBe("failed");
  });
});

describe("buildGroupedRunCaseListEntries", () => {
  const runId = "run-a";
  const runCases = [
    { file_path: `${PROJECT}/direct.yaml`, case_id: "TC-1", title: "Direct", result: "passed" },
    { file_path: `${SUITE}/a.yaml`, case_id: "TC-2", title: "A", result: "failed" },
  ];
  const unified = buildUnifiedRunTree(
    [{ run_id: runId, name: "Smoke", total_cases: 2 }],
    {
      [runId]: {
        run: { run_id: runId, name: "Smoke", total_cases: 2 },
        cases: runCases,
      },
    },
  );

  it("groups project folder with direct cases then subsuite section", () => {
    const projectPath = `${runTreePathForRunId(runId)}/${PROJECT}`;
    const entries = buildGroupedRunCaseListEntries(runCases, unified, projectPath);
    expect(entries.map((e) => (e.type === "case" ? e.item.case_id : e.label))).toEqual([
      "TC-1",
      "login",
      "TC-2",
    ]);
    expect(entries.find((e) => e.type === "case" && e.item.case_id === "TC-2")?.item.result).toBe(
      "failed",
    );
  });

  it("emits nested suite header at correct depth for parent project selection", () => {
    const PARENT = `${PROJECT}/02_user_registration`;
    const CHILD = `${PARENT}/01 test`;
    const nestedRunCases = [
      { file_path: `${PROJECT}/direct.yaml`, case_id: "TC-1", title: "Direct", result: "passed" },
      { file_path: `${PARENT}/suite-direct.yaml`, case_id: "TC-2", title: "Suite direct", result: "pending" },
      { file_path: `${CHILD}/nested.yaml`, case_id: "TC-3", title: "Nested", result: "failed" },
    ];
    const nestedUnified = buildUnifiedRunTree(
      [{ run_id: runId, name: "Smoke", total_cases: 3 }],
      {
        [runId]: {
          run: { run_id: runId, name: "Smoke", total_cases: 3 },
          cases: nestedRunCases,
        },
      },
    );
    const projectPath = `${runTreePathForRunId(runId)}/${PROJECT}`;
    const entries = buildGroupedRunCaseListEntries(nestedRunCases, nestedUnified, projectPath);
    const suiteHeaders = entries.filter((e) => e.type === "suiteHeader");
    expect(suiteHeaders.map((e) => ({ label: e.label, depth: e.depth }))).toEqual([
      { label: "02 user registration", depth: 0 },
      { label: "01 test", depth: 1 },
    ]);
  });
});

describe("findRunFolderDisplayName", () => {
  it("returns display name for suite folder", () => {
    const folderTree = buildRunFolderTree([
      { file_path: `${SUITE}/a.yaml`, case_id: "TC-1", title: "A" },
    ]);
    expect(findRunFolderDisplayName(folderTree, SUITE)).toBe("login");
  });
});

describe("buildUnifiedRunTreeFromSearchResults", () => {
  it("builds pruned run tree from matching cases only", () => {
    const runs = [
      { run_id: "run-a", name: "Smoke", total_cases: 2 },
      { run_id: "run-b", name: "Other", total_cases: 1 },
    ];
    const matchingCases = [
      {
        run_id: "run-a",
        file_path: `${PROJECT}/root.yaml`,
        case_id: "TC-1",
        title: "Root",
        result: "failed",
      },
      {
        run_id: "run-a",
        file_path: `${SUITE}/a.yaml`,
        case_id: "TC-2",
        title: "A",
        result: "pending",
      },
    ];
    const tree = buildUnifiedRunTreeFromSearchResults(runs, matchingCases);
    expect(tree).toHaveLength(1);
    expect(tree[0].run_id).toBe("run-a");
    expect(tree[0].case_count).toBe(2);
    expect(tree[0].result_stats).toEqual({
      totalCases: 2,
      passed: 0,
      failed: 1,
      skipped: 0,
      pending: 1,
    });
    expect(tree[0].children).toHaveLength(1);
  });
});

describe("buildUnifiedRunTree", () => {
  it("uses listRuns summary for result_stats before run detail is loaded", () => {
    const runs = [
      {
        run_id: "run-a",
        name: "Smoke",
        total_cases: 10,
        passed: 6,
        failed: 2,
        skipped: 1,
      },
    ];
    const tree = buildUnifiedRunTree(runs, {});
    expect(tree[0].result_stats).toEqual({
      totalCases: 10,
      passed: 6,
      failed: 2,
      skipped: 1,
      pending: 1,
    });
    expect(tree[0].children).toEqual([]);
  });

  it("nests repo projects under run root nodes", () => {
    const runs = [{ run_id: "run-a", name: "Smoke", total_cases: 2 }];
    const runDetailsByRunId = {
      "run-a": {
        run: { run_id: "run-a", name: "Smoke", total_cases: 2 },
        cases: [
          { file_path: `${PROJECT}/root.yaml`, case_id: "TC-1", title: "Root" },
          { file_path: `${SUITE}/a.yaml`, case_id: "TC-2", title: "A" },
        ],
      },
    };
    const tree = buildUnifiedRunTree(runs, runDetailsByRunId);
    expect(tree).toHaveLength(1);
    expect(tree[0].is_run).toBe(true);
    expect(tree[0].directory_path).toBe(runTreePathForRunId("run-a"));
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].directory_path).toBe(
      `${runTreePathForRunId("run-a")}/${PROJECT}`,
    );
    expect(tree[0].result_stats).toEqual({
      totalCases: 2,
      passed: 0,
      failed: 0,
      skipped: 0,
      pending: 2,
    });
  });
});

describe("parseRunTreePath", () => {
  it("detects run root and nested repo folder paths", () => {
    expect(parseRunTreePath(runTreePathForRunId("run-a"))).toEqual({
      runId: "run-a",
      repoPath: null,
      isRunRoot: true,
    });
    expect(parseRunTreePath(`${runTreePathForRunId("run-a")}/${SUITE}`)).toEqual({
      runId: "run-a",
      repoPath: SUITE,
      isRunRoot: false,
    });
  });
});

describe("folderPrefixFromTreePath", () => {
  it("returns repo path for nested folders and null for run root", () => {
    expect(folderPrefixFromTreePath(runTreePathForRunId("run-a"))).toBeNull();
    expect(folderPrefixFromTreePath(`${runTreePathForRunId("run-a")}/${SUITE}`)).toBe(SUITE);
  });
});

describe("getRunCasesForFolderSelection unified paths", () => {
  const runCases = [
    { file_path: `${PROJECT}/root.yaml`, case_id: "TC-1", title: "Root", result: "passed" },
    { file_path: `${SUITE}/a.yaml`, case_id: "TC-2", title: "A", result: "failed" },
  ];

  it("returns all cases when run root is selected", () => {
    const cases = getRunCasesForFolderSelection(runCases, [], runTreePathForRunId("run-a"));
    expect(cases.map((c) => c.case_id)).toEqual(["TC-1", "TC-2"]);
  });
});

describe("buildUnifiedRunTreeFromFolderTrees", () => {
  it("builds run roots from server folder trees without full case lists", () => {
    const runs = [{ run_id: "run-a", name: "Sprint 1", total_cases: 2, passed: 1, failed: 0, skipped: 0 }];
    const headers = { "run-a": { run: runs[0] } };
    const folderTrees = {
      "run-a": [
        {
          name: "auth.gitoza.test",
          display_name: "auth",
          directory_path: PROJECT,
          is_project: true,
          case_count: 2,
          result_stats: { totalCases: 2, passed: 1, failed: 0, skipped: 0, pending: 1 },
          children: [],
        },
      ],
    };
    const tree = buildUnifiedRunTreeFromFolderTrees(runs, headers, folderTrees);
    expect(tree).toHaveLength(1);
    expect(tree[0].case_count).toBe(2);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].directory_path).toBe(`${runTreePathForRunId("run-a")}/${PROJECT}`);
    expect(tree[0].result_stats).toEqual({
      totalCases: 2,
      passed: 1,
      failed: 0,
      skipped: 0,
      pending: 1,
    });
  });

  it("rolls up run-root result_stats from folder tree even when detail.run is stale", () => {
    const runs = [{ run_id: "run-a", name: "1.1.6", total_cases: 9, passed: 9, failed: 0, skipped: 0 }];
    const headers = {
      "run-a": {
        run: { run_id: "run-a", name: "1.1.6", total_cases: 9, passed: 9, failed: 0, skipped: 0 },
        cases: [],
      },
    };
    const folderTrees = {
      "run-a": [
        {
          name: "GitozaApp.gitoza.test",
          display_name: "GitozaApp",
          directory_path: PROJECT,
          is_project: true,
          case_count: 9,
          result_stats: { totalCases: 9, passed: 0, failed: 9, skipped: 0, pending: 0 },
          children: [
            {
              name: "02 dashboard",
              display_name: "02 dashboard",
              directory_path: `${PROJECT}/02 dashboard`,
              case_count: 1,
              result_stats: { totalCases: 1, passed: 0, failed: 1, skipped: 0, pending: 0 },
              children: [],
            },
            {
              name: "04 git sync",
              display_name: "04 git sync",
              directory_path: `${PROJECT}/04 git sync`,
              case_count: 8,
              result_stats: { totalCases: 8, passed: 0, failed: 8, skipped: 0, pending: 0 },
              children: [],
            },
          ],
        },
      ],
    };

    const tree = buildUnifiedRunTreeFromFolderTrees(runs, headers, folderTrees);
    expect(tree[0].result_stats).toEqual({
      totalCases: 9,
      passed: 0,
      failed: 9,
      skipped: 0,
      pending: 0,
    });
    expect(tree[0].children[0].result_stats.failed).toBe(9);
  });
});
