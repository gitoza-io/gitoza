import { describe, expect, it, vi, beforeEach } from "vitest";
import { chipsToRunCaseQueryParams, fetchAllRunCasesForFolder } from "./runCaseQuery";

vi.mock("../services/api", () => ({
  searchRunCases: vi.fn(),
  listRunCases: vi.fn(),
}));

import { listRunCases } from "../services/api";

describe("chipsToRunCaseQueryParams", () => {
  it("maps execution-focused chips to API params", () => {
    expect(
      chipsToRunCaseQueryParams([
        { key: "q", value: "smoke" },
        { key: "result", value: "Failed" },
        { key: "tag", value: "regression" },
        { key: "priority", value: "High" },
        { key: "requirement_id", value: "REQ-42" },
        { key: "executed_by", value: "alice" },
        { key: "assigned_to", value: "bob" },
      ]),
    ).toEqual({
      search: "smoke",
      result: "failed",
      tag: "regression",
      priority: "High",
      requirement_id: "REQ-42",
      executed_by: "alice",
      assigned_to: "bob",
    });
  });

  it("passes __me__ sentinel through for server resolution", () => {
    expect(
      chipsToRunCaseQueryParams([{ key: "assigned_to", value: "__me__" }]),
    ).toEqual({ assigned_to: "__me__" });
  });

  it("returns empty object for no chips", () => {
    expect(chipsToRunCaseQueryParams([])).toEqual({});
    expect(chipsToRunCaseQueryParams(null)).toEqual({});
  });
});

describe("fetchAllRunCasesForFolder", () => {
  beforeEach(() => {
    vi.mocked(listRunCases).mockReset();
  });

  it("paginates until all folder cases are loaded", async () => {
    vi.mocked(listRunCases)
      .mockResolvedValueOnce({
        items: [{ file_path: "a.yaml" }, { file_path: "b.yaml" }],
        total: 3,
      })
      .mockResolvedValueOnce({
        items: [{ file_path: "c.yaml" }],
        total: 3,
      });

    const result = await fetchAllRunCasesForFolder(
      "run-1",
      "repo-1",
      ".gitoza/test/cases/auth/login",
      2,
    );

    expect(result).toHaveLength(3);
    expect(listRunCases).toHaveBeenCalledTimes(2);
    expect(listRunCases).toHaveBeenNthCalledWith(1, "run-1", "repo-1", {
      folder_prefix: ".gitoza/test/cases/auth/login",
      limit: 2,
      offset: 0,
    });
    expect(listRunCases).toHaveBeenNthCalledWith(2, "run-1", "repo-1", {
      folder_prefix: ".gitoza/test/cases/auth/login",
      limit: 2,
      offset: 2,
    });
  });
});
