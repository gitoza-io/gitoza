import { describe, it, expect, vi } from "vitest";
import {
  hydrateSearchRunCaseSelection,
  resolveRunIdForCaseSelection,
} from "./hydrateSearchRunCaseSelection";

describe("resolveRunIdForCaseSelection", () => {
  it("returns browse run id when search is inactive", () => {
    expect(
      resolveRunIdForCaseSelection({
        searchActive: false,
        caseRow: { run_id: "run-b", file_path: "a.yaml" },
        searchSelectedRunId: "run-search",
        browseSelectedRunId: "run-a",
      }),
    ).toBe("run-a");
  });

  it("prefers case run_id in search mode", () => {
    expect(
      resolveRunIdForCaseSelection({
        searchActive: true,
        caseRow: { run_id: "run-b", file_path: "a.yaml" },
        searchSelectedRunId: "run-search",
        browseSelectedRunId: "run-a",
      }),
    ).toBe("run-b");
  });

  it("falls back to search folder run id when case has no run_id", () => {
    expect(
      resolveRunIdForCaseSelection({
        searchActive: true,
        caseRow: { file_path: "a.yaml" },
        searchSelectedRunId: "run-search",
        browseSelectedRunId: "run-a",
      }),
    ).toBe("run-search");
  });
});

describe("hydrateSearchRunCaseSelection", () => {
  const searchCases = [
    {
      run_id: "run-a",
      file_path: ".gitoza/test/cases/auth/login/a.yaml",
      case_id: "TC-1",
      title: "Login",
      result: "failed",
    },
  ];

  it("loads header and merges matching search row into cache", async () => {
    const ensureRunHeaderLoaded = vi.fn().mockResolvedValue(undefined);
    const setRunDetailsByRunId = vi.fn((updater) => {
      const prev = {
        "run-a": { run: { run_id: "run-a" }, cases: [] },
      };
      updater(prev);
    });

    await hydrateSearchRunCaseSelection({
      runId: "run-a",
      filePath: ".gitoza/test/cases/auth/login/a.yaml",
      searchCases,
      ensureRunHeaderLoaded,
      setRunDetailsByRunId,
    });

    expect(ensureRunHeaderLoaded).toHaveBeenCalledWith("run-a");
    expect(setRunDetailsByRunId).toHaveBeenCalledTimes(1);
    const updater = setRunDetailsByRunId.mock.calls[0][0];
    const next = updater({
      "run-a": { run: { run_id: "run-a" }, cases: [] },
    });
    expect(next["run-a"].cases).toHaveLength(1);
    expect(next["run-a"].cases[0]).toMatchObject({
      file_path: ".gitoza/test/cases/auth/login/a.yaml",
      case_id: "TC-1",
      title: "Login",
      result: "failed",
    });
  });

  it("no-ops when search row is missing", async () => {
    const ensureRunHeaderLoaded = vi.fn().mockResolvedValue(undefined);
    const setRunDetailsByRunId = vi.fn();

    await hydrateSearchRunCaseSelection({
      runId: "run-a",
      filePath: "missing.yaml",
      searchCases,
      ensureRunHeaderLoaded,
      setRunDetailsByRunId,
    });

    expect(ensureRunHeaderLoaded).toHaveBeenCalledWith("run-a");
    expect(setRunDetailsByRunId).not.toHaveBeenCalled();
  });
});
