import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import {
  createVisualMarkdownExtensions,
  normalizeMarkdownForCompare,
} from "./visualMarkdownExtensions";
import { unescapeTipTapMarkdown } from "./unescapeTipTapMarkdown";
import { escapeWikiLinkPipesForGfm } from "./gfmPipeTable";
import { ACTION_EXPECTATION_TABLE_MARKDOWN } from "./actionExpectationTable";
import { GENERIC_TABLE_MARKDOWN } from "./genericTableMarkdown";

/**
 * @param {string} markdown
 * @returns {Editor}
 */
function createHeadlessEditor(markdown) {
  return new Editor({
    extensions: createVisualMarkdownExtensions({
      withReactImage: false,
      placeholder: "",
    }),
    content: escapeWikiLinkPipesForGfm(markdown),
    contentType: "markdown",
  });
}

/**
 * @param {Editor} editor
 * @returns {string}
 */
function persistedMarkdown(editor) {
  return unescapeTipTapMarkdown(editor.getMarkdown());
}

/**
 * @param {import('@tiptap/core').JSONContent | undefined} node
 * @param {string} type
 * @returns {boolean}
 */
function hasNodeType(node, type) {
  if (!node) return false;
  if (node.type === type) return true;
  return (node.content || []).some((child) => hasNodeType(child, type));
}

