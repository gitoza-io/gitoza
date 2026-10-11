import { describe, expect, it } from "vitest";
import { formatAutomationSyncFeedback } from "./formatAutomationSyncFeedback.js";

describe("formatAutomationSyncFeedback", () => {
  it("returns neutral message when remote is empty", () => {
    expect(formatAutomationSyncFeedback({ updated: 0, discovered: 0, removed: 0 })).toEqual({
      tone: "neutral",
      text: "No results on remote yet",
    });
  });

  it("returns success when runs were indexed", () => {
    expect(formatAutomationSyncFeedback({ updated: 2, discovered: 5, removed: 0 })).toEqual({
      tone: "success",
      text: "Synced · 2 runs indexed",
    });
  });

  it("returns up to date when nothing new to index", () => {
    expect(formatAutomationSyncFeedback({ updated: 0, discovered: 3, removed: 0 })).toEqual({
      tone: "success",
      text: "Up to date · 3 on remote",
    });
  });

  it("appends removed count when relevant", () => {
    expect(formatAutomationSyncFeedback({ updated: 1, discovered: 4, removed: 2 })).toEqual({
      tone: "success",
      text: "Synced · 1 run indexed · 2 removed",
    });
  });
});
