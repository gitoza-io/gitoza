import { describe, expect, it } from "vitest";
import { shouldClearLifecycleFilterForRelease } from "./releaseLifecycleQuickFilter";

const demoReleaseId = "demo/1.0";
const demoProject = "demo";

describe("shouldClearLifecycleFilterForRelease", () => {
  it("returns false when no lifecycle filter is active", () => {
    expect(
      shouldClearLifecycleFilterForRelease({
        releaseId: demoReleaseId,
        projectName: demoProject,
        lifecycleStatus: null,
        releasesByProject: {},
      }),
    ).toBe(false);
  });

  it("returns false when release is visible in the filtered project list", () => {
    expect(
      shouldClearLifecycleFilterForRelease({
        releaseId: demoReleaseId,
        projectName: demoProject,
        lifecycleStatus: "open",
        releasesByProject: {
          [demoProject]: [{ release_id: demoReleaseId, status: "open" }],
        },
      }),
    ).toBe(false);
  });

  it("returns true when project list is loaded but release is absent under filter", () => {
    expect(
      shouldClearLifecycleFilterForRelease({
        releaseId: demoReleaseId,
        projectName: demoProject,
        lifecycleStatus: "open",
        releasesByProject: {
          [demoProject]: [{ release_id: "demo/other", status: "open" }],
        },
      }),
    ).toBe(true);
  });

  it("returns true when project is not loaded and catalog status differs from filter", () => {
    expect(
      shouldClearLifecycleFilterForRelease({
        releaseId: demoReleaseId,
        projectName: demoProject,
        lifecycleStatus: "open",
        releasesByProject: {},
        releaseRow: { status: "shipped" },
      }),
    ).toBe(true);
  });

  it("returns false when project is not loaded and catalog status matches filter", () => {
    expect(
      shouldClearLifecycleFilterForRelease({
        releaseId: demoReleaseId,
        projectName: demoProject,
        lifecycleStatus: "open",
        releasesByProject: {},
        releaseRow: { status: "open" },
      }),
    ).toBe(false);
  });

  it("returns true when project is not loaded and catalog row is missing", () => {
    expect(
      shouldClearLifecycleFilterForRelease({
        releaseId: demoReleaseId,
        projectName: demoProject,
        lifecycleStatus: "open",
        releasesByProject: {},
      }),
    ).toBe(true);
  });
});
