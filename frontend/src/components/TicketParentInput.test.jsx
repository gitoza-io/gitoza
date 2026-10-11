/**
 * @vitest-environment jsdom
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTicketById, searchTicketsForLink } from "../utils/ticketLinks";
import TicketParentInput from "./TicketParentInput.jsx";

vi.mock("../utils/ticketLinks", () => ({
  resolveTicketById: vi.fn(async () => null),
  searchTicketsForLink: vi.fn(async () => []),
}));

let container = null;
let root = null;

function renderInput(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(TicketParentInput, props));
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

async function flushBlurCommit() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 200));
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
  resolveTicketById.mockReset();
  searchTicketsForLink.mockReset();
  resolveTicketById.mockResolvedValue(null);
  searchTicketsForLink.mockResolvedValue([]);
});

describe("TicketParentInput", () => {
  it("does not persist unmatched draft on blur", async () => {
    const onChange = vi.fn();
    const onPick = vi.fn();
    renderInput({ value: "", onChange, onPick, repoSlug: "demo" });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "NOPE");
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      input.blur();
    });
    await flushBlurCommit();
    expect(onPick).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("keeps an already-saved unresolved id on blur without editing", async () => {
    const onChange = vi.fn();
    renderInput({ value: "DEAD-1", onChange, repoSlug: "demo" });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    act(() => {
      input.blur();
    });
    await flushBlurCommit();
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("DEAD-1");
  });

  it("commits a resolved id on blur", async () => {
    const onChange = vi.fn();
    resolveTicketById.mockResolvedValue({ ticket_id: "DEMO-1" });
    renderInput({ value: "", onChange, repoSlug: "demo" });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "demo-1");
    act(() => {
      input.blur();
    });
    await flushBlurCommit();
    expect(onChange).toHaveBeenCalledWith("DEMO-1");
  });

  it("commits clear synchronously on blur", () => {
    const onChange = vi.fn();
    renderInput({ value: "PARENT-1", onChange, repoSlug: "demo" });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "");
    expect(onChange).toHaveBeenCalledWith("");
    onChange.mockClear();
    act(() => {
      input.blur();
    });
    // Sync path may call clear again; must not require the 150ms timer.
    expect(onChange.mock.calls.every((c) => c[0] === "")).toBe(true);
  });

  it("does not persist unmatched draft on Enter", async () => {
    const onChange = vi.fn();
    const onPick = vi.fn();
    renderInput({ value: "", onChange, onPick, repoSlug: "demo" });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "NOPE");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onPick).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("picks a suggestion without waiting for blur resolve", async () => {
    const onChange = vi.fn();
    const onPick = vi.fn();
    searchTicketsForLink.mockResolvedValue([
      { ticket_id: "DEMO-1", title: "Login", file_path: "tickets/DEMO-1.md" },
    ]);
    renderInput({ value: "", onChange, onPick, repoSlug: "demo" });
    const input = container.querySelector("input");
    act(() => {
      input.focus();
    });
    setInputValue(input, "DEMO");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    const optionBtn = document.querySelector('[role="listbox"] button');
    expect(optionBtn).toBeTruthy();
    act(() => {
      optionBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onPick).toHaveBeenCalledWith("DEMO-1");
    expect(onChange).not.toHaveBeenCalled();
  });
});
