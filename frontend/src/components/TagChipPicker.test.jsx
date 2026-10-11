/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import TagChipPicker from "./TagChipPicker.jsx";

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

function renderPicker(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(TagChipPicker, props));
  });
}

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

describe("TagChipPicker", () => {
  const options = ["Adm", "Smoke", "API"];

  it("filters dropdown options while typing", () => {
    renderPicker({ options, value: [], onChange: () => {} });
    const input = container.querySelector("#tag-chip-picker-input");
    setInputValue(input, "sm");
    const listItems = container.querySelectorAll('[role="listbox"] li');
    expect(listItems).toHaveLength(1);
    expect(listItems[0].textContent).toContain("Smoke");
  });

  it("confirms search on Enter without adding a tag", () => {
    const onChange = vi.fn();
    renderPicker({ options, value: [], onChange });
    const input = container.querySelector("#tag-chip-picker-input");
    setInputValue(input, "adm");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("adds tag when a dropdown option is clicked", () => {
    const onChange = vi.fn();
    renderPicker({ options, value: [], onChange });
    const input = container.querySelector("#tag-chip-picker-input");
    setInputValue(input, "adm");
    const optionBtn = container.querySelector('[role="listbox"] button');
    act(() => {
      optionBtn.click();
    });
    expect(onChange).toHaveBeenCalledWith(["Adm"]);
  });

  it("blurs input after select when refocusAfterSelect is false", () => {
    const onChange = vi.fn();
    renderPicker({ options, value: [], onChange, refocusAfterSelect: false });
    const input = container.querySelector("#tag-chip-picker-input");
    const blurSpy = vi.spyOn(input, "blur");
    setInputValue(input, "adm");
    const optionBtn = container.querySelector('[role="listbox"] button');
    act(() => {
      optionBtn.click();
    });
    expect(onChange).toHaveBeenCalledWith(["Adm"]);
    expect(blurSpy).toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("removes chip and calls onChange without removed tag", () => {
    const onChange = vi.fn();
    renderPicker({ options, value: ["Adm", "Smoke"], onChange });
    const removeBtn = container.querySelector('[aria-label="Remove tag Adm"]');
    act(() => {
      removeBtn.click();
    });
    expect(onChange).toHaveBeenCalledWith(["Smoke"]);
  });

  it("clears all selected tags", () => {
    const onChange = vi.fn();
    renderPicker({ options, value: ["Adm", "Smoke"], onChange });
    const clearBtn = container.querySelector('[aria-label="Clear all selected tags"]');
    act(() => {
      clearBtn.click();
    });
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
