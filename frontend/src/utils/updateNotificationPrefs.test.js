import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDismissedUpdateNotice,
  dismissUpdateNotice,
  isUpdateNoticeDismissed,
} from "./updateNotificationPrefs.js";

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

describe("updateNotificationPrefs", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageMock());
  });

  afterEach(() => {
    clearDismissedUpdateNotice();
    vi.unstubAllGlobals();
  });

  it("returns false when nothing is dismissed", () => {
    expect(isUpdateNoticeDismissed("1.2.0")).toBe(false);
  });

  it("returns true only for the dismissed version", () => {
    dismissUpdateNotice("1.2.0");
    expect(isUpdateNoticeDismissed("1.2.0")).toBe(true);
    expect(isUpdateNoticeDismissed("1.3.0")).toBe(false);
  });

  it("replaces dismiss when a new version is dismissed", () => {
    dismissUpdateNotice("1.2.0");
    dismissUpdateNotice("1.3.0");
    expect(isUpdateNoticeDismissed("1.2.0")).toBe(false);
    expect(isUpdateNoticeDismissed("1.3.0")).toBe(true);
  });

  it("clearDismissedUpdateNotice resets state", () => {
    dismissUpdateNotice("1.2.0");
    clearDismissedUpdateNotice();
    expect(isUpdateNoticeDismissed("1.2.0")).toBe(false);
  });
});
