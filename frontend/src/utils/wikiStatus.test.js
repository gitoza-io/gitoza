import { describe, expect, it } from "vitest";
import {
  WIKI_STATUS_OPTIONS,
  formatWikiStatusLabel,
  wikiStatusValueClassName,
} from "./wikiStatus";

describe("wikiStatus", () => {
  it("exports all wiki status options", () => {
    expect(WIKI_STATUS_OPTIONS.map((o) => o.value)).toEqual([
      "draft",
      "published",
      "outdated",
    ]);
  });

  it("formats status labels", () => {
    expect(formatWikiStatusLabel("published")).toBe("Published");
    expect(formatWikiStatusLabel("outdated")).toBe("Outdated");
    expect(formatWikiStatusLabel("draft")).toBe("Draft");
    expect(formatWikiStatusLabel(null)).toBe("Draft");
    expect(formatWikiStatusLabel("unknown")).toBe("Draft");
  });

  it("maps status to value class names", () => {
    expect(wikiStatusValueClassName("published")).toContain("emerald");
    expect(wikiStatusValueClassName("outdated")).toContain("amber");
    expect(wikiStatusValueClassName("draft")).toContain("slate");
  });
});
