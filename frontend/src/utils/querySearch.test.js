import { describe, expect, it } from "vitest";
import { TICKET_RELEASE_NONE } from "../constants/ticketRelease";
import { ticketSearchKeys } from "../constants/searchKeys";
import {
  collectTicketFilterOptions,
  itemMatchesSearchChips,
  parseQueryToken,
  suggestKeys,
  suggestValues,
  tabCompleteDraft,
  withParamSearchKeys,
} from "./querySearch";

const keys = withParamSearchKeys(ticketSearchKeys());

describe("parseQueryToken", () => {
  it("parses free text as q", () => {
    expect(parseQueryToken("login bug", keys)).toEqual({ key: "q", value: "login bug" });
  });

  it("parses key: value", () => {
    expect(parseQueryToken("status: open", keys)).toEqual({ key: "status", value: "open" });
  });

  it("rejects unknown keys", () => {
    expect(parseQueryToken("foo: bar", keys)).toEqual({ error: "Unknown key: foo" });
  });

  it("rejects missing value", () => {
    expect(parseQueryToken("status:", keys)).toEqual({ error: "Missing value for status" });
  });
});

describe("suggestKeys / suggestValues / tabCompleteDraft", () => {
  it("suggests status for stat prefix", () => {
    const s = suggestKeys("stat", keys);
    expect(s.some((x) => x.key === "status")).toBe(true);
  });

  it("suggests priority for pri prefix", () => {
    const s = suggestKeys("pri", keys);
    expect(s.some((x) => x.key === "priority")).toBe(true);
  });

  it("suggests status values", () => {
    const s = suggestValues("status: op", keys, {});
    expect(s.some((x) => x.value === "open")).toBe(true);
  });

  it("suggests priority values from static options or filterOptions", () => {
    const withStatic = withParamSearchKeys([
      {
        key: "priority",
        label: "Priority",
        type: "enum",
        filterKey: "priorities",
        options: [
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ],
      },
    ]);
    const s = suggestValues("priority: h", withStatic, {});
    expect(s.map((x) => x.value)).toEqual(["high"]);
  });

  it("Tab completes key prefix", () => {
    expect(tabCompleteDraft("stat", keys)).toBe("status: ");
  });
});

describe("withParamSearchKeys", () => {
  it("appends catalog keys as param-field and skips reserved", () => {
    const next = withParamSearchKeys(ticketSearchKeys(), {
      param_keys: ["browser", "status", "environment"],
    });
    expect(next.some((k) => k.key === "browser" && k.type === "param-field")).toBe(true);
    expect(next.some((k) => k.key === "environment" && k.type === "param-field")).toBe(true);
    expect(next.filter((k) => k.key === "status")).toHaveLength(1);
    expect(next.some((k) => k.label === "Custom field" || k.key === "param")).toBe(false);
  });

  it("strips synthetic param composer key", () => {
    const next = withParamSearchKeys(ticketSearchKeys(), {});
    expect(next.some((k) => k.key === "param" || k.type === "param")).toBe(false);
  });

  it("suggests param key and values from catalog", () => {
    const searchKeys = withParamSearchKeys(keys, {
      param_keys: ["browser"],
      param_values_by_key: { browser: ["chrome", "firefox"] },
    });
    expect(suggestKeys("bro", searchKeys).some((x) => x.key === "browser")).toBe(true);
    const values = suggestValues("browser: ch", searchKeys, {
      param_keys: ["browser"],
      param_values_by_key: { browser: ["chrome", "firefox"] },
    });
    expect(values.map((v) => v.value)).toEqual(["chrome"]);
  });
});

describe("itemMatchesSearchChips", () => {
  const ticket = {
    ticket_id: "GITO-1",
    title: "Fix login",
    type: "bug",
    status: "open",
    priority: "high",
    tags: ["smoke"],
    assigned_to: "Ada",
    release: "Gitoza-lite/0-3-1",
    params: { browser: "Chrome" },
  };

  it("ANDs chips", () => {
    expect(
      itemMatchesSearchChips(ticket, [
        { key: "status", value: "open" },
        { key: "tag", value: "smoke" },
      ]),
    ).toBe(true);
    expect(
      itemMatchesSearchChips(ticket, [
        { key: "status", value: "open" },
        { key: "tag", value: "other" },
      ]),
    ).toBe(false);
  });

  it("matches free text q", () => {
    expect(
      itemMatchesSearchChips(ticket, [{ key: "q", value: "login" }], {
        queryFields: ["ticket_id", "title"],
      }),
    ).toBe(true);
  });

  it("matches no release sentinel", () => {
    expect(
      itemMatchesSearchChips(
        { ...ticket, release: "" },
        [{ key: "release", value: TICKET_RELEASE_NONE }],
      ),
    ).toBe(true);
  });

  it("matches custom field params", () => {
    expect(
      itemMatchesSearchChips(
        ticket,
        [{ key: "browser", value: "chrome" }],
        { paramKeys: ["browser"], searchKeys: [{ key: "browser", type: "param-field" }] },
      ),
    ).toBe(true);
    expect(
      itemMatchesSearchChips(
        ticket,
        [{ key: "browser", value: "firefox" }],
        { paramKeys: ["browser"], searchKeys: [{ key: "browser", type: "param-field" }] },
      ),
    ).toBe(false);
  });
});

describe("collectTicketFilterOptions", () => {
  it("collects unique tags and assignees", () => {
    const opts = collectTicketFilterOptions([
      { tags: ["a", "b"], assigned_to: "Ada", release: "r1", priority: "high" },
      { tags: ["a"], assigned_to: "Bob", release: "r1", priority: "low" },
    ]);
    expect(opts.tags).toEqual(["a", "b"]);
    expect(opts.assigned_to).toEqual(["Ada", "Bob"]);
    expect(opts.releases).toEqual(["r1"]);
  });

  it("collects custom field params", () => {
    const opts = collectTicketFilterOptions([
      { tags: [], params: { browser: "chrome", env: "staging" } },
      { tags: [], params: { browser: "firefox", env: "staging" } },
    ]);
    expect(opts.param_keys).toEqual(["browser", "env"]);
    expect(opts.param_values_by_key.browser).toEqual(["chrome", "firefox"]);
    expect(opts.param_values_by_key.env).toEqual(["staging"]);
  });
});
