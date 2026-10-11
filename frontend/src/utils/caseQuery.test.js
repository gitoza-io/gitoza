import { describe, expect, it } from "vitest";
import { chipsToCaseQueryParams } from "./caseQuery";

describe("chipsToCaseQueryParams", () => {
  it("maps assigned_to chip to API param", () => {
    expect(
      chipsToCaseQueryParams([
        { key: "tag", value: "smoke" },
        { key: "assigned_to", value: "Alice" },
      ]),
    ).toEqual({
      tag: "smoke",
      assigned_to: "Alice",
    });
  });

  it("passes __me__ sentinel through for server resolution", () => {
    expect(
      chipsToCaseQueryParams([{ key: "assigned_to", value: "__me__" }]),
    ).toEqual({ assigned_to: "__me__" });
  });

  it("maps automated chip to boolean API param", () => {
    expect(chipsToCaseQueryParams([{ key: "automated", value: "true" }])).toEqual({
      automated: true,
    });
    expect(chipsToCaseQueryParams([{ key: "automated", value: "false" }])).toEqual({
      automated: false,
    });
  });

  it("returns empty object for no chips", () => {
    expect(chipsToCaseQueryParams([])).toEqual({});
    expect(chipsToCaseQueryParams(null)).toEqual({});
  });

  it("maps param chips to param_filters JSON", () => {
    const result = chipsToCaseQueryParams([
      { key: "param", paramKey: "environment", value: "staging" },
      { key: "param", paramKey: "browser", value: "Chrome" },
    ]);
    expect(result.param_filters).toBe(
      JSON.stringify([
        { key: "environment", value: "staging" },
        { key: "browser", value: "Chrome" },
      ]),
    );
  });

  it("ignores malformed param chips", () => {
    expect(
      chipsToCaseQueryParams([
        { key: "param", value: "staging" },
        { key: "param", paramKey: "env", value: "" },
      ]),
    ).toEqual({});
  });

  it("maps param-field chips (custom field key as chip.key) to param_filters", () => {
    const result = chipsToCaseQueryParams([
      { key: "browser", value: "Chrome" },
      { key: "environment", value: "staging" },
    ]);
    expect(result.param_filters).toBe(
      JSON.stringify([
        { key: "browser", value: "Chrome" },
        { key: "environment", value: "staging" },
      ]),
    );
  });
});
