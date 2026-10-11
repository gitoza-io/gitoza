import { describe, expect, it } from "vitest";
import {
  classifyWikiLinkTarget,
  formatWikiPageLink,
  formatWikiTicketLink,
  mergeEntityLinkResults,
  parseWikiLinks,
  unescapeMarkdownWikiLinks,
} from "./ticketLinks.js";

describe("formatWikiTicketLink", () => {
  it("returns empty string for blank id", () => {
    expect(formatWikiTicketLink("")).toBe("");
    expect(formatWikiTicketLink("   ")).toBe("");
    expect(formatWikiTicketLink(null)).toBe("");
  });

  it("formats id-only when label missing or equals id", () => {
    expect(formatWikiTicketLink("T-1")).toBe("[[T-1]]");
    expect(formatWikiTicketLink("T-1", "")).toBe("[[T-1]]");
    expect(formatWikiTicketLink("T-1", "T-1")).toBe("[[T-1]]");
    expect(formatWikiTicketLink("  T-1  ", "  T-1  ")).toBe("[[T-1]]");
  });

  it("formats id with distinct label", () => {
    expect(formatWikiTicketLink("T-1", "Fix login")).toBe("[[T-1|Fix login]]");
    expect(formatWikiTicketLink(" T-2 ", "  Selected text  ")).toBe(
      "[[T-2|Selected text]]",
    );
  });
});

describe("formatWikiPageLink", () => {
  it("returns empty for blank id", () => {
    expect(formatWikiPageLink("")).toBe("");
    expect(formatWikiPageLink(null)).toBe("");
  });

  it("prefixes wiki: and formats label", () => {
    expect(formatWikiPageLink("W-ABC123")).toBe("[[wiki:W-ABC123]]");
    expect(formatWikiPageLink("W-ABC123", "Data model")).toBe(
      "[[wiki:W-ABC123|Data model]]",
    );
    expect(formatWikiPageLink("wiki:W-ABC123", "W-ABC123")).toBe(
      "[[wiki:W-ABC123]]",
    );
  });
});

describe("classifyWikiLinkTarget", () => {
  it("detects wiki: prefix case-insensitively", () => {
    expect(classifyWikiLinkTarget("wiki:W-1")).toEqual({
      kind: "wiki",
      id: "W-1",
    });
    expect(classifyWikiLinkTarget("Wiki:W-1")).toEqual({
      kind: "wiki",
      id: "W-1",
    });
  });

  it("treats bare ids as tickets", () => {
    expect(classifyWikiLinkTarget("T-1")).toEqual({ kind: "ticket", id: "T-1" });
  });
});

describe("parseWikiLinks", () => {
  it("parses ticket and wiki links with kind", () => {
    expect(
      parseWikiLinks("See [[T-1]] and [[wiki:W-ABC123|Title]] and [[T-2|X]]"),
    ).toEqual([
      { kind: "ticket", id: "T-1", label: "T-1" },
      { kind: "wiki", id: "W-ABC123", label: "Title" },
      { kind: "ticket", id: "T-2", label: "X" },
    ]);
  });
});

describe("unescapeMarkdownWikiLinks", () => {
  it("restores TipTap-escaped wiki links", () => {
    expect(unescapeMarkdownWikiLinks("\\[\\[T-1\\]\\]")).toBe("[[T-1]]");
    expect(unescapeMarkdownWikiLinks("\\[\\[wiki:W-1\\|Label\\]\\]")).toBe(
      "[[wiki:W-1|Label]]",
    );
  });
});

describe("mergeEntityLinkResults", () => {
  it("returns empty for empty inputs", () => {
    expect(mergeEntityLinkResults([], [])).toEqual([]);
    expect(mergeEntityLinkResults(null, undefined)).toEqual([]);
  });

  it("puts tickets before wiki pages and normalizes fields", () => {
    expect(
      mergeEntityLinkResults(
        [{ ticket_id: "T-2", title: "Second", file_path: "a.yaml" }],
        [{ page_id: "W-1", title: "Page", file_path: "w.yaml" }],
      ),
    ).toEqual([
      { kind: "ticket", id: "T-2", title: "Second", file_path: "a.yaml" },
      { kind: "wiki", id: "W-1", title: "Page", file_path: "w.yaml" },
    ]);
  });

  it("applies exclusions and limitPerKind", () => {
    const tickets = [
      { ticket_id: "T-1", title: "A" },
      { ticket_id: "T-2", title: "B" },
      { ticket_id: "T-3", title: "C" },
    ];
    const pages = [
      { page_id: "W-1", title: "P1" },
      { page_id: "W-2", title: "P2" },
      { page_id: "W-3", title: "P3" },
    ];
    const merged = mergeEntityLinkResults(tickets, pages, {
      excludeTicketId: "T-1",
      excludePageId: "W-2",
      limitPerKind: 1,
    });
    expect(merged).toEqual([
      { kind: "ticket", id: "T-2", title: "B", file_path: "" },
      { kind: "wiki", id: "W-1", title: "P1", file_path: "" },
    ]);
  });
});
