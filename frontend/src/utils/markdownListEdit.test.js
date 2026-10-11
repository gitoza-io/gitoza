import { describe, expect, it } from "vitest";
import {
  continueListOnEnter,
  indentListSelection,
  outdentListSelection,
  parseListLine,
} from "./markdownListEdit";

describe("parseListLine", () => {
  it("parses bullets and numbered items with indent", () => {
    expect(parseListLine("- a")).toEqual({ indent: "", marker: "-", number: null });
    expect(parseListLine("  * b")).toEqual({ indent: "  ", marker: "*", number: null });
    expect(parseListLine("1. c")).toEqual({ indent: "", marker: "1.", number: 1 });
    expect(parseListLine("    12. d")).toEqual({ indent: "    ", marker: "12.", number: 12 });
    expect(parseListLine("plain")).toBe(null);
  });
});

describe("indentListSelection", () => {
  it("indents a single bullet line", () => {
    const value = "- item";
    const result = indentListSelection(value, 2, 2);
    expect(result).toEqual({
      newValue: "  - item",
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it("indents a numbered line", () => {
    const value = "1. item";
    const result = indentListSelection(value, 0, 0);
    expect(result?.newValue).toBe("  1. item");
  });

  it("renumbers a nested numbered item to start at 1", () => {
    const value = "1. one\n2. two";
    // caret on second line
    const result = indentListSelection(value, 7, 7);
    expect(result?.newValue).toBe("1. one\n  1. two");
  });

  it("renumbers a multi-line numbered indent run to 1., 2.", () => {
    const value = "1. one\n2. two\n3. three";
    const start = value.indexOf("2.");
    const end = value.length;
    const result = indentListSelection(value, start, end);
    expect(result?.newValue).toBe("1. one\n  1. two\n  2. three");
  });

  it("indents only list lines in a mixed selection", () => {
    const value = "- a\nplain\n- b";
    const result = indentListSelection(value, 0, value.length);
    expect(result?.newValue).toBe("  - a\nplain\n  - b");
  });

  it("returns null for non-list lines", () => {
    expect(indentListSelection("hello", 1, 1)).toBe(null);
  });
});

describe("outdentListSelection", () => {
  it("outdents an indented bullet", () => {
    const value = "  - item";
    const result = outdentListSelection(value, 4, 4);
    expect(result).toEqual({
      newValue: "- item",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("returns null when already at column 0", () => {
    expect(outdentListSelection("- item", 2, 2)).toBe(null);
  });
});

describe("continueListOnEnter", () => {
  it("continues a top-level bullet", () => {
    const value = "- a";
    const result = continueListOnEnter(value, value.length);
    expect(result).toEqual({ newValue: "- a\n- ", newCursor: 6 });
  });

  it("preserves indent on Enter", () => {
    const value = "  - a";
    const result = continueListOnEnter(value, value.length);
    expect(result).toEqual({ newValue: "  - a\n  - ", newCursor: 10 });
  });

  it("continues numbered lists", () => {
    const value = "  2. a";
    const result = continueListOnEnter(value, value.length);
    expect(result?.newValue).toBe("  2. a\n  3. ");
  });

  it("returns null for non-list lines", () => {
    expect(continueListOnEnter("hello", 5)).toBe(null);
  });
});
