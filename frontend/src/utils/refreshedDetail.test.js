import { describe, expect, it } from "vitest";
import { shouldApplyRefreshedDetail } from "./refreshedDetail.js";

describe("shouldApplyRefreshedDetail", () => {
  it("clears selection when the open file is gone", () => {
    expect(shouldApplyRefreshedDetail({ stillThere: false, isEditing: false })).toBe("clear");
    expect(shouldApplyRefreshedDetail({ stillThere: false, isEditing: true })).toBe("clear");
  });

  it("applies a silent refetch in read mode when the file still exists", () => {
    expect(shouldApplyRefreshedDetail({ stillThere: true, isEditing: false })).toBe("apply");
  });

  it("skips refetch while editing so an unflushed draft is kept", () => {
    expect(shouldApplyRefreshedDetail({ stillThere: true, isEditing: true })).toBe("skip");
  });
});
