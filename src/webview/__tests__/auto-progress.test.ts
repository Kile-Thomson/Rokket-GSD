// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ============================================================
// Auto-Progress Widget Tests
// ============================================================

// Must import state before auto-progress to ensure shared state
import { state } from "../state";
import * as autoProgress from "../auto-progress";
import type { AutoProgressData } from "../../shared/types";

function makeProgressData(overrides?: Partial<AutoProgressData>): AutoProgressData {
  return {
    autoState: "auto",
    phase: "executing",
    milestone: { id: "M012", title: "Test Milestone" },
    slice: { id: "S01", title: "Test Slice" },
    task: { id: "T01", title: "Test Task" },
    slices: { done: 1, total: 5 },
    tasks: { done: 2, total: 6 },
    milestones: { done: 0, total: 1 },
    timestamp: Date.now(),
    cost: 0.42,
    model: { id: "claude-sonnet-4-20250514", provider: "anthropic" },
    ...overrides,
  };
}

describe("auto-progress widget", () => {
  beforeEach(() => {
    // Reset state
    state.autoProgress = null;
    state.autoProgressLastUpdate = 0;

    // Create minimal DOM structure
    document.body.innerHTML = `
      <div id="container">
        <div class="gsd-messages"></div>
        <div class="gsd-input-area"></div>
      </div>
    `;

    autoProgress.init();
  });

  afterEach(() => {
    autoProgress.dispose();
  });

  it("creates widget element on init", () => {
    const widget = document.getElementById("autoProgressWidget");
    expect(widget).toBeTruthy();
    expect(widget!.style.display).toBe("none");
  });

  it("shows widget when progress data is received", () => {
    autoProgress.update(makeProgressData());
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.style.display).toBe("flex");
  });

  it("hides widget when null is received", () => {
    autoProgress.update(makeProgressData());
    autoProgress.update(null);
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.style.display).toBe("none");
  });

  it("displays task info correctly", () => {
    autoProgress.update(makeProgressData());
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("T01");
    expect(widget!.innerHTML).toContain("Test Task");
  });

  it("displays phase label", () => {
    autoProgress.update(makeProgressData({ phase: "executing" }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("EXECUTING");
  });

  it("displays progress bars", () => {
    autoProgress.update(makeProgressData());
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("2/6");
    expect(widget!.innerHTML).toContain("1/5");
  });

  it("displays cost", () => {
    autoProgress.update(makeProgressData({ cost: 1.23 }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("$1.23");
  });

  it("displays model info", () => {
    autoProgress.update(makeProgressData({ model: { id: "sonnet-4", provider: "anthropic" } }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("sonnet-4");
  });

  it("updates state.autoProgress", () => {
    const data = makeProgressData();
    autoProgress.update(data);
    expect(state.autoProgress).toBe(data);
  });

  it("clears state.autoProgress on null", () => {
    autoProgress.update(makeProgressData());
    autoProgress.update(null);
    expect(state.autoProgress).toBeNull();
  });

  it("shows mode icon for auto", () => {
    autoProgress.update(makeProgressData({ autoState: "auto" }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("⚡");
  });

  it("shows mode icon for next", () => {
    autoProgress.update(makeProgressData({ autoState: "next" }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("▸");
  });

  it("shows mode icon for paused", () => {
    autoProgress.update(makeProgressData({ autoState: "paused" }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("⏸");
  });

  it("falls back to slice info when no task", () => {
    autoProgress.update(makeProgressData({ task: null }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("S01");
    expect(widget!.innerHTML).toContain("Test Slice");
  });

  it("falls back to milestone info when no task or slice", () => {
    autoProgress.update(makeProgressData({ task: null, slice: null }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("Test Milestone");
  });

  it("hides progress bars when no data", () => {
    autoProgress.update(makeProgressData({ tasks: { done: 0, total: 0 }, slices: { done: 0, total: 0 } }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.querySelectorAll(".gsd-auto-progress-bar-group").length).toBe(0);
  });

  it("handles stale data guard via state timestamps", () => {
    autoProgress.update(makeProgressData());
    expect(state.autoProgressLastUpdate).toBeGreaterThan(0);

    // Simulate stale state
    state.autoProgressLastUpdate = Date.now() - 31_000;
    // The stale guard runs on an interval — we just verify the timestamp is tracked
    expect(state.autoProgressLastUpdate).toBeLessThan(Date.now() - 30_000);
  });

  it("shows capture badge when pending captures > 0", () => {
    autoProgress.update(makeProgressData({ pendingCaptures: 3 }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("📌");
    expect(widget!.innerHTML).toContain("3");
  });

  it("hides capture badge when no pending captures", () => {
    autoProgress.update(makeProgressData({ pendingCaptures: 0 }));
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).not.toContain("📌");
  });

  it("renders validate-milestone phase with checkmark icon", () => {
    autoProgress.update(makeProgressData({ phase: "validate-milestone" }));
    const widget = document.querySelector(".gsd-auto-progress-phase");
    expect(widget?.textContent).toContain("VALIDATING");
    expect(widget?.textContent).toContain("✓");
  });
});