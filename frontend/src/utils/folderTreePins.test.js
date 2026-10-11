import { describe, expect, it } from "vitest";
import {
  collectProjectDirectoryPaths,
  prunePinnedProjects,
  sortTreeWithPinnedProjects,
} from "./folderTreePins";

const repoProjects = [
  {
    name: "zebra.gitoza.test",
    display_name: "Zebra",
    directory_path: ".gitoza/test/cases/zebra",
    is_project: true,
    children: [],
  },
  {
    name: "alpha.gitoza.test",
    display_name: "Alpha",
    directory_path: ".gitoza/test/cases/alpha",
    is_project: true,
    children: [],
  },
  {
    name: "beta.gitoza.test",
    display_name: "Beta",
    directory_path: ".gitoza/test/cases/beta",
    is_project: true,
    children: [],
  },
];

describe("sortTreeWithPinnedProjects", () => {
  it("puts pinned root projects first, alphabetical among pinned", () => {
    const pinned = new Set([".gitoza/test/cases/zebra", ".gitoza/test/cases/beta"]);
    const sorted = sortTreeWithPinnedProjects(repoProjects, pinned);
    expect(sorted.map((n) => n.directory_path)).toEqual([
      ".gitoza/test/cases/beta",
      ".gitoza/test/cases/zebra",
      ".gitoza/test/cases/alpha",
    ]);
  });

  it("sorts ticket project paths the same way (Tickets page reuse)", () => {
    const ticketProjects = [
      {
        name: "Zebra",
        display_name: "Zebra",
        directory_path: ".gitoza/tasks/tickets/Zebra",
        is_project: true,
        children: [],
      },
      {
        name: "Alpha",
        display_name: "Alpha",
        directory_path: ".gitoza/tasks/tickets/Alpha",
        is_project: true,
        children: [],
      },
      {
        name: "Beta",
        display_name: "Beta",
        directory_path: ".gitoza/tasks/tickets/Beta",
        is_project: true,
        children: [],
      },
    ];
    const pinned = new Set([
      ".gitoza/tasks/tickets/Zebra",
      ".gitoza/tasks/tickets/Beta",
    ]);
    const sorted = sortTreeWithPinnedProjects(ticketProjects, pinned);
    expect(sorted.map((n) => n.directory_path)).toEqual([
      ".gitoza/tasks/tickets/Beta",
      ".gitoza/tasks/tickets/Zebra",
      ".gitoza/tasks/tickets/Alpha",
    ]);
  });

  it("preserves relative order of unpinned siblings", () => {
    const sorted = sortTreeWithPinnedProjects(repoProjects, new Set());
    expect(sorted.map((n) => n.directory_path)).toEqual([
      ".gitoza/test/cases/zebra",
      ".gitoza/test/cases/alpha",
      ".gitoza/test/cases/beta",
    ]);
  });

  it("reorders nested projects under a run only within that run", () => {
    const runTree = [
      {
        is_run: true,
        is_project: true,
        name: "Run A",
        directory_path: "__run__/run-1",
        children: [
          {
            name: "z.gitoza.test",
            display_name: "Z Project",
            directory_path: "__run__/run-1/.gitoza/test/cases/z",
            is_project: true,
            children: [],
          },
          {
            name: "a.gitoza.test",
            display_name: "A Project",
            directory_path: "__run__/run-1/.gitoza/test/cases/a",
            is_project: true,
            children: [],
          },
        ],
      },
    ];
    const pinned = new Set(["__run__/run-1/.gitoza/test/cases/z"]);
    const sorted = sortTreeWithPinnedProjects(runTree, pinned);
    expect(sorted[0].directory_path).toBe("__run__/run-1");
    expect(sorted[0].children.map((n) => n.directory_path)).toEqual([
      "__run__/run-1/.gitoza/test/cases/z",
      "__run__/run-1/.gitoza/test/cases/a",
    ]);
  });

  it("does not move suites or runs to root", () => {
    const tree = [
      {
        is_run: true,
        is_project: true,
        name: "Run 1",
        directory_path: "__run__/run-1",
        children: [],
      },
      {
        name: "auth.gitoza.test",
        directory_path: ".gitoza/test/cases/auth",
        is_project: true,
        children: [{ name: "debug", directory_path: ".gitoza/test/cases/auth/debug", children: [] }],
      },
    ];
    const pinned = new Set([".gitoza/test/cases/auth/debug"]);
    const sorted = sortTreeWithPinnedProjects(tree, pinned);
    expect(sorted[0].directory_path).toBe("__run__/run-1");
    expect(sorted[1].children[0].name).toBe("debug");
  });
});

describe("prunePinnedProjects", () => {
  it("removes paths not present in tree", () => {
    const tree = [repoProjects[1]];
    const pruned = prunePinnedProjects(
      [".gitoza/test/cases/alpha", ".gitoza/test/cases/missing"],
      tree,
    );
    expect(pruned).toEqual([".gitoza/test/cases/alpha"]);
  });

  it("collectProjectDirectoryPaths finds nested projects", () => {
    const paths = collectProjectDirectoryPaths([
      {
        is_run: true,
        is_project: true,
        directory_path: "__run__/r1",
        children: [
          {
            is_project: true,
            directory_path: "__run__/r1/.gitoza/test/cases/p1",
            children: [],
          },
        ],
      },
    ]);
    expect(paths.has("__run__/r1/.gitoza/test/cases/p1")).toBe(true);
    expect(paths.has("__run__/r1")).toBe(false);
  });
});
