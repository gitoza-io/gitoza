/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import CaseListPagination from "./CaseListPagination.jsx";

let container = null;
let root = null;

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

describe("CaseListPagination", () => {
  it("renders nothing when only one page", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        createElement(CaseListPagination, {
          page: 1,
          totalPages: 1,
          onPageChange: () => {},
        }),
      );
    });
    expect(container.querySelector("nav")).toBeNull();
  });

  it("disables previous on first page", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onPageChange = vi.fn();
    act(() => {
      root.render(
        createElement(CaseListPagination, {
          page: 1,
          totalPages: 3,
          onPageChange,
        }),
      );
    });
    const prev = container.querySelector('[aria-label="Previous page"]');
    expect(prev.disabled).toBe(true);
  });
});
