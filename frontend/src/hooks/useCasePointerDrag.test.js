/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCasePointerDrag } from "./useCasePointerDrag";
import { suppressClickAfterPointerUp } from "../utils/suppressClickAfterPointerUp";

let container = null;
let root = null;

function renderHook(props) {
  let hookResult = null;

  function TestComponent() {
    hookResult = useCasePointerDrag(props);
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
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe("suppressClickAfterPointerUp", () => {
  it("suppresses click events before the removal timer fires", () => {
    suppressClickAfterPointerUp();

    const target = document.createElement("button");
    document.body.appendChild(target);

    const handler = vi.fn();
    target.addEventListener("click", handler);

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handler).not.toHaveBeenCalled();

    vi.runAllTimers();
    target.remove();
  });

  it("allows click events after the removal timer fires", () => {
    suppressClickAfterPointerUp();
    vi.runAllTimers();

    const target = document.createElement("button");
    document.body.appendChild(target);

    const handler = vi.fn();
    target.addEventListener("click", handler);

    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(handler).toHaveBeenCalledTimes(1);

    target.remove();
  });
});

describe("useCasePointerDrag", () => {
  it("moves cases on drop and removes suppress listener after timer flush", async () => {
    const onMoveCasesToFolder = vi.fn().mockResolvedValue(undefined);
    const dropHeader = document.createElement("div");
    dropHeader.setAttribute("data-folder-drop-header", ".gitoza/test/cases/auth/target");
    document.body.appendChild(dropHeader);

    document.elementsFromPoint = vi.fn(() => [dropHeader]);

    const row = document.createElement("div");
    container.appendChild(row);

    const hook = renderHook({
      multiSelectActive: true,
      caseSelectionConfig: {
        onMoveCasesToFolder,
      },
    });

    const dragMeta = {
      paths: [".gitoza/test/cases/auth/source/case.yaml"],
      summaryLine: "1 case",
      detailLine: "case.yaml",
    };

    act(() => {
      hook.current.handleCaseRowPointerDown(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 10,
          clientY: 10,
          pointerId: 1,
        }),
        dragMeta,
      );
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
          pointerId: 1,
        }),
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: 50,
          clientY: 50,
          pointerId: 1,
        }),
      );
      await Promise.resolve();
    });

    expect(onMoveCasesToFolder).toHaveBeenCalledWith(
      [".gitoza/test/cases/auth/source/case.yaml"],
      ".gitoza/test/cases/auth/target",
    );

    act(() => {
      vi.runAllTimers();
    });

    const postDragHandler = vi.fn();
    document.addEventListener("click", postDragHandler, true);
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.removeEventListener("click", postDragHandler, true);

    expect(postDragHandler).toHaveBeenCalledTimes(1);

    dropHeader.remove();
    delete document.elementsFromPoint;
  });
});
