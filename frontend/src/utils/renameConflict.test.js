import { describe, expect, it } from "vitest";

import {
  getRenameConflictDisplayName,
  isApiConflictError,
  isCaseInRenameSession,
  isRenameNameConflictError,
  RenameNameConflictError,
} from "./renameConflict.js";

describe("renameConflict", () => {
  it("detects ApiError conflict code", () => {
    expect(isApiConflictError({ code: "conflict", message: "exists" })).toBe(true);
    expect(isApiConflictError({ code: "bad_request", message: "nope" })).toBe(false);
  });

  it("builds case display name with yaml extension", () => {
    expect(
      getRenameConflictDisplayName({
        kind: "case",
        newName: "OAW-002",
        filePath: ".gitoza/test/cases/proj/suite/OAW-001.md",
      }),
    ).toBe("OAW-002.md");
  });

  it("builds folder display name from sanitized name", () => {
    expect(getRenameConflictDisplayName({ kind: "folder", newName: "SuiteA" })).toBe("SuiteA");
  });

  it("identifies RenameNameConflictError instances", () => {
    const err = new RenameNameConflictError("OAW-002.md");
    expect(isRenameNameConflictError(err)).toBe(true);
    expect(err.displayName).toBe("OAW-002.md");
  });

  it("matches rename session by source or target path", () => {
    const session = {
      sourcePath: "a/old.md",
      targetPath: "a/new.md",
    };
    expect(isCaseInRenameSession("a/old.md", session)).toBe(true);
    expect(isCaseInRenameSession("a/new.md", session)).toBe(true);
    expect(isCaseInRenameSession("a/other.md", session)).toBe(false);
  });
});
