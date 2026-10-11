import { describe, expect, it } from "vitest";
import { markdownToExportHtml } from "./markdownToExportHtml";

describe("markdownToExportHtml fenced code blocks", () => {
  it("renders yaml fence as pre/code with highlighted content", () => {
    const md = [
      "**Minimum that still indexes:**",
      "",
      "```yaml",
      "---",
      "title: My test case",
      "---",
      "```",
    ].join("\n");

    const html = markdownToExportHtml(md);
    expect(html).toContain('<pre class="export-md-pre">');
    expect(html).toContain('class="export-md-pre-code hljs"');
    expect(html).toContain("title");
    expect(html).not.toContain('<hr class="export-md-hr" />');
  });

  it("still renders standalone horizontal rules outside fences", () => {
    const html = markdownToExportHtml("above\n---\nbelow");
    expect(html).toContain('<hr class="export-md-hr" />');
  });
});

describe("markdownToExportHtml inline marks", () => {
  it("renders bold wrapping inline code without leftover asterisks", () => {
    const html = markdownToExportHtml("**`gitoza`**");
    expect(html).toContain(
      '<strong class="export-md-strong"><code class="export-md-code">gitoza</code></strong>',
    );
    expect(html).not.toContain("**");
  });

  it("renders plain bold and plain inline code", () => {
    const html = markdownToExportHtml("**bold** and `code`");
    expect(html).toContain('<strong class="export-md-strong">bold</strong>');
    expect(html).toContain('<code class="export-md-code">code</code>');
  });

  it("nests inline code inside bold with surrounding text", () => {
    const html = markdownToExportHtml("**bold `x` end**");
    expect(html).toContain(
      '<strong class="export-md-strong">bold <code class="export-md-code">x</code> end</strong>',
    );
    expect(html).not.toContain("**");
  });
});

describe("markdownToExportHtml GFM tables", () => {
  it("keeps labeled wiki links in one table cell", () => {
    const md = [
      "| Col A | Col B |",
      "| --- | --- |",
      "| [[T-1|Fix login]] | other |",
    ].join("\n");
    const html = markdownToExportHtml(md);
    const tdMatches = html.match(/<td\b[^>]*>/g) || [];
    expect(tdMatches).toHaveLength(2);
    expect(html).toContain("[[T-1|Fix login]]");
    expect(html).toContain(">other</td>");
  });
});

describe("markdownToExportHtml nested lists", () => {
  it("nests indented bullets under the parent", () => {
    const html = markdownToExportHtml("- fff\n  - xxx\n  - fff");
    expect(html).toContain('class="export-md-ul-disc"');
    expect(html).toContain('class="export-md-ul-circle"');
    expect(html).toMatch(
      /<ul class="export-md-ul-disc"><li class="export-md-li">fff<ul class="export-md-ul-circle">/,
    );
    expect(html).toContain(">xxx</li>");
  });

  it("emits li value from nested ordered Markdown numbers", () => {
    const html = markdownToExportHtml("1. one\n  2. two\n  3. three\n4. four");
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="4"');
    expect(html).toMatch(/value="3"[^>]*>three/);
  });
});
