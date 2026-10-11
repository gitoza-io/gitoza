import { describe, expect, it } from "vitest";
import {
  choosePastePayload,
  htmlHasStructure,
  htmlToMarkdown,
  looksLikeMarkdown,
  normalizeMarkdownEditorMode,
} from "./markdownSmartPaste";

describe("normalizeMarkdownEditorMode", () => {
  it("defaults unknown values to normal", () => {
    expect(normalizeMarkdownEditorMode(null)).toBe("normal");
    expect(normalizeMarkdownEditorMode("fancy")).toBe("normal");
    expect(normalizeMarkdownEditorMode("markdown")).toBe("markdown");
  });
});

describe("looksLikeMarkdown", () => {
  it("detects AI-style Markdown plain text", () => {
    const plain = `## Summary\n\n- First item\n- Second item\n\n\`\`\`js\nconsole.log(1)\n\`\`\``;
    expect(looksLikeMarkdown(plain)).toBe(true);
  });

  it("rejects plain prose", () => {
    expect(looksLikeMarkdown("Just a sentence without structure.")).toBe(false);
    expect(looksLikeMarkdown("")).toBe(false);
  });

  it("detects GFM pipe tables", () => {
    const table = `| Col A | Col B |
| --- | --- |
| one | two |`;
    expect(looksLikeMarkdown(table)).toBe(true);
  });

  it("rejects prose with a single pipe", () => {
    expect(looksLikeMarkdown("Use option A | option B carefully.")).toBe(false);
  });
});

describe("htmlHasStructure", () => {
  it("detects ChatGPT-like HTML lists and headings", () => {
    const html = `<h2>Summary</h2><ul><li>First</li><li>Second</li></ul>`;
    expect(htmlHasStructure(html)).toBe(true);
  });

  it("ignores naked span wrappers", () => {
    expect(htmlHasStructure(`<span style="color:red">hello</span>`)).toBe(false);
  });
});

describe("htmlToMarkdown", () => {
  it("converts headings and lists", () => {
    const md = htmlToMarkdown(`<h2>Summary</h2><ul><li>First</li><li>Second</li></ul>`);
    expect(md).toContain("## Summary");
    expect(md).toMatch(/-\s+First/);
    expect(md).toMatch(/-\s+Second/);
  });
});

describe("choosePastePayload", () => {
  const structuredHtml = `<h2>Title</h2><ul><li>One</li><li>Two</li></ul>`;
  const flatPlain = "Title\nOne\nTwo";

  it("markdown mode always uses plain text", () => {
    expect(
      choosePastePayload({
        mode: "markdown",
        plain: flatPlain,
        html: structuredHtml,
      }),
    ).toBe(flatPlain);
  });

  it("normal mode keeps already-Markdown plain", () => {
    const mdPlain = "## Title\n\n- One\n- Two";
    expect(
      choosePastePayload({
        mode: "normal",
        plain: mdPlain,
        html: structuredHtml,
      }),
    ).toBe(mdPlain);
  });

  it("normal mode converts structured HTML when plain is flat", () => {
    const result = choosePastePayload({
      mode: "normal",
      plain: flatPlain,
      html: structuredHtml,
    });
    expect(result).toContain("## Title");
    expect(result).toMatch(/-\s+One/);
  });

  it("normal mode falls back to plain when html is empty", () => {
    expect(
      choosePastePayload({
        mode: "normal",
        plain: "hello",
        html: "",
      }),
    ).toBe("hello");
  });

  it("normal mode keeps GFM table plain over Cursor-like paragraph HTML", () => {
    const tablePlain = `| Col A | Col B |
| --- | --- |
| one | two |`;
    const cursorHtml = `<p>| Col A | Col B |</p><p>| --- | --- |</p><p>| one | two |</p>`;
    const result = choosePastePayload({
      mode: "normal",
      plain: tablePlain,
      html: cursorHtml,
    });
    expect(result).toBe(tablePlain);
    expect(result).not.toMatch(/\|\s*\n\n\s*\|/);
  });

  it("handles empty clipboard", () => {
    expect(choosePastePayload({ mode: "normal", plain: "", html: "" })).toBe("");
  });
});
