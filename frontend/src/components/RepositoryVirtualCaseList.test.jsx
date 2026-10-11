/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIRTUAL_CASE_LIST_THRESHOLD } from "../constants/virtualCaseList.js";
import RepositoryVirtualCaseList from "./RepositoryVirtualCaseList.jsx";

function makeCases(n) {
  return Array.from({ length: n }, (_, i) => ({
    file_path: `.gitoza/test/cases/p/case-${i}.yaml`,
    case_id: `TC-${i}`,
    title: `Case ${i}`,
  }));
}

let container = null;
let root = null;
let resizeObservers = [];

beforeEach(() => {
  resizeObservers = [];
  global.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe(element) {
      this.element = element;
    }
    unobserve() {}
    disconnect() {}
  };
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

function configureScrollElement(scrollEl) {
  scrollEl.style.height = "400px";
  Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(scrollEl, "offsetHeight", { configurable: true, value: 400 });
  Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, value: 10000 });
  scrollEl.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: 300,
    height: 400,
    bottom: 400,
    right: 300,
  });
}

function renderList(props = {}) {
  container = document.createElement("div");
  container.style.height = "500px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(RepositoryVirtualCaseList, {
        cases: makeCases(5),
        total: 5,
        folderPath: ".gitoza/test/cases/p",
        onSelectCase: () => {},
        onLoadMore: () => {},
        ...props,
      }),
    );
  });
  act(() => {});
  const scrollEl = container.querySelector(".overflow-y-auto");
  if (scrollEl) {
    configureScrollElement(scrollEl);
    act(() => {
      for (const observer of resizeObservers) {
        observer.callback([{ target: scrollEl, contentRect: { height: 400 } }]);
      }
    });
    act(() => {});
  }
  return scrollEl;
}

describe("RepositoryVirtualCaseList", () => {
  it("shows no-folder message when showNoFolderWhenEmpty and no folderPath", () => {
    renderList({ folderPath: null, showNoFolderWhenEmpty: true, cases: [] });
    expect(container.textContent).toContain("Select a project or suite");
  });

  it("virtualizes large lists so DOM rows stay bounded", () => {
    const caseCount = VIRTUAL_CASE_LIST_THRESHOLD + 60;
    renderList({
      cases: makeCases(caseCount),
      total: caseCount,
    });
    const rowNodes = container.querySelectorAll("[data-index]");
    expect(rowNodes.length).toBeGreaterThan(0);
    expect(rowNodes.length).toBeLessThan(caseCount);
  });

  it("calls onLoadMore when scrolled near the bottom", () => {
    const onLoadMore = vi.fn(() => Promise.resolve());
    renderList({
      cases: makeCases(50),
      total: 200,
      hasMore: true,
      onLoadMore,
    });
    const scrollEl = container.querySelector(".overflow-y-auto");
    expect(scrollEl).toBeTruthy();
    Object.defineProperty(scrollEl, "scrollTop", { configurable: true, value: 9500 });
    act(() => {
      scrollEl.dispatchEvent(new Event("scroll"));
    });
    expect(onLoadMore).toHaveBeenCalled();
  });
});
