import { describe, expect, it, vi } from "vitest";
import { commitInlineCaseCreate } from "./inlineCaseCommit.js";

const PATH = ".gitoza/test/cases/p/suite";

function makeCallbacks(overrides = {}) {
  return {
    clearCreating: vi.fn(),
    restoreCreating: vi.fn(),
    setError: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

describe("commitInlineCaseCreate", () => {
  it("returns undefined when no commit handler is provided", () => {
    const callbacks = makeCallbacks();
    expect(
      commitInlineCaseCreate({
        path: PATH,
        isProject: false,
        caseId: "TC-001",
        ...callbacks,
      }),
    ).toBeUndefined();
    expect(callbacks.clearCreating).not.toHaveBeenCalled();
  });

  it("clears creating state on cancel (null caseId)", () => {
    const callbacks = makeCallbacks();
    const onCommitInlineCase = vi.fn();

    commitInlineCaseCreate({
      path: PATH,
      isProject: false,
      caseId: null,
      onCommitInlineCase,
      ...callbacks,
    });

    expect(callbacks.clearError).toHaveBeenCalled();
    expect(callbacks.clearCreating).toHaveBeenCalled();
    expect(onCommitInlineCase).not.toHaveBeenCalled();
  });

  it("clears creating state immediately before the create promise resolves", async () => {
    let resolveCreate;
    const createPromise = new Promise((resolve) => {
      resolveCreate = resolve;
    });
    const onCommitInlineCase = vi.fn(() => createPromise);
    const callbacks = makeCallbacks();

    commitInlineCaseCreate({
      path: PATH,
      isProject: false,
      caseId: "TC-001",
      onCommitInlineCase,
      ...callbacks,
    });

    expect(callbacks.clearError).toHaveBeenCalled();
    expect(callbacks.clearCreating).toHaveBeenCalledTimes(1);
    expect(onCommitInlineCase).toHaveBeenCalledWith(PATH, false, "TC-001");
    expect(callbacks.restoreCreating).not.toHaveBeenCalled();

    resolveCreate();
    await createPromise;
    expect(callbacks.restoreCreating).not.toHaveBeenCalled();
  });

  it("restores creating state and sets error when create promise rejects", async () => {
    const createError = new Error("Duplicate case ID");
    const onCommitInlineCase = vi.fn(() => Promise.reject(createError));
    const callbacks = makeCallbacks();

    const result = commitInlineCaseCreate({
      path: PATH,
      isProject: false,
      caseId: "TC-001",
      onCommitInlineCase,
      ...callbacks,
    });

    expect(callbacks.clearCreating).toHaveBeenCalledTimes(1);
    await expect(result).rejects.toThrow("Duplicate case ID");
    expect(callbacks.restoreCreating).toHaveBeenCalledWith(PATH);
    expect(callbacks.setError).toHaveBeenCalledWith("Duplicate case ID");
  });

  it("uses a fallback error message when rejection has no message", async () => {
    const onCommitInlineCase = vi.fn(() => Promise.reject(new Error()));
    const callbacks = makeCallbacks();

    const result = commitInlineCaseCreate({
      path: PATH,
      isProject: true,
      caseId: "TC-002",
      onCommitInlineCase,
      ...callbacks,
    });

    await expect(result).rejects.toThrow();
    expect(callbacks.setError).toHaveBeenCalledWith("Invalid case ID");
  });
});
