import { describe, expect, it } from "vitest";
import {
  decideLinkedIdCommit,
  findExactSuggestionId,
  idsEqual,
} from "./entityLinkCommit.js";

describe("idsEqual", () => {
  it("compares trimmed case-insensitive ids", () => {
    expect(idsEqual("DEMO-1", "demo-1")).toBe(true);
    expect(idsEqual("  A  ", "a")).toBe(true);
    expect(idsEqual("A", "B")).toBe(false);
    expect(idsEqual("", "")).toBe(true);
  });
});

describe("findExactSuggestionId", () => {
  const rows = [{ ticket_id: "DEMO-1" }, { ticket_id: "DEMO-2" }];

  it("returns canonical id for a case-insensitive match", () => {
    expect(findExactSuggestionId("demo-1", rows, (r) => r.ticket_id)).toBe("DEMO-1");
  });

  it("returns null when query is not an exact id", () => {
    expect(findExactSuggestionId("demo", rows, (r) => r.ticket_id)).toBe(null);
    expect(findExactSuggestionId("", rows, (r) => r.ticket_id)).toBe(null);
  });
});

describe("decideLinkedIdCommit", () => {
  it("clears an empty query", () => {
    expect(decideLinkedIdCommit({ query: "  ", committedValue: "DEMO-1" })).toEqual({
      action: "clear",
    });
  });

  it("keeps an unchanged committed value even when unresolved", () => {
    expect(
      decideLinkedIdCommit({
        query: "DEAD-1",
        committedValue: "dead-1",
        resolvedId: null,
      }),
    ).toEqual({ action: "keep" });
  });

  it("commits the exact suggestion id over resolved casing", () => {
    expect(
      decideLinkedIdCommit({
        query: "demo-1",
        committedValue: "",
        exactSuggestionId: "DEMO-1",
        resolvedId: "demo-1",
      }),
    ).toEqual({ action: "commit", id: "DEMO-1" });
  });

  it("commits a resolved id when there is no suggestion match", () => {
    expect(
      decideLinkedIdCommit({
        query: "demo-1",
        committedValue: "",
        resolvedId: "DEMO-1",
      }),
    ).toEqual({ action: "commit", id: "DEMO-1" });
  });

  it("reverts an unknown id", () => {
    expect(
      decideLinkedIdCommit({
        query: "NOPE",
        committedValue: "DEMO-1",
        resolvedId: null,
      }),
    ).toEqual({ action: "revert" });
  });

  it("reverts when the candidate is the excluded id", () => {
    expect(
      decideLinkedIdCommit({
        query: "SELF-1",
        committedValue: "",
        resolvedId: "SELF-1",
        excludeId: "self-1",
      }),
    ).toEqual({ action: "revert" });
  });
});
