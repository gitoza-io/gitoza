import { describe, expect, it } from "vitest";
import { highlightCodeBlock } from "./highlightCodeBlock";

describe("highlightCodeBlock", () => {
  it("highlights yaml with span markup", () => {
    const html = highlightCodeBlock("title: My test case", "yaml");
    expect(html).toContain("<span");
    expect(html).toContain("title");
  });

  it("falls back safely for unknown language", () => {
    const html = highlightCodeBlock("plain text", "not-a-real-lang");
    expect(html).toContain("plain text");
    expect(html).not.toContain("<script");
  });

  it("escapes angle brackets in plaintext fallback path", () => {
    const html = highlightCodeBlock("<not-html>", "plaintext");
    expect(html).toContain("&lt;not-html&gt;");
  });
});
