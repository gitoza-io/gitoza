import { describe, expect, it } from "vitest";
import { CASE_SEARCH_KEYS } from "../constants/searchKeys";
import {
  chipsToFormState,
  emptyFilterForm,
  formStateToChips,
  hasActiveFilterCriteria,
} from "./filterForm";

describe("emptyFilterForm", () => {
  it("initializes singles as empty string and tags as array", () => {
    const state = emptyFilterForm(CASE_SEARCH_KEYS, { freeTextSearchKey: "q" });
    expect(state.q).toBe("");
    expect(state.tag).toEqual([]);
    expect(state.priority).toBe("");
    expect(state.param).toEqual([]);
  });
});

describe("formStateToChips", () => {
  it("skips empty values", () => {
    const state = emptyFilterForm(CASE_SEARCH_KEYS);
    expect(formStateToChips(state, CASE_SEARCH_KEYS)).toEqual([]);
  });

  it("emits one chip per tag and param row", () => {
    const chips = formStateToChips(
      {
        tag: ["smoke", "regression"],
        priority: "high",
        param: [{ paramKey: "browser", value: "Chrome" }],
      },
      CASE_SEARCH_KEYS,
    );
    expect(chips).toEqual([
      { key: "tag", value: "smoke" },
      { key: "tag", value: "regression" },
      { key: "priority", value: "high" },
      { key: "param", paramKey: "browser", value: "Chrome" },
    ]);
  });

  it("includes free-text q when set", () => {
    const chips = formStateToChips(
      { q: "login" },
      CASE_SEARCH_KEYS,
      { freeTextSearchKey: "q" },
    );
    expect(chips).toEqual([{ key: "q", value: "login" }]);
  });
});

describe("chipsToFormState", () => {
  it("round-trips with formStateToChips", () => {
    const chips = [
      { key: "tag", value: "smoke" },
      { key: "priority", value: "high" },
      { key: "updated_by", value: "Alice" },
      { key: "param", paramKey: "env", value: "Prod" },
      { key: "q", value: "login" },
    ];
    const state = chipsToFormState(chips, CASE_SEARCH_KEYS, { freeTextSearchKey: "q" });
    const roundTrip = formStateToChips(state, CASE_SEARCH_KEYS, { freeTextSearchKey: "q" });
    expect(roundTrip).toHaveLength(chips.length);
    for (const chip of chips) {
      expect(roundTrip).toContainEqual(chip);
    }
  });
});

describe("hasActiveFilterCriteria", () => {
  it("returns false for empty form", () => {
    expect(
      hasActiveFilterCriteria(emptyFilterForm(CASE_SEARCH_KEYS), CASE_SEARCH_KEYS),
    ).toBe(false);
  });

  it("returns true when any field is set", () => {
    expect(
      hasActiveFilterCriteria({ priority: "low" }, CASE_SEARCH_KEYS),
    ).toBe(true);
  });

  it("returns true for confirmed custom field rows", () => {
    expect(
      hasActiveFilterCriteria(
        { param: [{ paramKey: "env", value: "iOS" }] },
        CASE_SEARCH_KEYS,
      ),
    ).toBe(true);
  });
});
