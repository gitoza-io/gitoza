/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TestRepositoryThreeColumnLayout from "./TestRepositoryThreeColumnLayout.jsx";

let container = null;
let root = null;

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
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
  try {
    localStorage.removeItem("testRepo.col.treeWidth");
    localStorage.removeItem("testRepo.col.listWidth");
  } catch (_) {}
});

describe("TestRepositoryThreeColumnLayout", () => {
  it("renders tree, case list, and detail columns", () => {
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "400px";
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(TestRepositoryThreeColumnLayout, {
          treeColumn: createElement("div", { "data-testid": "tree" }, "Tree"),
          caseListColumn: createElement("div", { "data-testid": "cases" }, "Cases"),
          detailColumn: createElement("div", { "data-testid": "detail" }, "Detail"),
        }),
      );
    });
    expect(container.querySelector("[data-testid='tree']")).toBeTruthy();
    expect(container.querySelector("[data-testid='cases']")).toBeTruthy();
    expect(container.querySelector("[data-testid='detail']")).toBeTruthy();
  });

  it("applies select-none to tree and case list columns only", () => {
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "400px";
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(TestRepositoryThreeColumnLayout, {
          treeColumn: createElement("div", { "data-testid": "tree" }, "Tree"),
          caseListColumn: createElement("div", { "data-testid": "cases" }, "Cases"),
          detailColumn: createElement("div", { "data-testid": "detail" }, "Detail"),
        }),
      );
    });
    const aside = container.querySelector("aside");
    const section = container.querySelector("section");
    const main = container.querySelector("main");
    expect(aside?.className).toContain("select-none");
    expect(section?.className).toContain("select-none");
    expect(main?.className ?? "").not.toContain("select-none");
  });
});