describe("visualMarkdownRoundTrip", () => {
  /** @type {Editor[]} */
  const editors = [];

  afterEach(() => {
    while (editors.length) {
      editors.pop()?.destroy();
    }
  });

  /**
   * @param {string} markdown
   * @returns {string}
   */
  function roundTrip(markdown) {
    const editor = createHeadlessEditor(markdown);
    editors.push(editor);
    return persistedMarkdown(editor);
  }

  it("round-trips headings, lists, and bold", () => {
    const src = `## Summary

- First item
- Second item

This is **bold** text.`;
    const out = roundTrip(src);
    expect(normalizeMarkdownForCompare(out)).toContain("## Summary");
    expect(normalizeMarkdownForCompare(out)).toMatch(/-\s+First item/);
    expect(normalizeMarkdownForCompare(out)).toMatch(/-\s+Second item/);
    expect(normalizeMarkdownForCompare(out)).toContain("**bold**");
  });

  it("round-trips fenced code and blockquote", () => {
    const src = `> Note line

\`\`\`js
console.log(1)
\`\`\``;
    const out = normalizeMarkdownForCompare(roundTrip(src));
    expect(out).toContain("> Note line");
    expect(out).toContain("```");
    expect(out).toContain("console.log(1)");
  });

  it("round-trips asset image lines", () => {
    const src = `Hello

![image](img_abc123.png)

More`;
    const out = normalizeMarkdownForCompare(roundTrip(src));
    expect(out).toContain("![image](img_abc123.png)");
    expect(out).toContain("Hello");
    expect(out).toContain("More");
  });

  it("preserves content across setContent cycles (mode switch smoke)", () => {
    const src = `### Title

1. One
2. Two`;
    const editor = createHeadlessEditor(src);
    editors.push(editor);
    const mid = persistedMarkdown(editor);
    editor.commands.setContent(escapeWikiLinkPipesForGfm(mid), {
      contentType: "markdown",
    });
    const again = persistedMarkdown(editor);
    expect(normalizeMarkdownForCompare(again)).toBe(
      normalizeMarkdownForCompare(mid),
    );
    expect(normalizeMarkdownForCompare(again)).toContain("### Title");
    expect(normalizeMarkdownForCompare(again)).toMatch(/1\.\s+One/);
  });

  it("treats TipTap-escaped and raw underscores as equal for compare", () => {
    expect(normalizeMarkdownForCompare("foo_bar")).toBe(
      normalizeMarkdownForCompare("foo\\_bar"),
    );
    expect(normalizeMarkdownForCompare("AT&T")).toBe(
      normalizeMarkdownForCompare("AT&amp;T"),
    );
  });

  it("persists wiki links without TipTap backslash escapes", () => {
    const src = `See [[REAL-8SB8FI|pull from remote]] and [[T-1]].`;
    const out = normalizeMarkdownForCompare(roundTrip(src));
    expect(out).toContain("[[REAL-8SB8FI|pull from remote]]");
    expect(out).toContain("[[T-1]]");
    expect(out).not.toContain("\\[\\[");
    expect(out).not.toMatch(/\\\[\\\[/);
  });

  it("round-trips underscores, asterisks, brackets, and HTML entities without serializer escapes", () => {
    const src = `Use snake_case and REQ_ID.

Cost is 2 * 3 and [note] plus AT&T where x < y and a ~ b.`;
    const out = normalizeMarkdownForCompare(roundTrip(src));
    expect(out).toContain("snake_case");
    expect(out).toContain("REQ_ID");
    expect(out).not.toMatch(/\\_/);
    expect(out).toContain("2 * 3");
    expect(out).not.toMatch(/\\\*/);
    expect(out).toContain("[note]");
    expect(out).not.toMatch(/\\\[/);
    expect(out).toContain("AT&T");
    expect(out).not.toContain("&amp;");
    expect(out).toContain("x < y");
    expect(out).not.toContain("&lt;");
    expect(out).toContain("a ~ b");
    expect(out).not.toMatch(/\\~/);
  });

  it("leaves escaped underscores inside fenced code after round-trip persist", () => {
    const src = "```js\nfoo\\_bar\n```";
    const out = roundTrip(src);
    expect(out).toContain("foo\\_bar");
  });

  it("bullet toggle does not leave literal double - markers", () => {
    const editor = createHeadlessEditor("Item text");
    editors.push(editor);
    editor.chain().focus().toggleBulletList().run();
    const once = normalizeMarkdownForCompare(persistedMarkdown(editor));
    expect(once).toMatch(/^-\s+Item text$/);
    expect(once).not.toContain("- -");
    editor.chain().focus().toggleBulletList().run();
    const off = normalizeMarkdownForCompare(persistedMarkdown(editor));
    expect(off).toBe("Item text");
  });

  it("parses GFM task list into TipTap taskList / taskItem nodes", () => {
    const src = `- [ ] open
- [x] done`;
    const editor = createHeadlessEditor(src);
    editors.push(editor);
    expect(hasNodeType(editor.getJSON(), "taskList")).toBe(true);
    expect(hasNodeType(editor.getJSON(), "taskItem")).toBe(true);
  });

  it("round-trips GFM checkbox list markers", () => {
    const src = `- [ ] open
- [x] done`;
    const out = normalizeMarkdownForCompare(roundTrip(src));
    expect(out).toMatch(/-\s+\[\s\]\s+open/);
    expect(out).toMatch(/-\s+\[[xX]\]\s+done/);
  });

  it("toggleTaskList produces checklist markdown", () => {
    const editor = createHeadlessEditor("Item text");
    editors.push(editor);
    editor.chain().focus().toggleTaskList().run();
    const once = normalizeMarkdownForCompare(persistedMarkdown(editor));
    expect(once).toMatch(/^-\s+\[\s\]\s+Item text$/);
    expect(hasNodeType(editor.getJSON(), "taskList")).toBe(true);
    editor.chain().focus().toggleTaskList().run();
    const off = normalizeMarkdownForCompare(persistedMarkdown(editor));
    expect(off).toBe("Item text");
  });

  it("parses action-expectation table into TipTap table nodes", () => {
    const editor = createHeadlessEditor(ACTION_EXPECTATION_TABLE_MARKDOWN);
    editors.push(editor);
    expect(hasNodeType(editor.getJSON(), "table")).toBe(true);
    expect(hasNodeType(editor.getJSON(), "tableRow")).toBe(true);
  });

  it("round-trips action-expectation GFM table without wiping rows", () => {
    const out = normalizeMarkdownForCompare(
      roundTrip(ACTION_EXPECTATION_TABLE_MARKDOWN),
    );
    expect(out).toMatch(/\|\s*#\s*\|\s*Action\s*\|\s*Expected result\s*\|/i);
    expect(out).toMatch(/\|[-: |]+\|/);
    // Three numbered body rows preserved
    expect(out).toMatch(/\|\s*1\s*\|/);
    expect(out).toMatch(/\|\s*2\s*\|/);
    expect(out).toMatch(/\|\s*3\s*\|/);
  });

  it("parses generic blank table into TipTap table nodes", () => {
    const editor = createHeadlessEditor(GENERIC_TABLE_MARKDOWN);
    editors.push(editor);
    expect(hasNodeType(editor.getJSON(), "table")).toBe(true);
  });

  it("round-trips generic blank GFM table", () => {
    const out = normalizeMarkdownForCompare(roundTrip(GENERIC_TABLE_MARKDOWN));
    expect(out).toMatch(/\|\s*Column 1\s*\|\s*Column 2\s*\|\s*Column 3\s*\|/i);
    expect(out).toMatch(/\|[-: |]+\|/);
  });

  it("keeps labeled wiki links in one GFM table cell", () => {
    const src = `| Note | Other |
| --- | --- |
| See [[T-1|Fix login]] | x |`;
    const editor = createHeadlessEditor(src);
    editors.push(editor);
    expect(hasNodeType(editor.getJSON(), "table")).toBe(true);

    /** Collect text from the first body tableCell. */
    let bodyCellText = "";
    let sawHeaderRow = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableRow") {
        if (!sawHeaderRow) {
          sawHeaderRow = true;
          return true;
        }
        node.forEach((cell) => {
          if (
            !bodyCellText &&
            (cell.type.name === "tableCell" || cell.type.name === "tableHeader")
          ) {
            bodyCellText = cell.textContent;
          }
        });
        return false;
      }
      return true;
    });
    expect(bodyCellText).toContain("[[T-1|Fix login]]");
    expect(bodyCellText).not.toMatch(/^See \[\[T-1$/);

    const out = normalizeMarkdownForCompare(persistedMarkdown(editor));
    expect(out).toContain("[[T-1|Fix login]]");
    expect(out).not.toContain("[[T-1\\|Fix login]]");
  });

  it("insertContent markdown paste path keeps GFM table (no wipe)", () => {
    const table = `| Col A | Col B |
| --- | --- |
| one | two |`;
    const editor = createHeadlessEditor("Intro line");
    editors.push(editor);
    const parsed = editor.storage.markdown.manager.parse(
      escapeWikiLinkPipesForGfm(table),
    );
    expect(parsed?.content?.length).toBeGreaterThan(0);
    const pos = editor.state.doc.content.size;
    const ok = editor.commands.insertContentAt(pos, parsed.content);
    expect(ok).toBe(true);
    const out = normalizeMarkdownForCompare(persistedMarkdown(editor));
    expect(out).toContain("Intro line");
    expect(out).toMatch(/Col A/);
    expect(out).toMatch(/one/);
    expect(hasNodeType(editor.getJSON(), "table")).toBe(true);
  });

  it("insertTable then addRowAfter increases row count; deleteRow decreases it", () => {
    const editor = createHeadlessEditor(".");
    editors.push(editor);
    editor.commands.selectAll();
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
    expect(hasNodeType(editor.getJSON(), "table")).toBe(true);

    /**
     * @param {import('@tiptap/core').JSONContent | undefined} node
     * @returns {number}
     */
    function countTableRows(node) {
      if (!node) return 0;
      if (node.type === "tableRow") return 1;
      return (node.content || []).reduce(
        (sum, child) => sum + countTableRows(child),
        0,
      );
    }

    const afterInsert = countTableRows(editor.getJSON());
    expect(afterInsert).toBe(3);

    // Place selection inside first table cell
    let cellPos = null;
    editor.state.doc.descendants((node, pos) => {
      if (cellPos != null) return false;
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        cellPos = pos + 1;
        return false;
      }
      return true;
    });
    expect(cellPos).not.toBeNull();
    editor.commands.setTextSelection(cellPos);
    expect(editor.isActive("table")).toBe(true);

    editor.chain().focus().addRowAfter().run();
    expect(countTableRows(editor.getJSON())).toBe(afterInsert + 1);

    editor.chain().focus().deleteRow().run();
    expect(countTableRows(editor.getJSON())).toBe(afterInsert);
  });
});
