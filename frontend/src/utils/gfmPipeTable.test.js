import { describe, expect, it } from "vitest";
import {
  escapeWikiLinkPipesForGfm,
  isTableSeparatorRow,
  parsePipeTableRow,
} from "./gfmPipeTable";

describe("parsePipeTableRow", () => {
  it("returns null when line is not a pipe row", () => {
    expect(parsePipeTableRow("plain")).toBeNull();
    expect(parsePipeTableRow("")).toBeNull();
  });

  it("splits normal cells", () => {
    expect(parsePipeTableRow("| A | B |")).toEqual(["A", "B"]);
  });

  it("keeps bare wiki links in one cell", () => {
    expect(parsePipeTableRow("| See [[T-1]] |")).toEqual(["See [[T-1]]"]);
  });

  it("does not split on | inside labeled wiki links", () => {
    expect(parsePipeTableRow("| See [[T-1|Fix login]] | next |")).toEqual([
      "See [[T-1|Fix login]]",
      "next",
    ]);
  });

  it("handles wiki: targets with labels", () => {
    expect(parsePipeTableRow("| [[wiki:W-1|Title]] |")).toEqual([
      "[[wiki:W-1|Title]]",
    ]);
  });

  it("allows two wiki links in one cell", () => {
    expect(
      parsePipeTableRow("| [[T-1|A]] and [[wiki:W-2|B]] | C |"),
    ).toEqual(["[[T-1|A]] and [[wiki:W-2|B]]", "C"]);
  });

  it("supports rows without trailing |", () => {
    expect(parsePipeTableRow("| [[T-1|X]] | Y")).toEqual(["[[T-1|X]]", "Y"]);
  });

  it("treats \\| as a literal pipe outside wiki links", () => {
    expect(parsePipeTableRow("| a\\|b | c |")).toEqual(["a|b", "c"]);
  });
});

describe("isTableSeparatorRow", () => {
  it("detects GFM separator rows", () => {
    expect(isTableSeparatorRow("|---|---|")).toBe(true);
    expect(isTableSeparatorRow("| :--- | ---: |")).toBe(true);
    expect(isTableSeparatorRow("| A | B |")).toBe(false);
  });
});

describe("escapeWikiLinkPipesForGfm", () => {
  it("escapes | inside wiki links", () => {
    expect(escapeWikiLinkPipesForGfm("| See [[T-1|X]] |")).toBe(
      "| See [[T-1\\|X]] |",
    );
  });

  it("does not double-escape already escaped pipes", () => {
    expect(escapeWikiLinkPipesForGfm("[[T-1\\|X]]")).toBe("[[T-1\\|X]]");
  });

  it("leaves fenced code unchanged", () => {
    const md = "```\n[[T-1|X]]\n```\n| [[T-2|Y]] |";
    expect(escapeWikiLinkPipesForGfm(md)).toBe(
      "```\n[[T-1|X]]\n```\n| [[T-2\\|Y]] |",
    );
  });

  it("returns empty for nullish", () => {
    expect(escapeWikiLinkPipesForGfm(null)).toBe("");
    expect(escapeWikiLinkPipesForGfm("")).toBe("");
  });
});
