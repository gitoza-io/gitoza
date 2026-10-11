/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLazyRepositoryTree } from "./useLazyRepositoryTree";

vi.mock("../services/api", () => ({
  getRepositoryTree: vi.fn(),
}));

import { getRepositoryTree } from "../services/api";

let container = null;
let root = null;

function renderHook(initialProps) {
  let hookResult = null;
  let currentProps = initialProps;

  function TestComponent({ activeRepoSlug, archiveMode }) {
    hookResult = useLazyRepositoryTree(activeRepoSlug, {
      archiveMode: archiveMode ?? false,
    });
    return null;
  }

  act(() => {
    root.render(
      createElement(TestComponent, {
        activeRepoSlug: currentProps.activeRepoSlug,
        archiveMode: currentProps.archiveMode,
      }),
    );
  });

  return {
    get current() {
      return hookResult;
    },
    rerender(nextProps) {
      currentProps = nextProps;
      act(() => {
        root.render(
          createElement(TestComponent, {
            activeRepoSlug: currentProps.activeRepoSlug,
            archiveMode: currentProps.archiveMode,
          }),
        );
      });
    },
  };
}

describe("useLazyRepositoryTree", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(getRepositoryTree).mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    container = null;
    root = null;
  });

  it("hydrates archive bucket instantly when toggling archiveMode after prefetch", async () => {
    getRepositoryTree.mockResolvedValue([
      {
        directory_path: ".gitoza/test/cases/.archive/proj.gitoza.test",
        name: "proj.gitoza.test",
        display_name: "proj",
        is_project: true,
        case_count: 2,
        children: [],
      },
    ]);

    const h = renderHook({ activeRepoSlug: "repo-a", archiveMode: false });

    await act(async () => {
      await h.current.prefetchArchiveProjectNodes();
    });

    expect(getRepositoryTree).toHaveBeenCalledWith(
      expect.objectContaining({ depth: "projects", archiveMode: true, repoSlug: "repo-a" }),
    );
    expect(h.current.isArchiveProjectsReady()).toBe(true);

    getRepositoryTree.mockClear();

    h.rerender({ activeRepoSlug: "repo-a", archiveMode: true });

    expect(h.current.projectsReady).toBe(true);
    expect(h.current.repositoryTree).toHaveLength(1);
    expect(h.current.repositoryTree[0].directory_path).toContain(".archive");
    expect(getRepositoryTree).not.toHaveBeenCalled();
  });

  it("resets both buckets when activeRepoSlug changes", async () => {
    getRepositoryTree.mockResolvedValue([
      {
        directory_path: ".gitoza/test/cases/.archive/proj.gitoza.test",
        name: "proj.gitoza.test",
        display_name: "proj",
        is_project: true,
        case_count: 1,
        children: [],
      },
    ]);

    const h = renderHook({ activeRepoSlug: "repo-a", archiveMode: false });

    await act(async () => {
      await h.current.prefetchArchiveProjectNodes();
    });

    expect(h.current.isArchiveProjectsReady()).toBe(true);

    h.rerender({ activeRepoSlug: "repo-b", archiveMode: false });

    expect(h.current.isArchiveProjectsReady()).toBe(false);
    expect(h.current.repositoryTree).toEqual([]);
    expect(h.current.projectsReady).toBe(false);
  });

  it("reloads archive bucket in background after invalidation", async () => {
    let callCount = 0;
    getRepositoryTree.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve([
          {
            directory_path: ".gitoza/test/cases/.archive/old.gitoza.test",
            name: "old.gitoza.test",
            display_name: "old",
            is_project: true,
            case_count: 1,
            children: [],
          },
        ]);
      }
      return Promise.resolve([
        {
          directory_path: ".gitoza/test/cases/.archive/new.gitoza.test",
          name: "new.gitoza.test",
          display_name: "new",
          is_project: true,
          case_count: 3,
          children: [],
        },
      ]);
    });

    const h = renderHook({ activeRepoSlug: "repo-a", archiveMode: true });

    await act(async () => {
      await h.current.loadProjectNodes(null);
    });

    expect(h.current.repositoryTree[0].display_name).toBe("old");

    act(() => {
      h.current.invalidateArchiveProjectNodes();
    });

    expect(h.current.isArchiveBucketDirty()).toBe(true);
    expect(h.current.repositoryTree).toHaveLength(1);

    await act(async () => {
      await h.current.reloadArchiveProjectNodesInBackground();
    });

    expect(h.current.repositoryTree[0].display_name).toBe("new");
    expect(h.current.isArchiveBucketDirty()).toBe(false);
  });

  it("keeps browse and archive project loads isolated per bucket", async () => {
    getRepositoryTree.mockImplementation((opts) => {
      if (opts.archiveMode) {
        return Promise.resolve([
          {
            directory_path: ".gitoza/test/cases/.archive/a.gitoza.test",
            name: "a.gitoza.test",
            display_name: "archive-a",
            is_project: true,
            case_count: 1,
            children: [],
          },
        ]);
      }
      return Promise.resolve([
        {
          directory_path: ".gitoza/test/cases/b.gitoza.test",
          name: "b.gitoza.test",
          display_name: "browse-b",
          is_project: true,
          case_count: 4,
          children: [],
        },
      ]);
    });

    const h = renderHook({ activeRepoSlug: "repo-a", archiveMode: false });

    await act(async () => {
      await Promise.all([
        h.current.loadProjectNodesForMode(false, null),
        h.current.loadProjectNodesForMode(true, null),
      ]);
    });

    expect(h.current.isArchiveProjectsReady()).toBe(true);

    h.rerender({ activeRepoSlug: "repo-a", archiveMode: true });
    expect(h.current.repositoryTree[0].display_name).toBe("archive-a");

    h.rerender({ activeRepoSlug: "repo-a", archiveMode: false });
    expect(h.current.repositoryTree[0].display_name).toBe("browse-b");
  });

  it("forces get_repository_tree when browse bucket is dirty even with dashboard summary", async () => {
    const dashboardSummary = {
      projects: [
        {
          project_path: ".gitoza/test/cases/stale.gitoza.test",
          project_name: "stale",
          total_test_cases: 2,
        },
      ],
    };

    const freshProjects = [
      {
        directory_path: ".gitoza/test/cases/fresh.gitoza.test",
        name: "fresh.gitoza.test",
        display_name: "fresh",
        is_project: true,
        case_count: 1,
        children: [],
      },
    ];

    getRepositoryTree.mockImplementation(({ depth }) => {
      if (depth === "projects") {
        return Promise.resolve(freshProjects);
      }
      return Promise.resolve([]);
    });

    const h = renderHook({ activeRepoSlug: "repo-a", archiveMode: false });

    await act(async () => {
      await h.current.loadProjectNodesForMode(false, dashboardSummary);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(getRepositoryTree).not.toHaveBeenCalledWith(
      expect.objectContaining({ depth: "projects", archiveMode: false }),
    );
    expect(h.current.repositoryTree[0].display_name).toBe("stale");

    getRepositoryTree.mockClear();

    act(() => {
      h.current.invalidateBrowseProjectNodes();
    });

    await act(async () => {
      await h.current.reloadBrowseProjectNodesInBackground(dashboardSummary);
    });

    expect(getRepositoryTree).toHaveBeenCalledWith(
      expect.objectContaining({ depth: "projects", archiveMode: false, repoSlug: "repo-a" }),
    );
    expect(h.current.repositoryTree[0].display_name).toBe("fresh");
  });
});
