/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeScrollProvider } from "../contexts/TreeScrollContext.jsx";
import {
  CASE_ROW_ESTIMATE_PX,
  VIRTUAL_CASE_LIST_THRESHOLD,
} from "../constants/virtualCaseList.js";
import VirtualCaseList from "./VirtualCaseList.jsx";

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

function renderList(caseCount, { enabled = true } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  const scrollEl = document.createElement("div");
  scrollEl.style.height = "400px";
  scrollEl.style.overflow = "auto";
  container.appendChild(scrollEl);
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
  const scrollRef = { current: scrollEl };

  root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        TreeScrollProvider,
        { scrollElementRef: scrollRef },
        createElement(
          "ul",
          null,
          createElement(VirtualCaseList, {
            cases: makeCases(caseCount),
            enabled,
            renderRow: (c, _index, { virtual }) =>
              createElement(virtual ? "div" : "li", { "data-case-id": c.case_id }, c.case_id),
          }),
        ),
      ),
    );
  });
  act(() => {});

  return scrollEl;
}

function countCaseRows() {
  return container.querySelectorAll("[data-case-id]").length;
}

describe("VirtualCaseList", () => {
  it("renders all rows when count is below threshold", () => {
    renderList(VIRTUAL_CASE_LIST_THRESHOLD - 1);
    expect(countCaseRows()).toBe(VIRTUAL_CASE_LIST_THRESHOLD - 1);
  });

  it("does not render all rows when count is above threshold", () => {
    const caseCount = VIRTUAL_CASE_LIST_THRESHOLD + 60;
    renderList(caseCount);
    expect(countCaseRows()).toBeLessThan(caseCount);
  });

  it("uses a single list container with estimated height before full virtualization", () => {
    const caseCount = VIRTUAL_CASE_LIST_THRESHOLD + 10;
    renderList(caseCount);
    const listContainer = container.querySelector("li.list-none");
    expect(listContainer).toBeTruthy();
    const height = Number.parseInt(listContainer.style.height, 10);
    expect(height).toBeGreaterThanOrEqual(caseCount * CASE_ROW_ESTIMATE_PX);
  });

  it("renders visible virtual rows when count is above threshold", () => {
    renderList(VIRTUAL_CASE_LIST_THRESHOLD + 10);
    expect(countCaseRows()).toBeGreaterThan(0);
  });

  it("renders all rows when virtualization is disabled via enabled=false", () => {
    renderList(100, { enabled: false });
    expect(countCaseRows()).toBe(100);
  });
});
