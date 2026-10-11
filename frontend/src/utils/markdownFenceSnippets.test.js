import { describe, expect, it } from "vitest";
import {
  CODE_FENCE_CLOSE,
  CODE_FENCE_OPEN,
  MERMAID_FENCE_CLOSE,
  MERMAID_FENCE_OPEN,
  codeFenceCursorOffset,
  codeFenceSnippet,
  mermaidFenceCursorOffset,
  mermaidFenceSnippet,
  wrapInCodeFence,
  wrapInMermaidFence,
} from "./markdownFenceSnippets";

describe("markdownFenceSnippets", () => {
  it("builds an empty code fence with cursor on the body line", () => {
    const text = codeFenceSnippet();
    expect(text).toBe("\n```\n\n```\n");
    expect(codeFenceCursorOffset()).toBe(CODE_FENCE_OPEN.length);
    expect(text.slice(0, codeFenceCursorOffset())).toBe(CODE_FENCE_OPEN);
    expect(text.slice(codeFenceCursorOffset())).toBe(CODE_FENCE_CLOSE);
  });

  it("builds an empty mermaid fence with cursor on the body line", () => {
    const text = mermaidFenceSnippet();
    expect(text).toBe("\n```mermaid\n\n```\n");
    expect(mermaidFenceCursorOffset()).toBe(MERMAID_FENCE_OPEN.length);
    expect(text.slice(0, mermaidFenceCursorOffset())).toBe(MERMAID_FENCE_OPEN);
    expect(text.slice(mermaidFenceCursorOffset())).toBe(MERMAID_FENCE_CLOSE);
  });

  it("wrapInCodeFence wraps selection or returns empty fence", () => {
    expect(wrapInCodeFence("")).toEqual({
      text: codeFenceSnippet(),
      cursorOffset: codeFenceCursorOffset(),
    });
    expect(wrapInCodeFence("const x = 1")).toEqual({
      text: "\n```\nconst x = 1\n```\n",
      cursorOffset: CODE_FENCE_OPEN.length + "const x = 1".length,
    });
  });

  it("wrapInMermaidFence wraps selection or returns empty fence", () => {
    expect(wrapInMermaidFence("")).toEqual({
      text: mermaidFenceSnippet(),
      cursorOffset: mermaidFenceCursorOffset(),
    });
    expect(wrapInMermaidFence("flowchart LR\n  A --> B")).toEqual({
      text: "\n```mermaid\nflowchart LR\n  A --> B\n```\n",
      cursorOffset: MERMAID_FENCE_OPEN.length + "flowchart LR\n  A --> B".length,
    });
  });
});
