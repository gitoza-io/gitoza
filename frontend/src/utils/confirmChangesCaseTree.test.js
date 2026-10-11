import { describe, expect, it } from "vitest";
import {
  buildChangedCasesFolderTree,
  buildFolderTreeFromCasePaths,
  countChangedCasesUnderFolder,
  findFirstChangedCaseInFolder,
  findFirstChangedFolder,
  pathsToMinimalCaseRows,
  resolveChangedCasesFolderTree,
} from "./confirmChangesCaseTree.js";
import { getCasesForFolderSelection } from "./caseTree.js";

const repositoryTree = [
  {
    name: "auth.gitoza.test",
    display_name: "auth.gitoza.test",
    directory_path: ".gitoza/test/cases/auth",
    is_project: true,
    children: [
      {
        name: "debug",
        display_name: "debug",
        directory_path: ".gitoza/test/cases/auth/debug",
        is_project: false,
        children: [],
      },
      {
        name: "login",
        display_name: "login",
        directory_path: ".gitoza/test/cases/auth/login",
        is_project: false,
        children: [],
      },
    ],
  },
  {
    name: "billing.gitoza.test",
    display_name: "billing.gitoza.test",
    directory_path: ".gitoza/test/cases/billing",
    is_project: true,
    children: [],
  },
];

const changedPaths = [
  ".gitoza/test/cases/auth/login.yaml",
  ".gitoza/test/cases/auth/debug/smoke.yaml",
  ".gitoza/test/cases/auth/debug/edge.yaml",
];

describe("pathsToMinimalCaseRows", () => {
  it("maps paths to minimal rows without IPC", () => {
    const rows = pathsToMinimalCaseRows([".gitoza/test/cases/auth/login.yaml"]);
    expect(rows).toEqual([
      {
        file_path: ".gitoza/test/cases/auth/login.yaml",
        case_id: "login",
        title: "login",
      },
    ]);
  });
});

describe("buildChangedCasesFolderTree", () => {
  it("prunes folders with zero changed cases", () => {
    const tree = buildChangedCasesFolderTree(repositoryTree, changedPaths);
    expect(tree.map((n) => n.directory_path)).toEqual([".gitoza/test/cases/auth"]);
    // login.yaml lives directly under auth; the empty login/ suite folder is pruned
    expect(tree[0].children.map((n) => n.directory_path)).toEqual([
      ".gitoza/test/cases/auth/debug",
    ]);
    expect(tree[0].cases.map((c) => c.file_path)).toContain(".gitoza/test/cases/auth/login.yaml");
    const billing = tree.find((n) => n.directory_path === ".gitoza/test/cases/billing");
    expect(billing).toBeUndefined();
  });

  it("returns empty when no changed paths", () => {
    expect(buildChangedCasesFolderTree(repositoryTree, [])).toEqual([]);
  });
});

describe("findFirstChangedFolder", () => {
  it("returns first folder in depth-first order", () => {
    const tree = buildChangedCasesFolderTree(repositoryTree, changedPaths);
    expect(findFirstChangedFolder(tree)).toBe(".gitoza/test/cases/auth");
  });
});

describe("countChangedCasesUnderFolder", () => {
  const rows = pathsToMinimalCaseRows(changedPaths);

  it("counts changed cases under a project prefix", () => {
    expect(countChangedCasesUnderFolder(rows, ".gitoza/test/cases/auth")).toBe(3);
  });

  it("counts changed cases under a suite prefix", () => {
    expect(countChangedCasesUnderFolder(rows, ".gitoza/test/cases/auth/debug")).toBe(2);
  });
});

describe("buildFolderTreeFromCasePaths", () => {
  it("builds project and nested suite folders from case paths", () => {
    const paths = [
      ".gitoza/test/cases/billing.gitoza.test/login_suite/smoke.yaml",
      ".gitoza/test/cases/billing.gitoza.test/login_suite/edge.yaml",
    ];
    const tree = buildFolderTreeFromCasePaths(paths);
    expect(tree).toHaveLength(1);
    expect(tree[0].directory_path).toBe(".gitoza/test/cases/billing.gitoza.test");
    expect(tree[0].is_project).toBe(true);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].directory_path).toBe(
      ".gitoza/test/cases/billing.gitoza.test/login_suite",
    );
    expect(tree[0].children[0].is_project).toBe(false);
  });
});

describe("resolveChangedCasesFolderTree", () => {
  it("falls back to path-derived tree when API tree has stale project paths", () => {
    const staleTree = [
      {
        name: "auth.gitoza.test",
        display_name: "auth",
        directory_path: ".gitoza/test/cases/auth.gitoza.test",
        is_project: true,
        children: [
          {
            name: "login_suite",
            display_name: "login",
            directory_path: ".gitoza/test/cases/auth.gitoza.test/login_suite",
            is_project: false,
            children: [],
          },
        ],
      },
    ];
    const renamedPaths = [
      ".gitoza/test/cases/billing.gitoza.test/login_suite/smoke.yaml",
      ".gitoza/test/cases/billing.gitoza.test/login_suite/edge.yaml",
    ];
    const tree = resolveChangedCasesFolderTree(staleTree, renamedPaths);
    expect(tree.map((n) => n.directory_path)).toEqual([
      ".gitoza/test/cases/billing.gitoza.test",
    ]);
    expect(tree[0].children.map((n) => n.directory_path)).toEqual([
      ".gitoza/test/cases/billing.gitoza.test/login_suite",
    ]);
    expect(tree[0].children[0].cases.map((c) => c.file_path)).toEqual(
      expect.arrayContaining(renamedPaths),
    );
  });

  it("prefers API tree when paths align", () => {
    const tree = resolveChangedCasesFolderTree(repositoryTree, changedPaths);
    expect(tree.map((n) => n.directory_path)).toEqual([".gitoza/test/cases/auth"]);
  });

  it("builds synthetic tree from paths when API tree is empty", () => {
    const paths = [".gitoza/test/cases/proj.gitoza.test/suite/a.yaml"];
    const tree = resolveChangedCasesFolderTree([], paths);
    expect(tree).toHaveLength(1);
    expect(tree[0].directory_path).toBe(".gitoza/test/cases/proj.gitoza.test");
    expect(tree[0].children[0].cases.map((c) => c.file_path)).toEqual(paths);
  });
});

describe("findFirstChangedCaseInFolder", () => {
  const rows = pathsToMinimalCaseRows(changedPaths);
  const tree = buildChangedCasesFolderTree(repositoryTree, changedPaths);

  it("matches getCasesForFolderSelection for project scope", () => {
    const folderPath = ".gitoza/test/cases/auth";
    const cases = getCasesForFolderSelection(rows, tree, folderPath);
    expect(findFirstChangedCaseInFolder(rows, tree, folderPath)).toBe(cases[0].file_path);
    expect(cases.map((c) => c.case_id)).toEqual(["edge", "login", "smoke"]);
  });

  it("returns first case in suite scope", () => {
    const folderPath = ".gitoza/test/cases/auth/debug";
    expect(findFirstChangedCaseInFolder(rows, tree, folderPath)).toBe(
      ".gitoza/test/cases/auth/debug/edge.yaml",
    );
  });
});
