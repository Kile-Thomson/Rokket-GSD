import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { throttleRAF, debounce } from "../perf-utils";

describe("throttleRAF", () => {
  let rafCallbacks: Array<() => void>;

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls fn once per animation frame even when invoked multiple times", () => {
    const fn = vi.fn();
    const throttled = throttleRAF(fn);

    throttled();
    throttled();
    throttled();

    expect(fn).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0]();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("allows a new call after the frame fires", () => {
    const fn = vi.fn();
    const throttled = throttleRAF(fn);

    throttled();
    rafCallbacks[0]();
    expect(fn).toHaveBeenCalledTimes(1);

    throttled();
    rafCallbacks[1]();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a second rAF while one is pending", () => {
    const fn = vi.fn();
    const throttled = throttleRAF(fn);

    throttled();
    throttled();
    expect(rafCallbacks).toHaveLength(1);
  });
});

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays execution by the specified ms", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("resets the timer on rapid calls", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(80);
    debounced();
    vi.advanceTimersByTime(80);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls fn only once after rapid burst", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 50);

    for (let i = 0; i < 10; i++) {
      debounced();
    }

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
