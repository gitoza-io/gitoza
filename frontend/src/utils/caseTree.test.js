import { describe, expect, it } from "vitest";
import {
  buildGroupedCaseListEntries,
  buildProjectNodesFromDashboard,
  collectExpandKeysForFolderPath,
  collectFolderExpandKeys,
  collectPathKeyForFolderPath,
  getCasesForFolderSelection,
  getCasesInGroupedOrder,
  getDirectCasesInFolder,
  getParentDirectoryPath,
  getRecursiveCasesInFolder,
  mergeFolderSubtreeIntoTree,
  mergeProjectListWithExisting,
  mergeProjectNodesFromDashboard,
  treeContainsDirectoryPath,
} from "./caseTree.js";

describe("getDirectCasesInFolder", () => {
  const rows = [
    { file_path: ".gitoza/test/cases/auth/login.md", case_id: "TC-1", title: "Login" },
    { file_path: ".gitoza/test/cases/auth/debug/smoke.md", case_id: "TC-2", title: "Smoke" },
    { file_path: ".gitoza/test/cases/auth/debug/edge.md", case_id: "TC-3", title: "Edge" },
  ];

  it("returns only direct cases in the folder", () => {
    const auth = getDirectCasesInFolder(rows, ".gitoza/test/cases/auth");
    expect(auth.map((c) => c.case_id)).toEqual(["TC-1"]);

    const debug = getDirectCasesInFolder(rows, ".gitoza/test/cases/auth/debug");
    expect(debug.map((c) => c.case_id)).toEqual(["TC-2", "TC-3"]);
  });

  it("returns empty when directoryPath is missing", () => {
    expect(getDirectCasesInFolder(rows, null)).toEqual([]);
    expect(getDirectCasesInFolder(rows, "")).toEqual([]);
  });
});

describe("getParentDirectoryPath", () => {
  it("returns parent directory of a case file", () => {
    expect(getParentDirectoryPath(".gitoza/test/cases/auth/login.md")).toBe(
      ".gitoza/test/cases/auth",
    );
  });

  it("returns null when no slash", () => {
    expect(getParentDirectoryPath("login.md")).toBeNull();
  });
});

describe("collectFolderExpandKeys", () => {
  it("collects keys from folder tree", () => {
    const tree = [
      {
        name: "auth",
        directory_path: ".gitoza/test/cases/auth",
        children: [{ name: "debug", directory_path: ".gitoza/test/cases/auth/debug", children: [] }],
      },
    ];
    const keys = collectFolderExpandKeys(tree);
    expect(keys.has("auth")).toBe(true);
    expect(keys.has("auth/debug")).toBe(true);
  });
});

describe("getRecursiveCasesInFolder", () => {
  const rows = [
    { file_path: ".gitoza/test/cases/auth/login.md", case_id: "TC-1", title: "Login" },
    { file_path: ".gitoza/test/cases/auth/debug/smoke.md", case_id: "TC-2", title: "Smoke" },
    { file_path: ".gitoza/test/cases/auth/debug/edge.md", case_id: "TC-3", title: "Edge" },
  ];

  it("returns all cases under project prefix", () => {
    const cases = getRecursiveCasesInFolder(rows, ".gitoza/test/cases/auth");
    expect(cases.map((c) => c.case_id)).toEqual(["TC-1", "TC-2", "TC-3"]);
  });
});

