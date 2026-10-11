/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSearchFolderTree } from "./useSearchFolderTree";

const API_TREE = [
  {
    name: "auth.gitoza.test",
    directory_path: ".gitoza/test/cases/auth",
    is_project: true,
    children: [
      {
        name: "login",
        directory_path: ".gitoza/test/cases/auth/login",
        children: [],
      },
      {
        name: "debug",
        directory_path: ".gitoza/test/cases/auth/debug",
        children: [],
      },
    ],
  },
];

const ROWS = [
  { file_path: ".gitoza/test/cases/auth/login/a.yaml", case_id: "TC-1", title: "A" },
  { file_path: ".gitoza/test/cases/auth/debug/b.yaml", case_id: "TC-2", title: "B" },
];

let container = null;
let root = null;

function renderHook(props) {
  let hookResult = null;

  function TestComponent() {
    hookResult = useSearchFolderTree(props);
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

describe("useSearchFolderTree", () => {
  it("builds a pruned tree with only folders that contain matches", () => {
    const h = renderHook({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: true,
      searchResetKey: "tag:foo",
    });

    expect(h.current.searchTree).toHaveLength(1);
    expect(h.current.searchTree[0].directory_path).toBe(".gitoza/test/cases/auth");
    expect(h.current.searchTree[0].children).toHaveLength(2);
    expect(h.current.searchExpandKeys.size).toBeGreaterThan(0);
  });

  it("returns null folderScopedCases until a folder is selected", () => {
    const h = renderHook({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: true,
      searchResetKey: "tag:foo",
    });

    expect(h.current.folderScopedCases).toBeNull();
  });

  it("scopes cases to project recursively and suite directly", () => {
    const h = renderHook({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: true,
      searchResetKey: "tag:foo",
    });

    act(() => {
      h.current.handleSelectSearchFolder(".gitoza/test/cases/auth");
    });
    h.rerender({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: true,
      searchResetKey: "tag:foo",
    });

    expect(h.current.folderScopedCases?.map((c) => c.case_id)).toEqual(["TC-1", "TC-2"]);

    act(() => {
      h.current.handleSelectSearchFolder(".gitoza/test/cases/auth/login");
    });
    h.rerender({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: true,
      searchResetKey: "tag:foo",
    });

    expect(h.current.folderScopedCases?.map((c) => c.case_id)).toEqual(["TC-1"]);
  });

  it("resets folder selection when searchResetKey changes", () => {
    const h = renderHook({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: true,
      searchResetKey: "tag:foo",
    });

    act(() => {
      h.current.handleSelectSearchFolder(".gitoza/test/cases/auth/login");
    });
    h.rerender({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: true,
      searchResetKey: "tag:foo",
    });
    expect(h.current.searchFolderPath).toBe(".gitoza/test/cases/auth/login");

    h.rerender({
      apiTree: API_TREE,
      rows: [ROWS[0]],
      searchActive: true,
      searchResetKey: "tag:bar",
    });
    expect(h.current.searchFolderPath).toBeNull();
  });

  it("returns empty tree when search is inactive", () => {
    const h = renderHook({
      apiTree: API_TREE,
      rows: ROWS,
      searchActive: false,
      searchResetKey: "",
    });

    expect(h.current.searchTree).toEqual([]);
    expect(h.current.folderScopedCases).toBeNull();
  });
});
