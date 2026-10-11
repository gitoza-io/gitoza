import { describe, expect, it } from "vitest";
import {
  consumeMarkdownListBlock,
  groupMarkdownListSiblings,
  parseMarkdownListLine,
} from "./markdownListRender";

describe("parseMarkdownListLine", () => {
  it("parses indent, ordered flag, number, and content", () => {
    expect(parseMarkdownListLine("- a")).toEqual({
      indentCols: 0,
      ordered: false,
      number: null,
      content: "a",
    });
    expect(parseMarkdownListLine("  - b")).toEqual({
      indentCols: 2,
      ordered: false,
      number: null,
      content: "b",
    });
    expect(parseMarkdownListLine("  1. c")).toEqual({
      indentCols: 2,
      ordered: true,
      number: 1,
      content: "c",
    });
  });
});

describe("consumeMarkdownListBlock", () => {
  it("nests indented bullets under the parent item", () => {
    const lines = ["- fff", "  - xxx", "  - fff", "plain"];
    const result = consumeMarkdownListBlock(lines, 0);
    expect(result?.nextIndex).toBe(3);
    expect(result?.roots).toHaveLength(1);
    expect(result?.roots[0].content).toBe("fff");
    expect(result?.roots[0].children.map((c) => c.content)).toEqual(["xxx", "fff"]);
  });

  it("keeps sibling top-level items flat", () => {
    const lines = ["- a", "- b"];
    const result = consumeMarkdownListBlock(lines, 0);
    expect(result?.roots.map((r) => r.content)).toEqual(["a", "b"]);
    expect(result?.roots[0].children).toEqual([]);
  });

  it("preserves nested ordered numbers from the source", () => {
    const lines = ["1. one", "  2. two", "  3. three", "4. four"];
    const result = consumeMarkdownListBlock(lines, 0);
    expect(result?.roots).toHaveLength(2);
    expect(result?.roots[0].number).toBe(1);
    expect(result?.roots[0].children.map((c) => c.number)).toEqual([2, 3]);
    expect(result?.roots[1].number).toBe(4);
  });
});

describe("groupMarkdownListSiblings", () => {
  it("groups consecutive ul vs ol", () => {
    const nodes = [
      { ordered: false, number: null, content: "a", task: null, depth: 0, children: [] },
      { ordered: false, number: null, content: "b", task: null, depth: 0, children: [] },
      { ordered: true, number: 1, content: "c", task: null, depth: 0, children: [] },
    ];
    expect(groupMarkdownListSiblings(nodes).map((g) => g.kind)).toEqual(["ul", "ol"]);
  });
});
