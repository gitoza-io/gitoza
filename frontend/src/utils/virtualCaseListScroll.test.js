import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeScrollMargin,
  debounce,
  estimateVirtualListHeight,
  preserveScrollTop,
} from "./virtualCaseListScroll.js";

describe("computeScrollMargin", () => {
  it("returns 0 when list or scroll element is missing", () => {
    expect(computeScrollMargin(null, null)).toBe(0);
    expect(computeScrollMargin(undefined, undefined)).toBe(0);
  });

  it("computes offset from bounding rects and scrollTop", () => {
    const scrollEl = {
      getBoundingClientRect: () => ({ top: 100 }),
      scrollTop: 50,
    };
    const listEl = {
      getBoundingClientRect: () => ({ top: 250 }),
    };
    expect(computeScrollMargin(listEl, scrollEl)).toBe(200);
  });
});

describe("estimateVirtualListHeight", () => {
  it("returns caseCount times row estimate", () => {
    expect(estimateVirtualListHeight(142, 44)).toBe(142 * 44);
    expect(estimateVirtualListHeight(0, 44)).toBe(0);
  });
});

describe("preserveScrollTop", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      cb();
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores scrollTop after callback", () => {
    const scrollEl = { scrollTop: 420 };
    preserveScrollTop(scrollEl, () => {
      scrollEl.scrollTop = 0;
    });
    expect(scrollEl.scrollTop).toBe(420);
  });

  it("runs callback when scroll element is null", () => {
    let ran = false;
    preserveScrollTop(null, () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes fn after waitMs", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents pending invocation", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
  });
});
