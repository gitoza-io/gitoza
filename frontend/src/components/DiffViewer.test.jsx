/**
 * @vitest-environment jsdom
 */
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIRTUAL_DIFF_VIEWER_THRESHOLD } from "../constants/virtualDiffViewer.js";
import { DiffViewer } from "./DiffViewer.jsx";

function makeDiffLines(n) {
  return Array.from({ length: n }, (_, i) => `+ line ${i}`).join("\n");
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

function renderDiff(content, { noRef = false } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);

  const scrollEl = document.createElement("div");
  scrollEl.style.height = "400px";
  scrollEl.style.overflow = "auto";
  container.appendChild(scrollEl);
  Object.defineProperty(scrollEl, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(scrollEl, "offsetHeight", { configurable: true, value: 400 });
  Object.defineProperty(scrollEl, "scrollHeight", { configurable: true, value: 100000 });
  scrollEl.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: 300,
    height: 400,
    bottom: 400,
    right: 300,
  });

  const scrollRef = createRef();
  scrollRef.current = scrollEl;

  root = createRoot(scrollEl);
  act(() => {
    root.render(
      createElement(DiffViewer, {
        content,
        parentScrollRef: noRef ? null : scrollRef,
      }),
    );
  });
  act(() => {});

  return scrollEl;
}

function countDiffLines() {
  return container.querySelectorAll("[data-diff-line]").length;
}

describe("DiffViewer", () => {
  it("shows empty state when content is missing", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(DiffViewer, { content: "" }));
    });
    expect(container.textContent).toContain("No diff for this file.");
  });

  it("renders all rows when count is below threshold", () => {
    const lineCount = VIRTUAL_DIFF_VIEWER_THRESHOLD - 50;
    renderDiff(makeDiffLines(lineCount), { noRef: true });
    expect(countDiffLines()).toBe(lineCount);
  });

  it("does not render all rows when count is above threshold with parent scroll ref", () => {
    const lineCount = VIRTUAL_DIFF_VIEWER_THRESHOLD + 50;
    renderDiff(makeDiffLines(lineCount));
    expect(countDiffLines()).toBeLessThan(lineCount);
    expect(countDiffLines()).toBeLessThan(40);
  });

  it("renders all rows when count is above threshold but parentScrollRef is omitted", () => {
    const lineCount = VIRTUAL_DIFF_VIEWER_THRESHOLD + 50;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(DiffViewer, { content: makeDiffLines(lineCount) }));
    });
    act(() => {});
    expect(container.querySelectorAll("[data-diff-line]").length).toBe(lineCount);
  });
});
