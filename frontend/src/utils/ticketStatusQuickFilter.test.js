import { describe, expect, it } from "vitest";
import {
  applyOrToggleBacklogChip,
  applyOrToggleStatusChip,
  getActiveBacklogFromChips,
  getActiveStatusFromChips,
  TICKET_PROJECT_STATUS_QUICK_FILTERS,
} from "./ticketStatusQuickFilter";
import { TICKET_RELEASE_NONE } from "../constants/ticketRelease";

describe("getActiveStatusFromChips", () => {
  it("returns null for missing or empty chips", () => {
    expect(getActiveStatusFromChips(null)).toBeNull();
    expect(getActiveStatusFromChips(undefined)).toBeNull();
    expect(getActiveStatusFromChips([])).toBeNull();
    expect(getActiveStatusFromChips([{ key: "q", value: "foo" }])).toBeNull();
  });

  it("returns trimmed status chip value", () => {
    expect(
      getActiveStatusFromChips([
        { key: "q", value: "foo" },
        { key: "status", value: "  open  " },
      ]),
    ).toBe("open");
  });
});

describe("applyOrToggleStatusChip", () => {
  it("sets status chip when none is active", () => {
    expect(applyOrToggleStatusChip([], "open")).toEqual([
      { key: "status", value: "open" },
    ]);
  });

  it("replaces status and preserves other chips", () => {
    const chips = [
      { key: "q", value: "login" },
      { key: "status", value: "open" },
      { key: "priority", value: "high" },
    ];
    expect(applyOrToggleStatusChip(chips, "done")).toEqual([
      { key: "q", value: "login" },
      { key: "priority", value: "high" },
      { key: "status", value: "done" },
    ]);
  });

  it("toggles off the same status and keeps other chips", () => {
    const chips = [
      { key: "q", value: "login" },
      { key: "status", value: "blocked" },
    ];
    expect(applyOrToggleStatusChip(chips, "blocked")).toEqual([
      { key: "q", value: "login" },
    ]);
  });

  it("clears status when statusValue is empty", () => {
    const chips = [
      { key: "status", value: "open" },
      { key: "q", value: "x" },
    ];
    expect(applyOrToggleStatusChip(chips, "")).toEqual([{ key: "q", value: "x" }]);
    expect(applyOrToggleStatusChip(chips, null)).toEqual([{ key: "q", value: "x" }]);
  });
});

describe("TICKET_PROJECT_STATUS_QUICK_FILTERS", () => {
  it("includes only open and blocked", () => {
    expect(TICKET_PROJECT_STATUS_QUICK_FILTERS.map((f) => f.value)).toEqual([
      "open",
      "blocked",
    ]);
  });
});

describe("getActiveBacklogFromChips / applyOrToggleBacklogChip", () => {
  it("detects backlog chip", () => {
    expect(getActiveBacklogFromChips([])).toBe(false);
    expect(
      getActiveBacklogFromChips([{ key: "release", value: TICKET_RELEASE_NONE }]),
    ).toBe(true);
    expect(
      getActiveBacklogFromChips([{ key: "release", value: "demo/1.0" }]),
    ).toBe(false);
  });

  it("toggles backlog on and preserves status", () => {
    expect(
      applyOrToggleBacklogChip([{ key: "status", value: "open" }]),
    ).toEqual([
      { key: "status", value: "open" },
      { key: "release", value: TICKET_RELEASE_NONE },
    ]);
  });

  it("toggles backlog off", () => {
    expect(
      applyOrToggleBacklogChip([
        { key: "status", value: "blocked" },
        { key: "release", value: TICKET_RELEASE_NONE },
      ]),
    ).toEqual([{ key: "status", value: "blocked" }]);
  });

  it("replaces a specific release chip with backlog", () => {
    expect(
      applyOrToggleBacklogChip([{ key: "release", value: "demo/1.0" }]),
    ).toEqual([{ key: "release", value: TICKET_RELEASE_NONE }]);
  });
});
