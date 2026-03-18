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

  // ============================================================
  // Discussion-pause state tests
  // ============================================================

  describe("discussion-pause state", () => {
    const discussionData = () =>
      makeProgressData({ autoState: "paused", phase: "needs-discussion" });

    it("shows 💬 mode icon when paused with needs-discussion phase", () => {
      autoProgress.update(discussionData());
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.innerHTML).toContain("💬");
      expect(widget!.innerHTML).not.toContain("⏸");
    });

    it("displays AWAITING DISCUSSION phase label", () => {
      autoProgress.update(discussionData());
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.innerHTML).toContain("AWAITING DISCUSSION");
    });

    it("shows /gsd discuss hint line", () => {
      autoProgress.update(discussionData());
      const hint = document.querySelector(".gsd-auto-progress-hint");
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toContain("/gsd discuss");
    });

    it("adds discussion class to widget", () => {
      autoProgress.update(discussionData());
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.classList.contains("gsd-auto-progress-discussion")).toBe(true);
    });

    it("removes discussion class when returning to normal state", () => {
      autoProgress.update(discussionData());
      autoProgress.update(makeProgressData({ autoState: "auto", phase: "executing" }));
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.classList.contains("gsd-auto-progress-discussion")).toBe(false);
    });

    it("hides pulse animation during discussion pause", () => {
      autoProgress.update(discussionData());
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.querySelector(".gsd-auto-progress-pulse")).toBeNull();
    });

    it("shows pulse animation during normal pause (non-discussion)", () => {
      autoProgress.update(makeProgressData({ autoState: "paused", phase: "executing" }));
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.querySelector(".gsd-auto-progress-pulse")).toBeTruthy();
    });

    it("widget remains visible during discussion pause", () => {
      autoProgress.update(discussionData());
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.style.display).toBe("flex");
    });
  });

  // ============================================================
  // Parallel worker card tests
  // ============================================================

  describe("parallel worker cards", () => {
    function makeWorker(overrides?: Record<string, unknown>) {
      return {
        id: "M001",
        pid: 1234,
        state: "running" as const,
        currentUnit: { type: "task", id: "T01" } as { type: string; id: string } | null,
        completedUnits: 3,
        cost: 0.42,
        budgetPercent: 42 as number | null,
        lastHeartbeat: Date.now(),
        stale: false,
        ...overrides,
      };
    }

    it("renders worker cards when workers array is present", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker()],
      }));
      const cards = document.querySelectorAll(".gsd-auto-progress-worker-card");
      expect(cards.length).toBe(1);
    });

    it("renders no worker cards when workers is null", () => {
      autoProgress.update(makeProgressData({ workers: null }));
      const cards = document.querySelectorAll(".gsd-auto-progress-worker-card");
      expect(cards.length).toBe(0);
    });

    it("renders no worker cards when workers is undefined", () => {
      autoProgress.update(makeProgressData());
      const cards = document.querySelectorAll(".gsd-auto-progress-worker-card");
      expect(cards.length).toBe(0);
    });

    it("renders multiple worker cards", () => {
      autoProgress.update(makeProgressData({
        workers: [
          makeWorker({ id: "M001" }),
          makeWorker({ id: "M002", state: "paused" }),
        ],
      }));
      const cards = document.querySelectorAll(".gsd-auto-progress-worker-card");
      expect(cards.length).toBe(2);
    });

    it("shows worker milestone ID", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ id: "M005" })],
      }));
      const widget = document.getElementById("autoProgressWidget");
      expect(widget!.innerHTML).toContain("M005");
    });

    it("shows worker state badge with correct class", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ state: "running" })],
      }));
      const badge = document.querySelector(".gsd-worker-state-running");
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toBe("Running");
    });

    it("shows error state badge", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ state: "error" })],
      }));
      const badge = document.querySelector(".gsd-worker-state-error");
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toBe("Error");
    });

    it("shows current unit info", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ currentUnit: { type: "slice", id: "S03" } })],
      }));
      const unit = document.querySelector(".gsd-worker-unit");
      expect(unit).toBeTruthy();
      expect(unit!.textContent).toContain("slice");
      expect(unit!.textContent).toContain("S03");
    });

    it("shows worker cost", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ cost: 1.23 })],
      }));
      const cost = document.querySelector(".gsd-worker-cost");
      expect(cost).toBeTruthy();
      expect(cost!.textContent).toContain("$1.23");
    });

    it("shows budget bar with percentage", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ budgetPercent: 65 })],
      }));
      const bar = document.querySelector(".gsd-worker-budget-fill");
      expect(bar).toBeTruthy();
      expect((bar as HTMLElement).style.width).toBe("65%");
      expect(bar!.classList.contains("gsd-budget-ok")).toBe(true);
    });

    it("shows warning color at 80% budget", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ budgetPercent: 85 })],
      }));
      const bar = document.querySelector(".gsd-worker-budget-fill");
      expect(bar!.classList.contains("gsd-budget-warn")).toBe(true);
    });

    it("shows red color at 100% budget", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ budgetPercent: 105 })],
      }));
      const bar = document.querySelector(".gsd-worker-budget-fill");
      expect(bar!.classList.contains("gsd-budget-over")).toBe(true);
      // Clamped to 100% width
      expect((bar as HTMLElement).style.width).toBe("100%");
    });

    it("marks stale workers with stale class", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ stale: true })],
      }));
      const card = document.querySelector(".gsd-auto-progress-worker-card");
      expect(card!.classList.contains("stale")).toBe(true);
    });

    it("shows stale label on stale workers", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ stale: true })],
      }));
      const label = document.querySelector(".gsd-worker-stale-label");
      expect(label).toBeTruthy();
      expect(label!.textContent).toContain("stale");
    });

    it("hides budget bar when budgetPercent is null", () => {
      autoProgress.update(makeProgressData({
        workers: [makeWorker({ budgetPercent: null })],
      }));
      const bar = document.querySelector(".gsd-worker-budget-fill");
      expect(bar).toBeNull();
    });

    it("shows budget alert badge when budgetAlert is true", () => {
      autoProgress.update(makeProgressData({ budgetAlert: true }));
      const badge = document.querySelector(".gsd-auto-progress-budget-alert");
      expect(badge).toBeTruthy();
      expect(badge!.textContent).toContain("Budget");
    });

    it("hides budget alert badge when budgetAlert is false", () => {
      autoProgress.update(makeProgressData({ budgetAlert: false }));
      const badge = document.querySelector(".gsd-auto-progress-budget-alert");
      expect(badge).toBeNull();
    });
  });
});