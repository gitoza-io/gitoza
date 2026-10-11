import { describe, expect, it } from "vitest";
import { shouldWarnOnAppClose } from "./appCloseGuard";

describe("shouldWarnOnAppClose", () => {
  it("warns when workplace is editing on a remote workspace", () => {
    expect(
      shouldWarnOnAppClose({
        workplaceMode: "editing",
        pushFailed: false,
        workspaceKind: "remote_git",
      }),
    ).toBe(true);
  });

  it("warns when push failed even if mode looks baseline", () => {
    expect(
      shouldWarnOnAppClose({
        workplaceMode: "baseline",
        pushFailed: true,
        workspaceKind: "remote_git",
      }),
    ).toBe(true);
  });

  it("does not warn for clean baseline remote workspace", () => {
    expect(
      shouldWarnOnAppClose({
        workplaceMode: "baseline",
        pushFailed: false,
        workspaceKind: "remote_git",
      }),
    ).toBe(false);
  });

  it("does not warn for playground even when editing", () => {
    expect(
      shouldWarnOnAppClose({
        workplaceMode: "editing",
        pushFailed: true,
        workspaceKind: "playground",
      }),
    ).toBe(false);
  });

  it("defaults missing workspaceKind to remote (warn on editing)", () => {
    expect(shouldWarnOnAppClose({ workplaceMode: "editing" })).toBe(true);
    expect(shouldWarnOnAppClose({ workplaceMode: "baseline" })).toBe(false);
  });
});
