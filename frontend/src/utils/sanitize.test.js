import { describe, expect, it } from "vitest";
import { sanitizeNameForPath, ticketProjectDisplayName } from "./sanitize";

describe("sanitizeNameForPath", () => {
  it("replaces spaces and hyphens with underscores", () => {
    expect(sanitizeNameForPath("project name")).toBe("project_name");
    expect(sanitizeNameForPath("my-project")).toBe("my_project");
  });
});

describe("ticketProjectDisplayName", () => {
  it("shows underscores and hyphens as spaces", () => {
    expect(ticketProjectDisplayName("project_name")).toBe("project name");
    expect(ticketProjectDisplayName("my-project")).toBe("my project");
  });

  it("returns empty for non-strings", () => {
    expect(ticketProjectDisplayName(null)).toBe("");
    expect(ticketProjectDisplayName(undefined)).toBe("");
  });
});
