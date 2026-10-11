/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCaseListWindow } from "./useCaseListWindow";

vi.mock("../utils/caseQuery", () => ({
  fetchCaseWindow: vi.fn(),
  chipsToCaseQueryParams: vi.fn(() => ({})),
}));

import { fetchCaseWindow } from "../utils/caseQuery";

let latest = null;

function TestHost(props) {
  latest = useCaseListWindow(props);
  return null;
}

let container = null;
let root = null;

beforeEach(() => {
  latest = null;
  vi.mocked(fetchCaseWindow).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

async function renderHost(props) {
  await act(async () => {
    root.render(createElement(TestHost, props));
  });
  await act(async () => {});
}

describe("useCaseListWindow", () => {
  it("loads first window when folderPath is set", async () => {
    vi.mocked(fetchCaseWindow).mockResolvedValue({
      items: [{ file_path: "a.yaml", case_id: "A" }],
      total: 1,
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/p",
    });

    expect(fetchCaseWindow).toHaveBeenCalledWith(
      "repo-1",
      expect.objectContaining({ path_prefix: ".gitoza/test/cases/p" }),
      expect.objectContaining({ offset: 0 }),
    );
    expect(latest.items).toHaveLength(1);
    expect(latest.total).toBe(1);
    expect(latest.hasMore).toBe(false);
  });

  it("resets when folderPath changes", async () => {
    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "b.yaml" }],
        total: 1,
      });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/a",
    });
    expect(latest.items[0]?.file_path).toBe("a.yaml");

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/b",
    });
    expect(latest.items[0]?.file_path).toBe("b.yaml");
    expect(fetchCaseWindow).toHaveBeenCalledTimes(2);
  });

  it("revalidates cached folder in background on revisit", async () => {
    let resolveThird;
    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "b.yaml" }],
        total: 1,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveThird = resolve;
          }),
      );

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/a",
    });
    expect(fetchCaseWindow).toHaveBeenCalledTimes(1);

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/b",
    });
    expect(fetchCaseWindow).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.render(
        createElement(TestHost, {
          repoSlug: "repo-1",
          folderPath: ".gitoza/test/cases/a",
        }),
      );
    });

    expect(latest.items[0]?.file_path).toBe("a.yaml");
    expect(latest.refreshing).toBe(true);
    expect(fetchCaseWindow).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolveThird({ items: [{ file_path: "a-fresh.yaml" }], total: 1 });
    });

    expect(latest.items[0]?.file_path).toBe("a-fresh.yaml");
    expect(latest.refreshing).toBe(false);
  });

  it("propagates patchLocal remove to all folder caches", async () => {
    const parentPath = ".gitoza/test/cases/p";
    const childPath = `${parentPath}/suite`;
    const childCasePath = `${childPath}/child.yaml`;

    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [
          { file_path: `${parentPath}/other.yaml` },
          { file_path: childCasePath },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: childCasePath }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: `${parentPath}/other.yaml` }],
        total: 1,
      });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: parentPath,
    });
    expect(latest.items).toHaveLength(2);

    await renderHost({
      repoSlug: "repo-1",
      folderPath: childPath,
    });
    expect(latest.items).toHaveLength(1);

    await act(async () => {
      latest.patchLocal({ remove: [childCasePath] });
    });
    expect(latest.items).toHaveLength(0);

    await renderHost({
      repoSlug: "repo-1",
      folderPath: parentPath,
    });
    expect(latest.items.map((r) => r.file_path)).toEqual([`${parentPath}/other.yaml`]);
    expect(fetchCaseWindow).toHaveBeenCalledTimes(3);

    await act(async () => {});
    expect(latest.items.map((r) => r.file_path)).toEqual([`${parentPath}/other.yaml`]);
  });

  it("invalidateAll clears all folder caches and refetches on navigation", async () => {
    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "b.yaml" }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "a-refetched.yaml" }],
        total: 1,
      });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/a",
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/b",
    });
    expect(fetchCaseWindow).toHaveBeenCalledTimes(2);

    await act(async () => {
      latest.invalidateAll();
    });
    await act(async () => {});

    expect(fetchCaseWindow).toHaveBeenCalledTimes(3);

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/a",
    });
    expect(latest.items[0]?.file_path).toBe("a-refetched.yaml");
    expect(fetchCaseWindow).toHaveBeenCalledTimes(4);
  });

  it("keeps previous items visible while loading a new folder", async () => {
    let resolveSecond;
    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }],
        total: 1,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/a",
    });
    expect(latest.items[0]?.file_path).toBe("a.yaml");

    await act(async () => {
      root.render(
        createElement(TestHost, {
          repoSlug: "repo-1",
          folderPath: ".gitoza/test/cases/b",
        }),
      );
    });

    expect(latest.items[0]?.file_path).toBe("a.yaml");
    expect(latest.refreshing).toBe(true);

    await act(async () => {
      resolveSecond({ items: [{ file_path: "b.yaml" }], total: 1 });
    });

    expect(latest.items[0]?.file_path).toBe("b.yaml");
    expect(latest.refreshing).toBe(false);
  });

  it("loadMore appends next chunk", async () => {
    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "b.yaml" }],
        total: 2,
      });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/p",
      windowSize: 1,
    });

    expect(latest.hasMore).toBe(true);

    await act(async () => {
      await latest.loadMore();
    });

    expect(latest.items).toHaveLength(2);
    expect(fetchCaseWindow).toHaveBeenLastCalledWith(
      "repo-1",
      expect.any(Object),
      expect.objectContaining({ offset: 1 }),
    );
  });

  it("does not fetch when disabled", async () => {
    await renderHost({
      repoSlug: "repo-1",
      enabled: false,
    });
    expect(fetchCaseWindow).not.toHaveBeenCalled();
    expect(latest.items).toEqual([]);
  });

  it("requests archived-only cases when archiveMode is true", async () => {
    vi.mocked(fetchCaseWindow).mockResolvedValue({
      items: [{ file_path: ".gitoza/test/cases/.archive/p/c.yaml" }],
      total: 1,
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/.archive/p.gitoza.test",
      archiveMode: true,
    });

    expect(fetchCaseWindow).toHaveBeenCalledWith(
      "repo-1",
      expect.objectContaining({
        path_prefix: ".gitoza/test/cases/.archive/p.gitoza.test",
        status: "archived",
      }),
      expect.objectContaining({ offset: 0 }),
    );
  });

  it("sortLocal after patchLocal keeps renamed case_id", async () => {
    const folderPath = ".gitoza/test/cases/p";
    const oldPath = `${folderPath}/old_id.yaml`;
    const newPath = `${folderPath}/new_id.yaml`;

    vi.mocked(fetchCaseWindow).mockResolvedValueOnce({
      items: [{ file_path: oldPath, case_id: "old_id" }],
      total: 1,
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath,
    });

    await act(async () => {
      latest.patchLocal({
        remove: [oldPath],
        add: [{ file_path: newPath, case_id: "new_id" }],
      });
      latest.sortLocal();
    });

    expect(latest.items).toEqual([{ file_path: newPath, case_id: "new_id" }]);
  });

  it("patchLocal remove+add does not inflate total", async () => {
    vi.mocked(fetchCaseWindow).mockResolvedValueOnce({
      items: [{ file_path: "a.yaml", case_id: "a" }],
      total: 1,
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: ".gitoza/test/cases/p",
    });
    expect(latest.total).toBe(1);

    await act(async () => {
      latest.patchLocal({
        remove: ["a.yaml"],
        add: [{ file_path: "b.yaml", case_id: "b" }],
      });
    });

    expect(latest.total).toBe(1);
    expect(latest.items).toEqual([{ file_path: "b.yaml", case_id: "b" }]);
  });

  it("snapshotRows returns rows from current items and other folder caches", async () => {
    const parentPath = ".gitoza/test/cases/p";
    const childPath = `${parentPath}/suite`;
    const childCasePath = `${childPath}/child.yaml`;

    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [
          { file_path: `${parentPath}/other.yaml`, case_id: "other" },
          { file_path: childCasePath, case_id: "child" },
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: childCasePath, case_id: "child" }],
        total: 1,
      });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: parentPath,
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: childPath,
    });

    const snap = latest.snapshotRows([childCasePath, `${parentPath}/other.yaml`]);
    expect(snap).toEqual([
      { file_path: childCasePath, case_id: "child" },
      { file_path: `${parentPath}/other.yaml`, case_id: "other" },
    ]);
  });

  it("patchLocalForFolder on cold folder defers optimistic rows until fetch", async () => {
    const sourcePath = ".gitoza/test/cases/source";
    const targetPath = ".gitoza/test/cases/target";
    const movedCase = { file_path: `${targetPath}/moved.yaml`, case_id: "moved", title: "Moved" };
    const existingCase = { file_path: `${targetPath}/existing.yaml`, case_id: "existing" };

    let resolveTargetFetch;
    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [{ file_path: `${sourcePath}/stay.yaml`, case_id: "stay" }],
        total: 1,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTargetFetch = resolve;
          }),
      );

    await renderHost({
      repoSlug: "repo-1",
      folderPath: sourcePath,
    });

    await act(async () => {
      latest.patchLocalForFolder(targetPath, {
        remove: [`${sourcePath}/stay.yaml`],
        add: [movedCase],
      });
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: targetPath,
    });

    expect(latest.refreshing).toBe(true);
    expect(latest.items).not.toEqual([movedCase]);

    await act(async () => {
      resolveTargetFetch({
        items: [existingCase],
        total: 1,
      });
    });
    await act(async () => {});

    expect(latest.loading).toBe(false);
    expect(latest.items).toEqual([existingCase, movedCase]);
    expect(latest.total).toBe(2);
  });

  it("patchLocalForFolder on warm folder patches cache immediately", async () => {
    const sourcePath = ".gitoza/test/cases/source";
    const targetPath = ".gitoza/test/cases/target";
    const existingCase = { file_path: `${targetPath}/existing.yaml`, case_id: "existing" };
    const movedCase = { file_path: `${targetPath}/moved.yaml`, case_id: "moved", title: "Moved" };

    vi.mocked(fetchCaseWindow)
      .mockResolvedValueOnce({
        items: [{ file_path: `${sourcePath}/stay.yaml`, case_id: "stay" }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [existingCase],
        total: 1,
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    await renderHost({
      repoSlug: "repo-1",
      folderPath: sourcePath,
    });

    await renderHost({
      repoSlug: "repo-1",
      folderPath: targetPath,
    });
    expect(latest.items).toEqual([existingCase]);

    await act(async () => {
      latest.patchLocalForFolder(targetPath, { add: [movedCase] });
    });

    expect(latest.items).toEqual([existingCase, movedCase]);
    expect(latest.total).toBe(2);
  });
});
