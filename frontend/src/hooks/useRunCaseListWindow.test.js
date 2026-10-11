/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRunCaseListWindow } from "./useRunCaseListWindow";

vi.mock("../services/api", () => ({
  listRunCases: vi.fn(),
}));

import { listRunCases } from "../services/api";

let latest = null;

function TestHost(props) {
  latest = useRunCaseListWindow(props);
  return null;
}

let container = null;
let root = null;

const RUN_TREE_PATH = "__run__/run-1/.gitoza/test/cases/auth/login";

beforeEach(() => {
  latest = null;
  vi.mocked(listRunCases).mockReset();
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

describe("useRunCaseListWindow", () => {
  it("loads first window when run folder is selected", async () => {
    vi.mocked(listRunCases).mockResolvedValue({
      items: [{ file_path: "a.yaml", case_id: "A" }],
      total: 1,
    });

    await renderHost({
      runId: "run-1",
      folderPath: RUN_TREE_PATH,
      repoSlug: "repo-1",
    });

    expect(listRunCases).toHaveBeenCalledWith(
      "run-1",
      "repo-1",
      expect.objectContaining({
        folder_prefix: ".gitoza/test/cases/auth/login",
        offset: 0,
      }),
    );
    expect(latest.items).toHaveLength(1);
    expect(latest.total).toBe(1);
    expect(latest.hasMore).toBe(false);
  });

  it("resets when folderPath changes", async () => {
    vi.mocked(listRunCases)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }],
        total: 1,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "b.yaml" }],
        total: 1,
      });

    await renderHost({
      runId: "run-1",
      folderPath: "__run__/run-1/.gitoza/test/cases/auth/login",
      repoSlug: "repo-1",
    });
    expect(latest.items[0]?.file_path).toBe("a.yaml");

    await renderHost({
      runId: "run-1",
      folderPath: "__run__/run-1/.gitoza/test/cases/auth/signup",
      repoSlug: "repo-1",
    });
    expect(latest.items[0]?.file_path).toBe("b.yaml");
    expect(listRunCases).toHaveBeenCalledTimes(2);
  });

  it("loadMore appends next chunk", async () => {
    vi.mocked(listRunCases)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "b.yaml" }],
        total: 2,
      });

    await renderHost({
      runId: "run-1",
      folderPath: RUN_TREE_PATH,
      repoSlug: "repo-1",
      windowSize: 1,
    });

    expect(latest.hasMore).toBe(true);

    await act(async () => {
      await latest.loadMore();
    });

    expect(latest.items).toHaveLength(2);
    expect(listRunCases).toHaveBeenLastCalledWith(
      "run-1",
      "repo-1",
      expect.objectContaining({ offset: 1 }),
    );
  });

  it("calls onItemsFetched with loaded items", async () => {
    const onItemsFetched = vi.fn();
    vi.mocked(listRunCases).mockResolvedValue({
      items: [{ file_path: "a.yaml" }],
      total: 1,
    });

    await renderHost({
      runId: "run-1",
      folderPath: RUN_TREE_PATH,
      repoSlug: "repo-1",
      onItemsFetched,
    });

    expect(onItemsFetched).toHaveBeenCalledWith("run-1", [{ file_path: "a.yaml" }]);
  });

  it("does not fetch when disabled", async () => {
    await renderHost({
      runId: "run-1",
      folderPath: RUN_TREE_PATH,
      repoSlug: "repo-1",
      enabled: false,
    });
    expect(listRunCases).not.toHaveBeenCalled();
    expect(latest.items).toEqual([]);
  });
});
