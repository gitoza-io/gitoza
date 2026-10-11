import { describe, it, expect } from "vitest";
import { mergeRunPageCasesWithCache } from "./mergeRunPageCasesWithCache";

describe("mergeRunPageCasesWithCache", () => {
  const pageItem = {
    file_path: ".gitoza/test/cases/a/c1.yaml",
    case_id: "C1",
    title: "Case One",
    result: "pending",
  };

  it("overlays result and execution meta from cache", () => {
    const cached = [
      {
        file_path: pageItem.file_path,
        result: "passed",
        executed_at: "2026-06-09T12:00:00Z",
        executed_by: "Alice",
      },
    ];

    const { items, removedOnPage } = mergeRunPageCasesWithCache([pageItem], cached);

    expect(removedOnPage).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Case One");
    expect(items[0].result).toBe("passed");
    expect(items[0].executed_at).toBe("2026-06-09T12:00:00Z");
    expect(items[0].executed_by).toBe("Alice");
  });

  it("filters page rows removed from cache", () => {
    const other = {
      file_path: ".gitoza/test/cases/a/c2.yaml",
      case_id: "C2",
      title: "Case Two",
      result: "pending",
    };

    const { items, removedOnPage } = mergeRunPageCasesWithCache(
      [pageItem, other],
      [pageItem],
    );

    expect(removedOnPage).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].file_path).toBe(pageItem.file_path);
  });

  it("does not filter or overlay when cachedCases is undefined", () => {
    const { items, removedOnPage } = mergeRunPageCasesWithCache([pageItem], undefined);

    expect(removedOnPage).toBe(0);
    expect(items).toEqual([pageItem]);
  });

  it("returns empty items for empty page input", () => {
    const { items, removedOnPage } = mergeRunPageCasesWithCache([], [pageItem]);

    expect(removedOnPage).toBe(0);
    expect(items).toEqual([]);
  });
});
