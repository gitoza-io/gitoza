import { describe, expect, it } from "vitest";
import { unescapeTipTapMarkdown } from "./unescapeTipTapMarkdown";

describe("unescapeTipTapMarkdown", () => {
  it("returns empty for nullish or empty input", () => {
    expect(unescapeTipTapMarkdown(null)).toBe("");
    expect(unescapeTipTapMarkdown(undefined)).toBe("");
    expect(unescapeTipTapMarkdown("")).toBe("");
  });

  it("restores underscores in snake_case and ids", () => {
    expect(unescapeTipTapMarkdown("Use snake\\_case and REQ\\_ID.")).toBe(
      "Use snake_case and REQ_ID.",
    );
  });

  it("restores literal asterisks, brackets, tildes, and backticks", () => {
    expect(unescapeTipTapMarkdown("Cost is 2 \\* 3 and \\[note\\] plus a \\~ b.")).toBe(
      "Cost is 2 * 3 and [note] plus a ~ b.",
    );
    expect(unescapeTipTapMarkdown("literal \\` tick")).toBe("literal ` tick");
  });

  it("decodes HTML entities in the same order as TipTap", () => {
    expect(unescapeTipTapMarkdown("AT&amp;T where x &lt; y &gt; z")).toBe(
      "AT&T where x < y > z",
    );
  });

  it("restores wiki links including labeled targets", () => {
    expect(unescapeTipTapMarkdown("See \\[\\[T-1\\]\\].")).toBe("See [[T-1]].");
    expect(
      unescapeTipTapMarkdown("See \\[\\[wiki:W-1\\|Label\\]\\] and \\[\\[T-2\\]\\]."),
    ).toBe("See [[wiki:W-1|Label]] and [[T-2]].");
  });

  it("leaves fenced code unchanged, including escaped underscores", () => {
    const src = "before snake\\_case\n```js\nfoo\\_bar\nconst x = 1\n```\nafter REQ\\_ID";
    expect(unescapeTipTapMarkdown(src)).toBe(
      "before snake_case\n```js\nfoo\\_bar\nconst x = 1\n```\nafter REQ_ID",
    );
  });

  it("leaves tilde-fenced code unchanged", () => {
    const src = "~~~\nfoo\\_bar\n~~~";
    expect(unescapeTipTapMarkdown(src)).toBe(src);
  });

  it("leaves inline code spans unchanged", () => {
    expect(unescapeTipTapMarkdown("use `foo\\_bar` and snake\\_case")).toBe(
      "use `foo\\_bar` and snake_case",
    );
    expect(unescapeTipTapMarkdown("see `` `foo\\_bar` `` outside\\_ok")).toBe(
      "see `` `foo\\_bar` `` outside_ok",
    );
  });
});
