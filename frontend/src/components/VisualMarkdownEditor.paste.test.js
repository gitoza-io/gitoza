import { describe, expect, it } from "vitest";
import {
  insertMarkdownAtCursor,
  resolveVisualMarkdownPaste,
  sanitizeParsedMarkdownJson,
} from "./VisualMarkdownEditor";
import { isGfmPipeTableMarkdown } from "../utils/markdownSmartPaste";

describe("resolveVisualMarkdownPaste", () => {
  const tablePlain = `| Col A | Col B |
| --- | --- |
| one | two |`;

  it("intercepts plain GFM tables only", () => {
    expect(resolveVisualMarkdownPaste(tablePlain)).toBe(tablePlain);
    expect(isGfmPipeTableMarkdown(tablePlain)).toBe(true);
  });

  it("does not intercept headings/lists without a table (TipTap default paste)", () => {
    const md = `## Summary\n\n- First\n- Second`;
    expect(resolveVisualMarkdownPaste(md)).toBeNull();
  });

  it("does not intercept flat prose", () => {
    expect(resolveVisualMarkdownPaste("Just a sentence.")).toBeNull();
  });

  it("intercepts Cursor-like message that includes a table", () => {
    const msg = `## Summary\n\nIntro\n\n${tablePlain}\n\nDone`;
    expect(resolveVisualMarkdownPaste(msg)).toBe(msg);
  });
});

describe("sanitizeParsedMarkdownJson", () => {
  it("drops code mark when link+code coexist", () => {
    const node = {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "frontend/src/utils/markdownSmartPaste.js",
          marks: [
            { type: "link", attrs: { href: "https://example.com" } },
            { type: "code" },
          ],
        },
      ],
    };
    const out = sanitizeParsedMarkdownJson(node);
    expect(out.content[0].marks.map((m) => m.type)).toEqual(["link"]);
  });
});
