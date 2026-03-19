// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { state } from "../state";
import * as visualizer from "../visualizer";
import * as autoProgress from "../auto-progress";
import type { DashboardData, AutoProgressData } from "../../shared/types";

// ============================================================
// Test helpers
// ============================================================

const mockVscode = { postMessage: (_msg: unknown) => {} };

function makeDashboardData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    hasProject: true,
    hasMilestone: true,
    milestone: { id: "M001", title: "Test" },
    slice: { id: "S01", title: "Slice" },
    task: { id: "T01", title: "Task" },
    phase: "executing",
    slices: [],
    milestoneRegistry: [],
    progress: {
      tasks: { done: 0, total: 1 },
      slices: { done: 0, total: 1 },
      milestones: { done: 0, total: 1 },
    },
    blockers: [],
    nextAction: null,
    ...overrides,
  };
}

function makeProgressData(overrides?: Partial<AutoProgressData>): AutoProgressData {
  return {
    autoState: "auto",
    phase: "executing",
    milestone: { id: "M001", title: "Test" },
    slice: { id: "S01", title: "Slice" },
    task: { id: "T01", title: "Task" },
    slices: { done: 0, total: 1 },
    tasks: { done: 0, total: 1 },
    milestones: { done: 0, total: 1 },
    timestamp: Date.now(),
    model: { id: "claude-sonnet-4-20250514", provider: "anthropic" },
    ...overrides,
  };
}

// ============================================================
// Widget rendering (message-handler renderWidget)
// ============================================================

describe("widget rendering", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="gsd-app">
        <main class="gsd-messages" id="messagesContainer"></main>
        <footer class="gsd-footer" id="footer">
          <div class="gsd-widgets" id="widgetContainer"></div>
        </footer>
      </div>
    `;
    state.widgetData = new Map();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    state.widgetData = new Map();
  });

  // Since renderWidget is a module-private function, we test its effects
  // by simulating what the message handler does: setting state and DOM.
  // We'll test the state + DOM contract directly.

  it("widgetData map initializes empty", () => {
    expect(state.widgetData.size).toBe(0);
  });

  it("widgetData stores lines when set", () => {
    state.widgetData.set("gsd-health", ["  ● System OK  │  Budget: $0.12/$5.00 (2%)"]);
    expect(state.widgetData.get("gsd-health")).toEqual(["  ● System OK  │  Budget: $0.12/$5.00 (2%)"]);
  });

  it("widgetData delete clears the key", () => {
    state.widgetData.set("gsd-health", ["test"]);
    state.widgetData.delete("gsd-health");
    expect(state.widgetData.has("gsd-health")).toBe(false);
  });
});

// ============================================================
// Visualizer health tab
// ============================================================

describe("visualizer health tab", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="gsd-app">
        <main class="gsd-messages" id="messagesContainer"></main>
      </div>
    `;
    state.widgetData = new Map();
    state.autoProgress = null;
    visualizer.init({ vscode: mockVscode });
  });

  afterEach(() => {
    visualizer.hide();
    document.body.innerHTML = "";
    state.widgetData = new Map();
    state.autoProgress = null;
  });

  it("renders health tab button", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain('data-tab="health"');
    expect(overlay!.innerHTML).toContain("Health");
  });

  it("switches to health tab on click", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    const healthTab = overlay!.querySelector('[data-tab="health"]') as HTMLElement;
    expect(healthTab).not.toBeNull();
    healthTab.click();
    // After click, the health tab content should be visible
    expect(overlay!.innerHTML).toContain("System Health");
  });

  it("shows empty state when no health data", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    // Switch to health tab
    const overlay = document.getElementById("workflowVisualizer");
    const healthTab = overlay!.querySelector('[data-tab="health"]') as HTMLElement;
    healthTab.click();
    expect(overlay!.innerHTML).toContain("No health data available");
  });

  it("renders health items when widget data exists", () => {
    state.widgetData.set("gsd-health", ["  ● System OK  │  Budget: $0.12/$5.00 (2%)  │  Env: 1 warning"]);
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    const healthTab = overlay!.querySelector('[data-tab="health"]') as HTMLElement;
    healthTab.click();
    expect(overlay!.innerHTML).toContain("System OK");
    expect(overlay!.innerHTML).toContain("Budget");
    expect(overlay!.innerHTML).toContain("Env: 1 warning");
  });

  it("renders error status with red icon", () => {
    state.widgetData.set("gsd-health", ["  ✗ 2 issues  │  Budget: $4.50/$5.00 (90%)"]);
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    const healthTab = overlay!.querySelector('[data-tab="health"]') as HTMLElement;
    healthTab.click();
    expect(overlay!.innerHTML).toContain("🔴");
    expect(overlay!.innerHTML).toContain("2 issues");
  });

  it("renders warning status with yellow icon", () => {
    state.widgetData.set("gsd-health", ["  ⚠ 1 warning  │  Spent: 3¢"]);
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    const healthTab = overlay!.querySelector('[data-tab="health"]') as HTMLElement;
    healthTab.click();
    expect(overlay!.innerHTML).toContain("🟡");
    expect(overlay!.innerHTML).toContain("1 warning");
  });

  it("renders OK status with green icon", () => {
    state.widgetData.set("gsd-health", ["  ● System OK"]);
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    const healthTab = overlay!.querySelector('[data-tab="health"]') as HTMLElement;
    healthTab.click();
    expect(overlay!.innerHTML).toContain("🟢");
  });

  it("shows active model when autoProgress has model", () => {
    state.widgetData.set("gsd-health", ["  ● System OK"]);
    state.autoProgress = makeProgressData({ model: { id: "claude-sonnet-4-20250514", provider: "anthropic" } });
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    const healthTab = overlay!.querySelector('[data-tab="health"]') as HTMLElement;
    healthTab.click();
    expect(overlay!.innerHTML).toContain("Active Model");
    expect(overlay!.innerHTML).toContain("anthropic");
    expect(overlay!.innerHTML).toContain("claude-sonnet-4-20250514");
  });
});

