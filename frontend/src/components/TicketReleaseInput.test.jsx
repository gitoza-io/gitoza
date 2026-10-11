/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveReleaseById, searchReleasesForLink } from "../utils/releaseLinks";
import TicketReleaseInput from "./TicketReleaseInput.jsx";

vi.mock("../utils/releaseLinks", () => ({
  formatReleaseSuggestionLabel: (r) => r?.release_id || "",
  resolveReleaseById: vi.fn(async () => null),
  searchReleasesForLink: vi.fn(async () => []),
}));

let container = null;
let root = null;

function renderInput(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(TicketReleaseInput, props));
  });
}

function setInputValue(input, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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

beforeEach(() => {
  resolveReleaseById.mockReset();
  searchReleasesForLink.mockReset();
  resolveReleaseById.mockResolvedValue(null);
  searchReleasesForLink.mockResolvedValue([]);
});

describe("TicketReleaseInput clear before navigate/view", () => {
  it("pushes empty to parent while typing so autosave can start before blur", () => {
    const onChange = vi.fn();
    renderInput({
      value: "demo/1.0.0",
      onChange,
      repoSlug: "demo",
    });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "");
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("commits clear synchronously on blur and calls onBlur (no 150ms wait)", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    renderInput({
      value: "demo/1.0.0",
      onChange,
      onBlur,
      repoSlug: "demo",
    });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "");
    onChange.mockClear();
    act(() => {
      input.blur();
    });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("commits clear on unmount when parent value was not yet updated", () => {
    const onChange = vi.fn();
    renderInput({
      value: "demo/1.0.0",
      onChange,
      repoSlug: "demo",
    });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "");
    onChange.mockClear();
    // value prop still "demo/1.0.0" (parent has not re-rendered); draft is "".
    act(() => {
      root.unmount();
      root = null;
    });
    expect(onChange).toHaveBeenCalledWith("");
  });
});
