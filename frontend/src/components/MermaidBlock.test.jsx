/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderMock = vi.fn(async (_id, _source, container) => {
  if (container) {
    container.innerHTML = "<div data-mermaid-temp>drawing</div>";
  }
  return { svg: '<svg data-testid="mermaid-svg"><g /></svg>', diagramType: "flowchart" };
});

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: (...args) => renderMock(...args),
  },
}));

vi.mock("../utils/theme", () => ({
  documentIsDarkTheme: () => false,
}));

import MermaidBlock from "./MermaidBlock.jsx";

let container = null;
let root = null;

function renderBlock(chart) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(MermaidBlock, { chart }));
  });
}

function unmount() {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
}

beforeEach(() => {
  renderMock.mockClear();
});

afterEach(() => {
  unmount();
});

describe("MermaidBlock", () => {
  it("renders into a hidden off-screen container, not a visible body temp node", async () => {
    const chart = "flowchart LR\n  A --> B";
    await act(async () => {
      renderBlock(chart);
      await Promise.resolve();
    });

    expect(renderMock).toHaveBeenCalledTimes(1);
    const [, source, hostEl] = renderMock.mock.calls[0];
    expect(source).toContain("flowchart LR");
    expect(hostEl).toBeInstanceOf(HTMLElement);
    expect(hostEl.isConnected).toBe(false); // removed in finally after render

    // Shared host stays off-screen and never shows temp drawing markup on body.
    const hosts = [...document.body.querySelectorAll("[aria-hidden='true']")].filter(
      (el) => el.style.left === "-9999px",
    );
    expect(hosts.length).toBeGreaterThanOrEqual(1);
    expect(document.body.querySelector("[data-mermaid-temp]")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("serves cached SVG on revisit without calling mermaid.render again", async () => {
    const chart = "sequenceDiagram\n  A->>B: hi";
    await act(async () => {
      renderBlock(chart);
      await Promise.resolve();
    });
    expect(renderMock).toHaveBeenCalledTimes(1);
    unmount();
    renderMock.mockClear();

    await act(async () => {
      renderBlock(chart);
      await Promise.resolve();
    });

    expect(renderMock).not.toHaveBeenCalled();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("clears stale diagram when chart changes to an uncached source", async () => {
    await act(async () => {
      renderBlock("flowchart LR\n  X --> Y");
      await Promise.resolve();
    });
    expect(container.querySelector("svg")).toBeTruthy();

    let resolveRender;
    renderMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRender = resolve;
        }),
    );

    await act(async () => {
      root.render(createElement(MermaidBlock, { chart: "flowchart LR\n  P --> Q" }));
    });

    // While the new render is pending, show skeleton — not the previous SVG.
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();

    await act(async () => {
      resolveRender({
        svg: '<svg data-testid="mermaid-svg-new"><g /></svg>',
        diagramType: "flowchart",
      });
      await Promise.resolve();
    });

    expect(container.querySelector("svg")).toBeTruthy();
  });
});