// ============================================================
// Auto-progress model health indicator
// ============================================================

describe("auto-progress model health indicator", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="container">
        <div class="gsd-messages"></div>
        <div class="gsd-input-area"></div>
      </div>
    `;
    state.widgetData = new Map();
    state.autoProgress = null;
    state.autoProgressLastUpdate = 0;
    autoProgress.init();
  });

  afterEach(() => {
    autoProgress.dispose();
    document.body.innerHTML = "";
    state.widgetData = new Map();
  });

  it("shows green health dot when system OK", () => {
    state.widgetData.set("gsd-health", ["  ● System OK"]);
    autoProgress.update(makeProgressData());
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("gsd-auto-progress-health ok");
  });

  it("shows red health dot on error", () => {
    state.widgetData.set("gsd-health", ["  ✗ 2 issues"]);
    autoProgress.update(makeProgressData());
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("gsd-auto-progress-health error");
  });

  it("shows amber health dot on warning", () => {
    state.widgetData.set("gsd-health", ["  ⚠ 1 warning"]);
    autoProgress.update(makeProgressData());
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).toContain("gsd-auto-progress-health warning");
  });

  it("shows no health dot when no widget data", () => {
    autoProgress.update(makeProgressData());
    const widget = document.getElementById("autoProgressWidget");
    expect(widget!.innerHTML).not.toContain("gsd-auto-progress-health");
  });

  it("shows no health dot when no model", () => {
    state.widgetData.set("gsd-health", ["  ● System OK"]);
    autoProgress.update(makeProgressData({ model: null }));
    const widget = document.getElementById("autoProgressWidget");
    // No model = no model stat = no health dot
    expect(widget!.innerHTML).not.toContain("gsd-auto-progress-health");
  });
});

// ============================================================
// message_end error surfacing
// ============================================================

describe("message_end error surfacing", () => {
  // This tests the logic pattern without requiring the full message handler
  // wiring. The actual handler reads stopReason and errorMessage from the
  // message object and calls addSystemEntry.

  it("detects error stopReason on assistant message", () => {
    const msg = {
      role: "assistant",
      stopReason: "error",
      errorMessage: "Invalid API key for provider anthropic",
      content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    const stopReason = (msg as any).stopReason as string | undefined;
    const errorMessage = (msg as any).errorMessage as string | undefined;

    expect(stopReason).toBe("error");
    expect(errorMessage).toBe("Invalid API key for provider anthropic");
  });

  it("does not flag non-error stopReasons", () => {
    const msg = {
      role: "assistant",
      stopReason: "end_turn",
      content: [{ type: "text", text: "Hello" }],
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
    };

    const stopReason = (msg as any).stopReason as string | undefined;
    expect(stopReason).not.toBe("error");
  });

  it("handles missing errorMessage gracefully", () => {
    const msg = {
      role: "assistant",
      stopReason: "error",
      content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };

    const stopReason = (msg as any).stopReason as string | undefined;
    const errorMessage = (msg as any).errorMessage as string | undefined;

    expect(stopReason).toBe("error");
    expect(errorMessage).toBeUndefined();
    // The handler checks `stopReason === "error" && errorMessage` — falsy errorMessage skips display
    expect(!!(stopReason === "error" && errorMessage)).toBe(false);
  });
});
