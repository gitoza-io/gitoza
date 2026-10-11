/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRunBrowseState } from "./useRunBrowseState";

const FOLDER_TREE = [
  {
    name: "Smoke",
    directory_path: "__run__/run-1",
    is_run: true,
    is_project: true,
    run_id: "run-1",
    children: [
      {
        name: "auth.gitoza.test",
        directory_path: "__run__/run-1/.gitoza/test/cases/auth",
        is_project: true,
        children: [
          {
            name: "login",
            directory_path: "__run__/run-1/.gitoza/test/cases/auth/login",
            children: [],
          },
        ],
      },
    ],
  },
];

function run2TreeFromRun1(run1Tree = FOLDER_TREE) {
  return [
    {
      ...run1Tree[0],
      run_id: "run-2",
      directory_path: "__run__/run-2",
      name: "Regression",
      children: run1Tree[0].children.map((child) => ({
        ...child,
        directory_path: child.directory_path.replace("__run__/run-1", "__run__/run-2"),
        children: (child.children ?? []).map((suite) => ({
          ...suite,
          directory_path: suite.directory_path.replace("__run__/run-1", "__run__/run-2"),
        })),
      })),
    },
  ];
}

const RUN2_SUITE_PATH = "__run__/run-2/.gitoza/test/cases/auth/login";

let container = null;
let root = null;

function renderHook(props) {
  let hookResult = null;

  function TestComponent() {
    hookResult = useRunBrowseState(props);
    return null;
  }

  act(() => {
    root.render(createElement(TestComponent));
  });

  return {
    get current() {
      return hookResult;
    },
    rerender(nextProps) {
      props = nextProps;
      act(() => {
        root.render(createElement(TestComponent));
      });
    },
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  container = null;
  root = null;
});

describe("useRunBrowseState", () => {
  it("selects initial folder from tree when run is selected", () => {
    const h = renderHook({
      tree: FOLDER_TREE,
      selectedRunId: "run-1",
      enabled: true,
      lastFolderStorageKey: "test.run.folder",
    });
    expect(h.current.selectedFolderPath).toBe("__run__/run-1");
  });

  it("does not reset folder when enabled toggles with same selectedRunId", () => {
    const h = renderHook({
      tree: FOLDER_TREE,
      selectedRunId: "run-1",
      enabled: true,
      lastFolderStorageKey: "test.run.folder",
    });
    act(() => {
      h.current.handleSelectBrowseFolder("__run__/run-1/.gitoza/test/cases/auth/login");
    });
    expect(h.current.selectedFolderPath).toBe("__run__/run-1/.gitoza/test/cases/auth/login");

    act(() => {
      h.rerender({
        tree: FOLDER_TREE,
        selectedRunId: "run-1",
        enabled: false,
        searchOpen: true,
        lastFolderStorageKey: "test.run.folder",
      });
    });
    act(() => {
      h.rerender({
        tree: FOLDER_TREE,
        selectedRunId: "run-1",
        enabled: true,
        searchOpen: false,
        lastFolderStorageKey: "test.run.folder",
      });
    });
    expect(h.current.selectedFolderPath).toBe("__run__/run-1/.gitoza/test/cases/auth/login");
  });

  it("keeps suite folder when switching selectedRunId via cross-run click", () => {
    const run2Tree = run2TreeFromRun1();
    const unifiedTree = [...FOLDER_TREE, ...run2Tree];

    const h = renderHook({
      tree: unifiedTree,
      selectedRunId: "run-1",
      enabled: true,
      lastFolderStorageKey: "test.run.folder",
    });
    act(() => {
      h.current.handleSelectBrowseFolder("__run__/run-1/.gitoza/test/cases/auth/login");
    });
    expect(h.current.selectedFolderPath).toBe("__run__/run-1/.gitoza/test/cases/auth/login");

    act(() => {
      h.current.handleSelectBrowseFolder(RUN2_SUITE_PATH);
      h.rerender({
        tree: unifiedTree,
        selectedRunId: "run-2",
        enabled: true,
        lastFolderStorageKey: "test.run.folder",
      });
    });
    expect(h.current.selectedFolderPath).toBe(RUN2_SUITE_PATH);
    expect(h.current.selectedFolderPath).not.toBe("__run__/run-2");
  });

  it("selects new run root after selectedRunId changes once search closes", () => {
    const run2Tree = run2TreeFromRun1();

    const h = renderHook({
      tree: FOLDER_TREE,
      selectedRunId: "run-1",
      enabled: true,
      searchOpen: true,
      lastFolderStorageKey: "test.run.folder",
    });
    act(() => {
      h.rerender({
        tree: run2Tree,
        selectedRunId: "run-2",
        enabled: true,
        searchOpen: true,
        lastFolderStorageKey: "test.run.folder",
      });
    });
    expect(h.current.selectedFolderPath).toBe(null);

    act(() => {
      h.rerender({
        tree: run2Tree,
        selectedRunId: "run-2",
        enabled: true,
        searchOpen: false,
        lastFolderStorageKey: "test.run.folder",
      });
    });
    act(() => {});
    expect(h.current.selectedFolderPath).toBe("__run__/run-2");
  });

  it("does not auto-expand tree when selectedCaseFilePath changes", () => {
    const h = renderHook({
      tree: FOLDER_TREE,
      selectedRunId: "run-1",
      enabled: true,
      lastFolderStorageKey: "test.run.folder",
    });
    expect(h.current.expanded.size).toBe(0);

    act(() => {
      h.rerender({
        tree: FOLDER_TREE,
        selectedRunId: "run-1",
        selectedCaseFilePath: "__run__/run-1/.gitoza/test/cases/auth/login/case-1.yaml",
        enabled: true,
        lastFolderStorageKey: "test.run.folder",
      });
    });
    expect(h.current.expanded.size).toBe(0);
  });

  it("resets folder when selectedRunId changes", () => {
    const h = renderHook({
      tree: FOLDER_TREE,
      selectedRunId: "run-1",
      enabled: true,
      lastFolderStorageKey: "test.run.folder",
    });
    act(() => {
      h.current.handleSelectBrowseFolder("__run__/run-1/.gitoza/test/cases/auth/login");
    });
    expect(h.current.selectedFolderPath).toBe("__run__/run-1/.gitoza/test/cases/auth/login");

    act(() => {
      h.rerender({
        tree: run2TreeFromRun1(),
        selectedRunId: "run-2",
        enabled: true,
        lastFolderStorageKey: "test.run.folder",
      });
    });
    act(() => {});
    expect(h.current.selectedFolderPath).toBe("__run__/run-2");
  });
});
