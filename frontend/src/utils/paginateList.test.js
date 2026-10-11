import { describe, expect, it } from "vitest";
import {
  buildPaginationSequence,
  paginateGroupedCaseListEntries,
  paginateList,
} from "./paginateList.js";

describe("paginateList", () => {
  const items = Array.from({ length: 120 }, (_, i) => i + 1);

  it("returns first page slice", () => {
    const result = paginateList(items, { page: 1, pageSize: 50 });
    expect(result.items).toHaveLength(50);
    expect(result.items[0]).toBe(1);
    expect(result.items[49]).toBe(50);
    expect(result.rangeLabel).toBe("1–50 of 120");
    expect(result.totalPages).toBe(3);
  });

  it("returns last partial page", () => {
    const result = paginateList(items, { page: 3, pageSize: 50 });
    expect(result.items).toHaveLength(20);
    expect(result.rangeLabel).toBe("101–120 of 120");
  });

  it("clamps page above totalPages", () => {
    const result = paginateList(items, { page: 99, pageSize: 50 });
    expect(result.page).toBe(3);
    expect(result.items).toHaveLength(20);
  });

  it("handles empty list", () => {
    const result = paginateList([], { page: 1, pageSize: 50 });
    expect(result.items).toEqual([]);
    expect(result.rangeLabel).toBe("0 of 0");
    expect(result.totalPages).toBe(1);
  });
});

describe("paginateGroupedCaseListEntries", () => {
  const entries = [
    { type: "case", item: { file_path: "a.yaml", case_id: "A" } },
    { type: "suiteHeader", directoryPath: "suite", label: "Suite", depth: 0 },
    ...Array.from({ length: 55 }, (_, i) => ({
      type: "case",
      item: { file_path: `suite/c-${i}.yaml`, case_id: `C-${i}` },
    })),
  ];

  it("paginates cases only and repeats suite header on later pages", () => {
    const page1 = paginateGroupedCaseListEntries(entries, { page: 1, pageSize: 50 });
    expect(page1.rangeLabel).toBe("1–50 of 56");
    expect(page1.entries[0].type).toBe("case");
    expect(page1.entries.some((e) => e.type === "suiteHeader" && e.label === "Suite")).toBe(true);

    const page2 = paginateGroupedCaseListEntries(entries, { page: 2, pageSize: 50 });
    expect(page2.rangeLabel).toBe("51–56 of 56");
    expect(page2.entries[0].type).toBe("suiteHeader");
    expect(page2.entries[0].label).toBe("Suite");
  });
});

describe("buildPaginationSequence", () => {
  it("returns all pages when total is small", () => {
    expect(buildPaginationSequence(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("inserts ellipsis for large totals", () => {
    const seq = buildPaginationSequence(10, 24);
    expect(seq[0]).toBe(1);
    expect(seq).toContain("ellipsis");
    expect(seq[seq.length - 1]).toBe(24);
  });
});
