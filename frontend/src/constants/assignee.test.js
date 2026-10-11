import { describe, expect, it } from "vitest";
import {
  assigneeMatchKey,
  canonicalAssignee,
  filterAssigneeSuggestionsByQuery,
  storedFromDisplay,
} from "./assignee";

describe("assigneeMatchKey", () => {
  it("lowercases Latin names and trims", () => {
    expect(assigneeMatchKey("  Alice  ")).toBe("alice");
  });

  it("leaves CJK unchanged", () => {
    expect(assigneeMatchKey("张三")).toBe("张三");
  });
});

describe("canonicalAssignee", () => {
  it("returns first known match case-insensitively", () => {
    const known = ["Alice", "alice"];
    expect(canonicalAssignee("alice", known)).toBe("Alice");
    expect(canonicalAssignee("ALICE", known)).toBe("Alice");
  });

  it("passes through unknown names", () => {
    expect(canonicalAssignee("Bob", ["Alice"])).toBe("Bob");
    expect(canonicalAssignee("张三", ["Alice"])).toBe("张三");
  });
});

describe("filterAssigneeSuggestionsByQuery", () => {
  const suggestions = ["Alice", "Bob", "Charlie"];

  it("returns all suggestions when query is empty", () => {
    expect(filterAssigneeSuggestionsByQuery(suggestions, "")).toEqual(suggestions);
    expect(filterAssigneeSuggestionsByQuery(suggestions, "  ")).toEqual(suggestions);
  });

  it("filters suggestions case-insensitively", () => {
    expect(filterAssigneeSuggestionsByQuery(suggestions, "al")).toEqual(["Alice"]);
    expect(filterAssigneeSuggestionsByQuery(suggestions, "BO")).toEqual(["Bob"]);
  });
});

describe("storedFromDisplay", () => {
  it("inherits when case-insensitively equal to run assignee", () => {
    expect(storedFromDisplay("alice", "Alice")).toBeNull();
    expect(storedFromDisplay("Alice", "alice")).toBeNull();
  });

  it("keeps explicit override when names differ", () => {
    expect(storedFromDisplay("Bob", "Alice")).toBe("Bob");
  });
});
