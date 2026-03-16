// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { state } from "../state";
import * as visualizer from "../visualizer";
import type { DashboardData } from "../../shared/types";

// ============================================================
// Test helpers
// ============================================================

function makeDashboardData(overrides?: Partial<DashboardData>): DashboardData {
  return {
    hasProject: true,
    hasMilestone: true,
    milestone: { id: "M012", title: "Feature Parity" },
    slice: { id: "S04", title: "Visualizer Overlay" },
    task: { id: "T01", title: "Build module" },
    phase: "executing",
    slices: [
      { id: "S01", title: "Auto Progress", done: true, risk: "high", active: false, tasks: [] },
      { id: "S02", title: "Model Routing", done: true, risk: "medium", active: false, tasks: [] },
      { id: "S03", title: "Capture Badge", done: true, risk: "medium", active: false, tasks: [] },
      {
        id: "S04", title: "Visualizer", done: false, risk: "medium", active: true,
        tasks: [
          { id: "T01", title: "Build module", done: false, active: true },
          { id: "T02", title: "Wire up", done: false, active: false },
        ],
        taskProgress: { done: 0, total: 2 },
      },
      { id: "S05", title: "Slash Commands", done: false, risk: "low", active: false, tasks: [] },
    ],
    milestoneRegistry: [
      { id: "M008", title: "Hardening", done: true, active: false },
      { id: "M012", title: "Feature Parity", done: false, active: true },
    ],
    progress: {
      tasks: { done: 0, total: 2 },
      slices: { done: 3, total: 5 },
      milestones: { done: 1, total: 2 },
    },
    blockers: [],
    nextAction: "Execute T01",
    stats: {
      cost: 1.23,
      tokens: { input: 50000, output: 20000, cacheRead: 30000, cacheWrite: 10000, total: 110000 },
      toolCalls: 42,
      userMessages: 5,
    },
    ...overrides,
  };
}

const mockVscode = { postMessage: (_msg: unknown) => {} };

describe("visualizer", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="gsd-app">
        <main class="gsd-messages" id="messagesContainer"></main>
      </div>
    `;
    visualizer.init({ vscode: mockVscode });
  });

  afterEach(() => {
    visualizer.hide();
    document.body.innerHTML = "";
  });

  it("is not visible initially", () => {
    expect(visualizer.isVisible()).toBe(false);
  });

  it("shows overlay on show()", () => {
    visualizer.show();
    expect(visualizer.isVisible()).toBe(true);
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay).not.toBeNull();
    expect(overlay!.style.display).toBe("flex");
  });

  it("hides on hide()", () => {
    visualizer.show();
    visualizer.hide();
    expect(visualizer.isVisible()).toBe(false);
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.style.display).toBe("none");
  });

  it("renders loading state on show()", () => {
    visualizer.show();
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("Loading workflow data");
  });

  it("renders progress tab with milestone data", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("M012");
    expect(overlay!.innerHTML).toContain("Feature Parity");
    expect(overlay!.innerHTML).toContain("S04");
  });

  it("renders empty state when no project", () => {
    visualizer.show();
    visualizer.updateData({ ...makeDashboardData(), hasProject: false, hasMilestone: false });
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("No active GSD project");
  });

  it("renders slice breakdown with tasks", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("T01");
    expect(overlay!.innerHTML).toContain("Build module");
  });

  it("renders milestone registry", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("M008");
    expect(overlay!.innerHTML).toContain("Hardening");
  });

  it("renders progress bars", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("Milestones");
    expect(overlay!.innerHTML).toContain("Slices");
    expect(overlay!.innerHTML).toContain("Tasks");
  });

  it("renders blockers when present", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData({ blockers: ["Need API key"] }));
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("Need API key");
    expect(overlay!.innerHTML).toContain("Blockers");
  });

  it("renders next action", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("Execute T01");
  });

  it("shows auto-mode badge when autoProgress is active", () => {
    state.autoProgress = {
      autoState: "auto",
      phase: "executing",
      milestone: { id: "M012", title: "Test" },
      slice: null,
      task: null,
      slices: { done: 0, total: 0 },
      tasks: { done: 0, total: 0 },
      milestones: { done: 0, total: 0 },
      timestamp: Date.now(),
    };
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("AUTO");
    state.autoProgress = null;
  });

  it("handles Escape to close", () => {
    visualizer.show();
    expect(visualizer.isVisible()).toBe(true);
    const consumed = visualizer.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(consumed).toBe(true);
    expect(visualizer.isVisible()).toBe(false);
  });

  it("ignores data updates when not visible", () => {
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    // Should not have been created
    expect(overlay).toBeNull();
  });

  it("does not render when data is null", () => {
    visualizer.show();
    visualizer.updateData(null);
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("No active GSD project");
  });

  it("renders risk badges for slices", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("risk-high");
    expect(overlay!.innerHTML).toContain("risk-medium");
    expect(overlay!.innerHTML).toContain("risk-low");
  });

  it("renders current action breadcrumb", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("M012 / S04 / T01");
  });

  it("renders phase badge", () => {
    visualizer.show();
    visualizer.updateData(makeDashboardData());
    const overlay = document.getElementById("workflowVisualizer");
    expect(overlay!.innerHTML).toContain("Executing");
    expect(overlay!.innerHTML).toContain("phase-executing");
  });
});
