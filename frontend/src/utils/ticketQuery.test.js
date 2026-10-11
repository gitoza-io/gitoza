import { describe, expect, it } from "vitest";
import { chipsToTicketQueryParams } from "./ticketQuery";

describe("chipsToTicketQueryParams", () => {
  it("maps status and type chips to API params", () => {
    expect(
      chipsToTicketQueryParams([
        { key: "status", value: "open" },
        { key: "type", value: "bug" },
      ]),
    ).toEqual({
      status: "open",
      ticket_type: "bug",
    });
  });

  it("returns empty object for no chips", () => {
    expect(chipsToTicketQueryParams([])).toEqual({});
    expect(chipsToTicketQueryParams(null)).toEqual({});
  });

  it("maps param chips to param_filters JSON", () => {
    const result = chipsToTicketQueryParams([
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
      chipsToTicketQueryParams([
        { key: "param", value: "staging" },
        { key: "param", paramKey: "  ", value: "x" },
      ]),
    ).toEqual({});
  });

  it("maps param-field chips (custom field key as chip.key) to param_filters", () => {
    const result = chipsToTicketQueryParams([
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

  it("maps free-text q chips to search", () => {
    expect(chipsToTicketQueryParams([{ key: "q", value: "login" }])).toEqual({
      search: "login",
    });
  });

  it("maps backlog release sentinel through to API", () => {
    expect(
      chipsToTicketQueryParams([
        { key: "status", value: "open" },
        { key: "release", value: "__none__" },
      ]),
    ).toEqual({
      status: "open",
      release: "__none__",
    });
  });
});
