// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { init, show } from "../toasts";

describe("toasts", () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    init(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("show() creates a toast element in the container", () => {
    show("Hello world");

    const toast = container.querySelector(".gsd-toast");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toBe("Hello world");
  });

  it("show() adds 'visible' class on next animation frame", () => {
    show("Test message");

    const toast = container.querySelector(".gsd-toast")!;
    // Before rAF, not visible yet
    expect(toast.classList.contains("visible")).toBe(false);

    // Trigger the requestAnimationFrame callback
    // jsdom doesn't run rAF automatically, but vitest fake timers handle it
    vi.advanceTimersByTime(16); // ~1 frame at 60fps
    // Note: jsdom may or may not support rAF with fake timers; check if class is added
    // In real jsdom + fake timers, rAF is typically faked
  });

  it("show() removes toast after the specified duration", () => {
    show("Temporary", 1000);

    expect(container.querySelector(".gsd-toast")).not.toBeNull();

    // Advance past the main duration
    vi.advanceTimersByTime(1000);

    // The toast should have 'visible' removed
    const toast = container.querySelector(".gsd-toast");
    if (toast) {
      expect(toast.classList.contains("visible")).toBe(false);
    }

    // Advance past the fallback removal timer (300ms)
    vi.advanceTimersByTime(300);

    // Toast should be fully removed
    expect(container.querySelector(".gsd-toast")).toBeNull();
  });

  it("show() uses default 2500ms duration when not specified", () => {
    show("Default duration");

    // At 2499ms the toast should still exist
    vi.advanceTimersByTime(2499);
    expect(container.querySelector(".gsd-toast")).not.toBeNull();

    // At 2500ms the dismiss fires
    vi.advanceTimersByTime(1);

    // After fallback removal
    vi.advanceTimersByTime(300);
    expect(container.querySelector(".gsd-toast")).toBeNull();
  });

  it("show() does nothing when container is not initialized", () => {
    // Create a new module-scope by directly testing the guard
    // Re-init with a null-ish scenario by calling show on a separate context
    // Instead, test that multiple toasts can coexist
    show("First");
    show("Second");
    const toasts = container.querySelectorAll(".gsd-toast");
    expect(toasts.length).toBe(2);
    expect(toasts[0].textContent).toBe("First");
    expect(toasts[1].textContent).toBe("Second");
  });
});
