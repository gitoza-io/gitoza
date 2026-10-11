/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ParamKeyValueComposer from "./ParamKeyValueComposer";

let container = null;
let root = null;

function setInputValue(input, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("focus", { bubbles: true }));
  });
}

function renderComposer(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(ParamKeyValueComposer, props));
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe("ParamKeyValueComposer", () => {
  it("calls onConfirm with key and value", () => {
    const onConfirm = vi.fn();
    renderComposer({
      paramKeys: ["browser", "env"],
      paramValuesByKey: { browser: ["Chrome", "Firefox"], env: ["staging"] },
      onConfirm,
      onCancel: () => {},
    });

    const inputs = container.querySelectorAll("input");
    const keyInput = inputs[0];
    const valueInput = inputs[1];
    setInputValue(keyInput, "browser");
    setInputValue(valueInput, "Chrome");

    const confirmBtn = container.querySelector('button[aria-label="Confirm custom field"]');
    act(() => {
      confirmBtn.click();
    });

    expect(onConfirm).toHaveBeenCalledWith({ key: "browser", value: "Chrome" });
  });
});