describe("getCasesForFolderSelection", () => {
  const rows = [
    { file_path: ".gitoza/test/cases/auth/login.md", case_id: "TC-1", title: "Login" },
    { file_path: ".gitoza/test/cases/auth/debug/smoke.md", case_id: "TC-2", title: "Smoke" },
  ];
  const tree = [
    {
      name: "auth.gitoza.test",
      directory_path: ".gitoza/test/cases/auth",
      is_project: true,
      children: [
        { name: "debug", directory_path: ".gitoza/test/cases/auth/debug", is_project: false, children: [] },
      ],
    },
  ];

  it("uses recursive listing for project nodes", () => {
    const cases = getCasesForFolderSelection(rows, tree, ".gitoza/test/cases/auth");
    expect(cases.map((c) => c.case_id)).toEqual(["TC-1", "TC-2"]);
  });

  it("uses recursive listing for leaf suite nodes", () => {
    const cases = getCasesForFolderSelection(rows, tree, ".gitoza/test/cases/auth/debug");
    expect(cases.map((c) => c.case_id)).toEqual(["TC-2"]);
  });

  it("uses recursive listing for parent suite with nested child folders", () => {
    const nestedRows = [
      { file_path: ".gitoza/test/cases/auth/parent/direct.md", case_id: "TC-1", title: "Direct" },
      { file_path: ".gitoza/test/cases/auth/parent/child/nested.md", case_id: "TC-2", title: "Nested" },
    ];
    const nestedTree = [
      {
        name: "auth.gitoza.test",
        directory_path: ".gitoza/test/cases/auth",
        is_project: true,
        children: [
          {
            name: "parent",
            directory_path: ".gitoza/test/cases/auth/parent",
            is_project: false,
            children: [
              {
                name: "child",
                directory_path: ".gitoza/test/cases/auth/parent/child",
                is_project: false,
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const cases = getCasesForFolderSelection(
      nestedRows,
      nestedTree,
      ".gitoza/test/cases/auth/parent",
    );
    expect(cases.map((c) => c.case_id)).toEqual(["TC-1", "TC-2"]);
  });
});

describe("buildGroupedCaseListEntries", () => {
  const rows = [
    { file_path: ".gitoza/test/cases/auth/login.md", case_id: "TC-1", title: "Login" },
    { file_path: ".gitoza/test/cases/auth/debug/smoke.md", case_id: "TC-2", title: "Smoke" },
    { file_path: ".gitoza/test/cases/auth/debug/edge.md", case_id: "TC-3", title: "Edge" },
  ];
  const tree = [
    {
      name: "auth.gitoza.test",
      directory_path: ".gitoza/test/cases/auth",
      is_project: true,
      children: [
        {
          name: "debug",
          directory_path: ".gitoza/test/cases/auth/debug",
          is_project: false,
          children: [],
        },
      ],
    },
  ];

  it("lists direct cases before subsuite header and nested cases", () => {
    const entries = buildGroupedCaseListEntries(rows, tree, ".gitoza/test/cases/auth");
    expect(entries.map((e) => e.type)).toEqual([
      "case",
      "suiteHeader",
      "case",
      "case",
    ]);
    expect(entries[0].item.case_id).toBe("TC-1");
    expect(entries[1].label).toBe("debug");
    expect(getCasesInGroupedOrder(entries).map((c) => c.case_id)).toEqual(["TC-1", "TC-2", "TC-3"]);
  });

  it("returns only case entries for leaf suite", () => {
    const entries = buildGroupedCaseListEntries(rows, tree, ".gitoza/test/cases/auth/debug");
    expect(entries.every((e) => e.type === "case")).toBe(true);
    expect(entries.map((e) => e.item.case_id)).toEqual(["TC-2", "TC-3"]);
  });

  it("groups parent suite with nested child folder", () => {
    const nestedRows = [
      { file_path: ".gitoza/test/cases/auth/parent/direct.md", case_id: "TC-1", title: "Direct" },
      { file_path: ".gitoza/test/cases/auth/parent/child/nested.md", case_id: "TC-2", title: "Nested" },
    ];
    const nestedTree = [
      {
        name: "auth.gitoza.test",
        directory_path: ".gitoza/test/cases/auth",
        is_project: true,
        children: [
          {
            name: "parent",
            directory_path: ".gitoza/test/cases/auth/parent",
            is_project: false,
            children: [
              {
                name: "child",
                directory_path: ".gitoza/test/cases/auth/parent/child",
                is_project: false,
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const entries = buildGroupedCaseListEntries(
      nestedRows,
      nestedTree,
      ".gitoza/test/cases/auth/parent",
    );
    expect(entries.map((e) => (e.type === "case" ? e.item.case_id : e.label))).toEqual([
      "TC-1",
      "child",
      "TC-2",
    ]);
  });
});

describe("collectExpandKeysForFolderPath", () => {
  const tree = [
    {
      name: "auth",
      directory_path: ".gitoza/test/cases/auth",
      children: [{ name: "debug", directory_path: ".gitoza/test/cases/auth/debug", children: [] }],
    },
  ];

  it("returns ancestor keys for a nested folder", () => {
    const keys = collectExpandKeysForFolderPath(tree, ".gitoza/test/cases/auth/debug");
    expect(keys.has("auth")).toBe(true);
    expect(keys.has("auth/debug")).toBe(false);
  });
});

describe("collectPathKeyForFolderPath", () => {
  const tree = [
    {
      name: "auth",
      directory_path: ".gitoza/test/cases/auth",
      children: [{ name: "debug", directory_path: ".gitoza/test/cases/auth/debug", children: [] }],
    },
  ];

  it("returns full path key for a nested folder", () => {
    expect(collectPathKeyForFolderPath(tree, ".gitoza/test/cases/auth/debug")).toBe("auth/debug");
    expect(collectPathKeyForFolderPath(tree, ".gitoza/test/cases/auth")).toBe("auth");
    expect(collectPathKeyForFolderPath(tree, ".gitoza/test/cases/missing")).toBe(null);
  });
});

describe("buildProjectNodesFromDashboard", () => {
  it("maps dashboard projects to folder nodes with empty children", () => {
    const nodes = buildProjectNodesFromDashboard({
      projects: [
        { project_path: ".gitoza/test/cases/auth", project_name: "Auth", total_test_cases: 3 },
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].directory_path).toBe(".gitoza/test/cases/auth");
    expect(nodes[0].is_project).toBe(true);
    expect(nodes[0].case_count).toBe(3);
    expect(nodes[0].children).toEqual([]);
  });
});

describe("mergeProjectListWithExisting", () => {
  it("preserves loaded children when merging API project nodes", () => {
    const existingTree = [
      {
        directory_path: ".gitoza/test/cases/auth",
        is_project: true,
        children: [{ directory_path: ".gitoza/test/cases/auth/debug", children: [] }],
      },
    ];
    const merged = mergeProjectListWithExisting(existingTree, [
      {
        directory_path: ".gitoza/test/cases/auth",
        is_project: true,
        children: [],
      },
    ]);
    expect(merged[0].children).toHaveLength(1);
  });

  it("returns empty array when API returns no nodes", () => {
    const existingTree = [{ directory_path: ".gitoza/test/cases/auth", children: [] }];
    expect(mergeProjectListWithExisting(existingTree, [])).toEqual([]);
  });

  it("prefers API case_count over stale optimistic zero", () => {
    const existingTree = [
      {
        directory_path: ".gitoza/test/cases/auth",
        is_project: true,
        case_count: 0,
        children: [],
      },
    ];
    const merged = mergeProjectListWithExisting(existingTree, [
      {
        directory_path: ".gitoza/test/cases/auth",
        is_project: true,
        case_count: 3,
        children: [],
      },
    ]);
    expect(merged[0].case_count).toBe(3);
  });
});

describe("mergeProjectNodesFromDashboard", () => {
  it("updates project metadata while preserving loaded suite children", () => {
    const existingTree = [
      {
        directory_path: ".gitoza/test/cases/auth",
        display_name: "Auth",
        is_project: true,
        case_count: 2,
        children: [
          {
            directory_path: ".gitoza/test/cases/auth/debug",
            display_name: "Debug",
            children: [],
          },
        ],
      },
    ];
    const merged = mergeProjectNodesFromDashboard(existingTree, {
      projects: [
        { project_path: ".gitoza/test/cases/auth", project_name: "Auth", total_test_cases: 5 },
      ],
    });
    expect(merged[0].case_count).toBe(5);
    expect(merged[0].children).toHaveLength(1);
    expect(merged[0].children[0].directory_path).toBe(".gitoza/test/cases/auth/debug");
  });

  it("adds a newly restored project from dashboard into an empty browse bucket", () => {
    const merged = mergeProjectNodesFromDashboard(null, {
      projects: [
        {
          project_path: ".gitoza/test/cases/restored.gitoza.test",
          project_name: "restored",
          total_test_cases: 2,
        },
      ],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].directory_path).toBe(".gitoza/test/cases/restored.gitoza.test");
    expect(merged[0].case_count).toBe(2);
  });
});

describe("mergeFolderSubtreeIntoTree", () => {
  it("replaces a project node with loaded subtree children", () => {
    const tree = [
      {
        directory_path: ".gitoza/test/cases/auth",
        display_name: "Auth",
        is_project: true,
        children: [],
      },
    ];
    const loaded = {
      directory_path: ".gitoza/test/cases/auth",
      display_name: "Auth",
      is_project: true,
      children: [{ directory_path: ".gitoza/test/cases/auth/debug", display_name: "Debug", children: [] }],
    };
    const merged = mergeFolderSubtreeIntoTree(tree, ".gitoza/test/cases/auth", loaded);
    expect(merged[0].children).toHaveLength(1);
    expect(merged[0].children[0].directory_path).toBe(".gitoza/test/cases/auth/debug");
  });
});

describe("treeContainsDirectoryPath", () => {
  const wikiTree = [
    {
      name: "architecture",
      directory_path: ".gitoza/wiki/architecture",
      children: [
        { name: "data", directory_path: ".gitoza/wiki/architecture/data", children: [] },
      ],
    },
  ];

  it("finds nested folder paths and treats wiki root as absent", () => {
    expect(treeContainsDirectoryPath(wikiTree, ".gitoza/wiki/architecture/data")).toBe(true);
    expect(treeContainsDirectoryPath(wikiTree, ".gitoza/wiki/architecture")).toBe(true);
    expect(treeContainsDirectoryPath(wikiTree, ".gitoza/wiki")).toBe(false);
    expect(treeContainsDirectoryPath([], ".gitoza/wiki")).toBe(false);
    expect(treeContainsDirectoryPath(wikiTree, null)).toBe(false);
  });
});
