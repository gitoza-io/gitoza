import { describe, expect, it } from "vitest";
import { consumeFencedCodeBlock, isFenceOpenLine } from "./markdownFencedCode";

describe("isFenceOpenLine", () => {
  it("accepts backtick and tilde fences with optional lang", () => {
    expect(isFenceOpenLine("```yaml")).toBe(true);
    expect(isFenceOpenLine("````js")).toBe(true);
    expect(isFenceOpenLine("~~~bash")).toBe(true);
    expect(isFenceOpenLine("```")).toBe(true);
  });

  it("rejects non-fence lines", () => {
    expect(isFenceOpenLine("---")).toBe(false);
    expect(isFenceOpenLine("``` not a fence")).toBe(false);
    expect(isFenceOpenLine("``code``")).toBe(false);
  });
});

describe("consumeFencedCodeBlock", () => {
  it("parses a closed backtick fence with language", () => {
    const lines = ["```yaml", "---", "title: My test case", "---", "```"];
    const result = consumeFencedCodeBlock(lines, 0);
    expect(result).toEqual({
      nextIndex: 5,
      fenceChar: "`",
      fenceLen: 3,
      lang: "yaml",
      code: "---\ntitle: My test case\n---",
    });
  });

  it("parses tilde fences", () => {
    const lines = ["~~~", "line one", "~~~"];
    const result = consumeFencedCodeBlock(lines, 0);
    expect(result?.code).toBe("line one");
    expect(result?.nextIndex).toBe(3);
  });

  it("requires closing fence length >= opening length", () => {
    const lines = ["````", "code", "```"];
    const unclosed = consumeFencedCodeBlock(lines, 0);
    expect(unclosed?.nextIndex).toBe(3);
    expect(unclosed?.code).toBe("code\n```");
    const closed = ["````", "code", "````"];
    expect(consumeFencedCodeBlock(closed, 0)?.nextIndex).toBe(3);
  });

  it("consumes until EOF when fence is unclosed", () => {
    const lines = ["```json", "{", "  \"a\": 1"];
    const result = consumeFencedCodeBlock(lines, 0);
    expect(result?.code).toBe("{\n  \"a\": 1");
    expect(result?.nextIndex).toBe(3);
  });

  it("returns null when line is not a fence opener", () => {
    expect(consumeFencedCodeBlock(["plain text"], 0)).toBeNull();
  });

  it("captures mermaid language for diagram fences", () => {
    const lines = ["```mermaid", "flowchart LR", "  A --> B", "```"];
    const result = consumeFencedCodeBlock(lines, 0);
    expect(result?.lang).toBe("mermaid");
    expect(result?.code).toBe("flowchart LR\n  A --> B");
  });
});
