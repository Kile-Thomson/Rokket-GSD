// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  shouldDebounce,
  _testResetDebounce,
  SEND_DEBOUNCE_MS,
} from "../send-debounce";

describe("send debounce", () => {
  beforeEach(() => {
    _testResetDebounce();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first send", () => {
    expect(shouldDebounce()).toBe(false);
  });

  it("blocks a second send within SEND_DEBOUNCE_MS", () => {
    expect(shouldDebounce()).toBe(false); // first send accepted
    vi.advanceTimersByTime(100);
    expect(shouldDebounce()).toBe(true); // within 300ms — blocked
  });

  it("allows a second send after SEND_DEBOUNCE_MS has elapsed", () => {
    expect(shouldDebounce()).toBe(false); // first send
    vi.advanceTimersByTime(SEND_DEBOUNCE_MS);
    expect(shouldDebounce()).toBe(false); // 300ms later — allowed
  });

  it("resets correctly via _testResetDebounce", () => {
    expect(shouldDebounce()).toBe(false); // first send
    vi.advanceTimersByTime(50);
    expect(shouldDebounce()).toBe(true); // blocked
    _testResetDebounce();
    expect(shouldDebounce()).toBe(false); // reset — allowed again
  });

  it("exports SEND_DEBOUNCE_MS as 300", () => {
    expect(SEND_DEBOUNCE_MS).toBe(300);
  });
});
