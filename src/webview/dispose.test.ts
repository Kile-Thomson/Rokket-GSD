// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  registerInterval,
  registerTimeout,
  registerCleanup,
  disposeAll,
} from "./dispose";

afterEach(() => {
  disposeAll();
  vi.restoreAllMocks();
});

describe("dispose registry", () => {
  it("registerInterval + disposeAll clears the interval", () => {
    const spy = vi.spyOn(globalThis, "clearInterval");
    const handle = setInterval(() => {}, 1000);
    registerInterval("tick", handle);
    disposeAll();
    expect(spy).toHaveBeenCalledWith(handle);
  });

  it("registerTimeout + disposeAll clears the timeout", () => {
    const spy = vi.spyOn(globalThis, "clearTimeout");
    const handle = setTimeout(() => {}, 1000);
    registerTimeout("delay", handle);
    disposeAll();
    expect(spy).toHaveBeenCalledWith(handle);
  });

  it("registerCleanup + disposeAll calls the cleanup function", () => {
    const fn = vi.fn();
    registerCleanup("obs", fn);
    disposeAll();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("re-registering the same interval ID clears the old handle", () => {
    const spy = vi.spyOn(globalThis, "clearInterval");
    const h1 = setInterval(() => {}, 1000);
    const h2 = setInterval(() => {}, 1000);
    registerInterval("tick", h1);
    registerInterval("tick", h2);
    expect(spy).toHaveBeenCalledWith(h1);
    disposeAll();
    expect(spy).toHaveBeenCalledWith(h2);
  });

  it("disposeAll empties the maps — second call is a no-op", () => {
    const clearIntSpy = vi.spyOn(globalThis, "clearInterval");
    const clearTOSpy = vi.spyOn(globalThis, "clearTimeout");
    const fn = vi.fn();
    registerInterval("a", setInterval(() => {}, 1000));
    registerTimeout("b", setTimeout(() => {}, 1000));
    registerCleanup("c", fn);

    disposeAll();
    const intCalls = clearIntSpy.mock.calls.length;
    const toCalls = clearTOSpy.mock.calls.length;

    disposeAll();
    expect(clearIntSpy.mock.calls.length).toBe(intCalls);
    expect(clearTOSpy.mock.calls.length).toBe(toCalls);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("multiple registrations of different IDs are all cleaned up", () => {
    const clearIntSpy = vi.spyOn(globalThis, "clearInterval");
    const clearTOSpy = vi.spyOn(globalThis, "clearTimeout");
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const h1 = setInterval(() => {}, 1000);
    const h2 = setInterval(() => {}, 1000);
    const t1 = setTimeout(() => {}, 1000);
    registerInterval("i1", h1);
    registerInterval("i2", h2);
    registerTimeout("t1", t1);
    registerCleanup("c1", fn1);
    registerCleanup("c2", fn2);

    disposeAll();

    expect(clearIntSpy).toHaveBeenCalledWith(h1);
    expect(clearIntSpy).toHaveBeenCalledWith(h2);
    expect(clearTOSpy).toHaveBeenCalledWith(t1);
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it("re-registering the same timeout ID clears the old handle", () => {
    const spy = vi.spyOn(globalThis, "clearTimeout");
    const h1 = setTimeout(() => {}, 1000);
    const h2 = setTimeout(() => {}, 1000);
    registerTimeout("delay", h1);
    registerTimeout("delay", h2);
    expect(spy).toHaveBeenCalledWith(h1);
    disposeAll();
    expect(spy).toHaveBeenCalledWith(h2);
  });

  it("re-registering the same cleanup ID replaces the function", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    registerCleanup("obs", fn1);
    registerCleanup("obs", fn2);
    disposeAll();
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledOnce();
  });
});
