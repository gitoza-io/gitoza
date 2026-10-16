import { describe, expect, it } from "vitest";
import {
  buildReleaseTree,
  normalizeReleaseId,
  parseReleaseTreePath,
  prunePinnedReleasePaths,
  releaseCacheAction,
  releaseTreePathForProject,
  releaseTreePathForRelease,
  releaseTreePathForReleaseId,
  resolveReleaseTicketBadgeCount,
  sortReleaseTreeWithPins,
} from "./releaseTree";

describe("normalizeReleaseId", () => {
  it("trims and drops empty values", () => {
    expect(normalizeReleaseId("  demo/1.0  ")).toBe("demo/1.0");
    expect(normalizeReleaseId("")).toBe(null);
    expect(normalizeReleaseId("   ")).toBe(null);
    expect(normalizeReleaseId(null)).toBe(null);
    expect(normalizeReleaseId(undefined)).toBe(null);
  });
});

describe("resolveReleaseTicketBadgeCount", () => {
  it("uses API count when tickets are not loaded", () => {
    expect(resolveReleaseTicketBadgeCount(5, null)).toBe(5);
    expect(resolveReleaseTicketBadgeCount(5, undefined)).toBe(5);
    expect(resolveReleaseTicketBadgeCount(undefined, null)).toBe(0);
  });

  it("prefers loaded window total", () => {
    expect(resolveReleaseTicketBadgeCount(5, { total: 2, items: [] })).toBe(2);
  });

  it("shows zero when filter matches nothing", () => {
    expect(resolveReleaseTicketBadgeCount(5, { total: 0, items: [] })).toBe(0);
  });

  it("falls back to items.length when total is missing", () => {
    expect(resolveReleaseTicketBadgeCount(5, { items: [{}, {}] })).toBe(2);
    expect(resolveReleaseTicketBadgeCount(5, {})).toBe(0);
  });
});

describe("releaseCacheAction", () => {
  it("clears: invalidate old only", () => {
    expect(releaseCacheAction("demo/rel-a", "")).toEqual({
      invalidate: ["demo/rel-a"],
      ensure: [],
      patch: false,
    });
  });

  it("moves: invalidate both and ensure new", () => {
    expect(releaseCacheAction("demo/rel-a", "demo/rel-b")).toEqual({
      invalidate: ["demo/rel-a", "demo/rel-b"],
      ensure: ["demo/rel-b"],
      patch: false,
    });
  });

  it("same release: patch only", () => {
    expect(releaseCacheAction("demo/rel-a", "demo/rel-a")).toEqual({
      invalidate: [],
      ensure: [],
      patch: true,
    });
  });
});

describe("releaseTree", () => {
  it("encodes project and release paths (Option A)", () => {
    expect(releaseTreePathForProject("demo")).toBe("__release_proj__/demo");
    expect(releaseTreePathForRelease("demo/1.1.0")).toBe(
      "__release_proj__/demo/__rel__/1.1.0",
    );
    expect(releaseTreePathForReleaseId("demo/1.1.0")).toBe(
      releaseTreePathForRelease("demo/1.1.0"),
    );
  });

  it("parses release tree paths", () => {
    expect(parseReleaseTreePath("__release_proj__/demo")).toEqual({
      projectName: "demo",
      releaseId: null,
      stem: null,
      isProjectRoot: true,
      isRelease: false,
    });
    expect(parseReleaseTreePath("__release_proj__/demo/__rel__/1.1.0")).toEqual({
      projectName: "demo",
      stem: "1.1.0",
      releaseId: "demo/1.1.0",
      isProjectRoot: false,
      isRelease: true,
    });
  });

  it("builds project → release tree", () => {
    const projects = [{ name: "demo", display_name: "demo", case_count: 3 }];
    const releasesByProject = {
      demo: [
        {
          release_id: "demo/1.1.0",
          name: "1.1.0",
          file_path: ".gitoza/tasks/tickets/demo/releases/1.1.0.md",
          ticket_count: 2,
        },
      ],
    };
    const tree = buildReleaseTree(projects, releasesByProject);
    expect(tree).toHaveLength(1);
    expect(tree[0].is_project).toBe(true);
    expect(tree[0].project_name).toBe("demo");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].is_release).toBe(true);
    expect(tree[0].children[0].release_id).toBe("demo/1.1.0");
    expect(tree[0].ticket_count).toBe(0);
    expect(tree[0].children[0].ticket_count).toBe(2);
  });

  it("keeps children empty until project releases are loaded", () => {
    const projects = [{ name: "demo", case_count: 7 }];
    const tree = buildReleaseTree(projects, {});
    expect(tree[0].children).toEqual([]);
    expect(tree[0].children_loaded).toBe(false);
    expect(tree[0].ticket_count).toBe(0);
  });
});

describe("sortReleaseTreeWithPins", () => {
  const projects = [
    { name: "zebra" },
    { name: "alpha" },
    { name: "beta" },
  ];
  const releasesByProject = {
    zebra: [{ release_id: "zebra/1.0", name: "1.0", ticket_count: 1 }],
    alpha: [{ release_id: "alpha/2.0", name: "2.0", ticket_count: 1 }],
    beta: [{ release_id: "beta/3.0", name: "3.0", ticket_count: 1 }],
  };

  it("puts projects with pinned releases first", () => {
    const tree = buildReleaseTree(projects, releasesByProject);
    const pinned = new Set([releaseTreePathForRelease("zebra/1.0")]);
    const sorted = sortReleaseTreeWithPins(tree, pinned);
    expect(sorted.map((n) => n.project_name)).toEqual(["zebra", "alpha", "beta"]);
  });

  it("puts explicitly pinned projects first", () => {
    const tree = buildReleaseTree(projects, releasesByProject);
    const pinned = new Set([releaseTreePathForProject("beta")]);
    const sorted = sortReleaseTreeWithPins(tree, pinned);
    expect(sorted.map((n) => n.project_name)).toEqual(["beta", "zebra", "alpha"]);
  });
});

describe("prunePinnedReleasePaths", () => {
  it("drops pins for releases no longer in the list", () => {
    const pruned = prunePinnedReleasePaths(
      [releaseTreePathForRelease("demo/keep"), releaseTreePathForRelease("demo/gone")],
      [{ release_id: "demo/keep" }],
    );
    expect(pruned).toEqual([releaseTreePathForRelease("demo/keep")]);
  });

  it("keeps project pins that still exist in the projects list", () => {
    const projectPath = releaseTreePathForProject("demo");
    const pruned = prunePinnedReleasePaths(
      [projectPath, releaseTreePathForProject("gone")],
      [],
      [{ name: "demo" }],
    );
    expect(pruned).toEqual([projectPath]);
  });
});
