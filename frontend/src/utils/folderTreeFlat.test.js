import { describe, expect, it } from "vitest";
import { flattenVisibleFolderRows, findFlatRowIndex } from "./folderTreeFlat";

const repoTree = [
  {
    name: "auth.gitoza.test",
    directory_path: ".gitoza/test/cases/auth",
    is_project: true,
    children: [
      {
        name: "debug",
        directory_path: ".gitoza/test/cases/auth/debug",
        is_project: false,
        children: [
          {
            name: "smoke",
            directory_path: ".gitoza/test/cases/auth/debug/smoke",
            is_project: false,
            children: [],
          },
        ],
      },
      {
        name: "login",
        directory_path: ".gitoza/test/cases/auth/login",
        is_project: false,
        children: [],
      },
    ],
  },
  {
    name: "billing.gitoza.test",
    directory_path: ".gitoza/test/cases/billing",
    is_project: true,
    children: [],
  },
];

describe("flattenVisibleFolderRows", () => {
  it("returns only root rows when collapsed", () => {
    const flat = flattenVisibleFolderRows(repoTree, new Set());
    expect(flat).toHaveLength(2);
    expect(flat.every((r) => r.kind === "folder" && r.level === 0)).toBe(true);
    expect(flat.map((r) => r.pathKey)).toEqual(["auth.gitoza.test", "billing.gitoza.test"]);
    expect(flat.every((r) => r.kind !== "folder" || r.isExpanded === false)).toBe(true);
  });

  it("includes nested suites when project is expanded", () => {
    const expanded = new Set(["auth.gitoza.test", "auth.gitoza.test/debug"]);
    const flat = flattenVisibleFolderRows(repoTree, expanded);
    const folderRows = flat.filter((r) => r.kind === "folder");
    expect(folderRows.map((r) => r.pathKey)).toEqual([
      "auth.gitoza.test",
      "auth.gitoza.test/debug",
      "auth.gitoza.test/debug/smoke",
      "auth.gitoza.test/login",
      "billing.gitoza.test",
    ]);
    expect(folderRows.find((r) => r.pathKey === "auth.gitoza.test")?.isExpanded).toBe(true);
    expect(folderRows.find((r) => r.pathKey === "auth.gitoza.test/debug")?.isExpanded).toBe(true);
    expect(folderRows.find((r) => r.pathKey === "auth.gitoza.test/login")?.isExpanded).toBe(false);
    expect(folderRows.find((r) => r.pathKey === "billing.gitoza.test")?.isExpanded).toBe(false);
  });

  it("injects inlineCreate row at correct depth", () => {
    const expanded = new Set(["auth.gitoza.test"]);
    const flat = flattenVisibleFolderRows(repoTree, expanded, {
      creatingInPath: ".gitoza/test/cases/auth",
    });
    const createRow = flat.find((r) => r.kind === "inlineCreate");
    expect(createRow).toMatchObject({
      kind: "inlineCreate",
      level: 1,
      parentPath: ".gitoza/test/cases/auth",
      parentPathKey: "auth.gitoza.test",
    });
  });

  it("flattens unified run tree shape", () => {
    const runTree = [
      {
        is_run: true,
        is_project: true,
        run_id: "run-1",
        name: "Sprint 42",
        directory_path: "__run__/run-1",
        children: [
          {
            name: "auth.gitoza.test",
            directory_path: "__run__/run-1/.gitoza/test/cases/auth",
            is_project: true,
            children: [
              {
                name: "debug",
                directory_path: "__run__/run-1/.gitoza/test/cases/auth/debug",
                is_project: false,
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const expanded = new Set(["Sprint 42", "Sprint 42/auth.gitoza.test"]);
    const flat = flattenVisibleFolderRows(runTree, expanded);
    const folderRows = flat.filter((r) => r.kind === "folder");
    expect(folderRows).toHaveLength(3);
    expect(folderRows[0].node.is_run).toBe(true);
    expect(folderRows[2].pathKey).toBe("Sprint 42/auth.gitoza.test/debug");
  });
});

describe("findFlatRowIndex", () => {
  it("returns index for nested directory_path", () => {
    const expanded = new Set(["auth.gitoza.test", "auth.gitoza.test/debug"]);
    const flat = flattenVisibleFolderRows(repoTree, expanded);
    expect(findFlatRowIndex(flat, ".gitoza/test/cases/auth/debug/smoke")).toBe(2);
  });

  it("returns -1 when path not in flat list", () => {
    const flat = flattenVisibleFolderRows(repoTree, new Set());
    expect(findFlatRowIndex(flat, ".gitoza/test/cases/auth/debug")).toBe(-1);
  });
});
