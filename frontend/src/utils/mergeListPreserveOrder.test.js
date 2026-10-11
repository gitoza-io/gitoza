import { describe, expect, it } from "vitest";
import { mergeListPreserveOrder } from "./mergeListPreserveOrder.js";

const byPath = (t) => t.file_path;

describe("mergeListPreserveOrder", () => {
  it("preserves prev order and updates fields from next", () => {
    const prev = [
      { file_path: "a.yml", title: "A" },
      { file_path: "b.yml", title: "B" },
    ];
    const next = [
      { file_path: "b.yml", title: "B2" },
      { file_path: "a.yml", title: "A2" },
    ];
    expect(mergeListPreserveOrder(prev, next, byPath)).toEqual([
      { file_path: "a.yml", title: "A2" },
      { file_path: "b.yml", title: "B2" },
    ]);
  });

  it("prepends newcomers and drops missing", () => {
    const prev = [
      { file_path: "a.yml", title: "A" },
      { file_path: "gone.yml", title: "Gone" },
    ];
    const next = [
      { file_path: "new.yml", title: "New" },
      { file_path: "a.yml", title: "A2" },
    ];
    expect(mergeListPreserveOrder(prev, next, byPath)).toEqual([
      { file_path: "new.yml", title: "New" },
      { file_path: "a.yml", title: "A2" },
    ]);
  });

  it("handles empty/null prev as all newcomers", () => {
    const next = [{ file_path: "a.yml", title: "A" }];
    expect(mergeListPreserveOrder(null, next, byPath)).toEqual(next);
    expect(mergeListPreserveOrder([], next, byPath)).toEqual(next);
  });
});
