/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIRTUAL_CASE_LIST_THRESHOLD } from "../constants/virtualCaseList.js";
import RepositoryPaginatedCaseList from "./RepositoryPaginatedCaseList.jsx";

function makeCases(n) {
  return Array.from({ length: n }, (_, i) => ({
    file_path: `.gitoza/test/cases/p/case-${i}.yaml`,
    case_id: `TC-${i}`,
    title: `Case ${i}`,
  }));
}

let container = null;
let root = null;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    cb();
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function renderList(caseCount, props = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(RepositoryPaginatedCaseList, {
        cases: makeCases(caseCount),
        folderPath: ".gitoza/test/cases/p",
        page: 1,
        onPageChange: () => {},
        onSelectCase: () => {},
        ...props,
      }),
    );
  });
  act(() => {});
}

describe("RepositoryPaginatedCaseList", () => {
  it("shows no-folder message when showNoFolderWhenEmpty and no folderPath", () => {
    renderList(0, { folderPath: null, showNoFolderWhenEmpty: true });
    expect(container.textContent).toContain("Select a project or suite");
  });

  it("paginates large lists to one page of rows", () => {
    const caseCount = VIRTUAL_CASE_LIST_THRESHOLD + 60;
    renderList(caseCount);
    const listItems = container.querySelectorAll("ul li");
    expect(listItems.length).toBeLessThanOrEqual(50);
  });
});
