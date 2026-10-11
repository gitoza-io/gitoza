import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAST_ACTIVE_VIEW_KEY,
  readLastActiveView,
  resolveInitialActiveView,
  writeLastActiveView,
} from "./workspacePrefs.js";

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe("workspacePrefs last active view", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to tickets when nothing is stored", () => {
    expect(readLastActiveView()).toBe(null);
    expect(resolveInitialActiveView()).toBe("tickets");
  });

  it("restores a stored allowlisted view", () => {
    localStorage.setItem(LAST_ACTIVE_VIEW_KEY, "wiki");
    expect(readLastActiveView()).toBe("wiki");
    expect(resolveInitialActiveView()).toBe("wiki");
  });

  it("ignores ephemeral and unknown stored values", () => {
    localStorage.setItem(LAST_ACTIVE_VIEW_KEY, "confirmChanges");
    expect(readLastActiveView()).toBe(null);
    expect(resolveInitialActiveView()).toBe("tickets");

    localStorage.setItem(LAST_ACTIVE_VIEW_KEY, "not-a-view");
    expect(readLastActiveView()).toBe(null);
    expect(resolveInitialActiveView()).toBe("tickets");
  });

  it("does not overwrite with ephemeral views", () => {
    writeLastActiveView("explorer");
    expect(localStorage.getItem(LAST_ACTIVE_VIEW_KEY)).toBe("explorer");

    writeLastActiveView("confirmChanges");
    writeLastActiveView("resolveConflicts");
    writeLastActiveView("exportCases");
    expect(localStorage.getItem(LAST_ACTIVE_VIEW_KEY)).toBe("explorer");
    expect(resolveInitialActiveView()).toBe("explorer");
  });
});
