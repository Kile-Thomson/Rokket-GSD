// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as workflowHover from "../workflow-hover";
import type { WorkflowState, DashboardData } from "../../shared/types";

function makeState(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    milestone: { id: "M004", title: "Telegram Sync" },
    slice: { id: "S02", title: "Bridge wiring" },
    task: { id: "T03", title: "Wire polling loop" },
    phase: "executing",
    autoMode: null,
    ...overrides,
  };
}

function makeDashboard(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    hasProject: true,
    hasMilestone: true,
    milestone: { id: "M004", title: "Telegram Sync" },
    slice: { id: "S02", title: "Bridge wiring" },
    task: { id: "T03", title: "Wire polling loop" },
    phase: "executing",
    slices: [
      {
        id: "S02",
        title: "Bridge wiring",
        done: false,
        risk: "high",
        active: true,
        tasks: [
          { id: "T01", title: "Scaffold bridge", done: true, active: false, estimate: "30m" },
          { id: "T02", title: "Session map", done: true, active: false },
          { id: "T03", title: "Wire polling loop", done: false, active: true, estimate: "1h" },
          { id: "T04", title: "Error handling", done: false, active: false },
        ],
      },
    ],
    milestoneRegistry: [
      { id: "M001", title: "Core", done: true, active: false },
      { id: "M004", title: "Telegram Sync", done: false, active: true },
      { id: "M005", title: "Voice", done: false, active: false },
    ],
    progress: {
      tasks: { done: 2, total: 4 },
      slices: { done: 0, total: 1 },
      milestones: { done: 1, total: 3 },
    },
    blockers: [],
    nextAction: null,
    ...overrides,
  } as DashboardData;
}

let badge: HTMLElement;

function hover(): void {
  badge.dispatchEvent(new Event("mouseenter"));
  vi.advanceTimersByTime(250);
}

function popover(): HTMLElement | null {
  return document.getElementById("workflowPopover");
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<header><span id="workflowBadge" tabindex="0"></span></header>`;
  badge = document.getElementById("workflowBadge")!;
  workflowHover.init(badge);
});

afterEach(() => {
  workflowHover._resetForTest();
  vi.useRealTimers();
});

describe("workflow-hover", () => {
  it("does not show a popover before any state has arrived", () => {
    hover();
    expect(popover()).toBeNull();
  });

  it("shows popover after hover delay once state is set", () => {
    workflowHover.setWorkflowState(makeState());
    badge.dispatchEvent(new Event("mouseenter"));
    expect(popover()).toBeNull(); // not yet — delay pending
    vi.advanceTimersByTime(250);
    expect(popover()).not.toBeNull();
  });

  it("renders milestone, slice, and task titles from workflow state", () => {
    workflowHover.setWorkflowState(makeState());
    hover();
    const text = popover()!.textContent!;
    expect(text).toContain("M004 — Telegram Sync");
    expect(text).toContain("S02 — Bridge wiring");
    expect(text).toContain("T03 — Wire polling loop");
    expect(text).toContain("Executing");
  });

  it("enriches with dashboard data: registry position, risk, task progress, estimate", () => {
    workflowHover.setWorkflowState(makeState());
    workflowHover.setDashboardData(makeDashboard());
    hover();
    const text = popover()!.textContent!;
    expect(text).toContain("2 of 3 milestones");
    expect(text).toContain("risk: high");
    expect(text).toContain("2/4 tasks done");
    expect(text).toContain("est: 1h");
  });

  it("renders the active slice's task checklist with done/active markers", () => {
    workflowHover.setWorkflowState(makeState());
    workflowHover.setDashboardData(makeDashboard());
    hover();
    const items = popover()!.querySelectorAll(".gsd-wf-pop-task");
    expect(items.length).toBe(4);
    expect(items[0].classList.contains("done")).toBe(true);
    expect(items[2].classList.contains("active")).toBe(true);
    expect(items[2].textContent).toContain("T03: Wire polling loop");
  });

  it("truncates long checklists with a +N more row", () => {
    const dash = makeDashboard();
    dash.slices[0].tasks = Array.from({ length: 11 }, (_, i) => ({
      id: `T${i + 1}`, title: `Task ${i + 1}`, done: false, active: false,
    }));
    workflowHover.setWorkflowState(makeState());
    workflowHover.setDashboardData(dash);
    hover();
    const items = popover()!.querySelectorAll(".gsd-wf-pop-task");
    expect(items.length).toBe(9); // 8 tasks + "more" row
    expect(items[8].textContent).toContain("+3 more");
  });

  it("shows self-directed message when workflow state is null", () => {
    workflowHover.setWorkflowState(null);
    hover();
    expect(popover()!.textContent).toContain("Self-directed");
  });

  it("shows auto-mode status", () => {
    workflowHover.setWorkflowState(makeState({ autoMode: "auto" }));
    hover();
    expect(popover()!.textContent).toContain("Auto-executing");
  });

  it("hides on mouseleave after the hide delay", () => {
    workflowHover.setWorkflowState(makeState());
    hover();
    expect(popover()).not.toBeNull();
    badge.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(200);
    expect(popover()).toBeNull();
  });

  it("cancels pending show when the pointer leaves before the delay", () => {
    workflowHover.setWorkflowState(makeState());
    badge.dispatchEvent(new Event("mouseenter"));
    badge.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(500);
    expect(popover()).toBeNull();
  });

  it("shows immediately on keyboard focus and hides on blur", () => {
    workflowHover.setWorkflowState(makeState());
    badge.dispatchEvent(new Event("focus"));
    expect(popover()).not.toBeNull();
    expect(badge.getAttribute("aria-describedby")).toBe("workflowPopover");
    badge.dispatchEvent(new Event("blur"));
    expect(popover()).toBeNull();
    expect(badge.hasAttribute("aria-describedby")).toBe(false);
  });

  it("hides on Escape", () => {
    workflowHover.setWorkflowState(makeState());
    badge.dispatchEvent(new Event("focus"));
    expect(popover()).not.toBeNull();
    badge.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(popover()).toBeNull();
  });

  it("stays open while the badge keeps keyboard focus after the pointer leaves", () => {
    workflowHover.setWorkflowState(makeState());
    badge.focus();
    badge.dispatchEvent(new Event("focus"));
    expect(popover()).not.toBeNull();
    badge.dispatchEvent(new Event("mouseenter"));
    badge.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(500);
    expect(popover()).not.toBeNull();
  });

  it("focus during a pending hide delay cancels the hide", () => {
    workflowHover.setWorkflowState(makeState());
    hover();
    badge.dispatchEvent(new Event("mouseleave"));
    vi.advanceTimersByTime(50); // hide timer pending (150ms)
    badge.focus();
    badge.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(500);
    expect(popover()).not.toBeNull();
  });

  it("re-renders an open popover when new state arrives", () => {
    workflowHover.setWorkflowState(makeState());
    hover();
    expect(popover()!.textContent).toContain("T03");
    workflowHover.setWorkflowState(makeState({ task: { id: "T04", title: "Error handling" } }));
    expect(popover()!.textContent).toContain("T04 — Error handling");
  });

  it("falls back to the dashboard milestone title when state and registry lack one", () => {
    workflowHover.setWorkflowState(makeState({ milestone: { id: "M004", title: "" } }));
    workflowHover.setDashboardData(makeDashboard({ milestoneRegistry: [] }));
    hover();
    expect(popover()!.textContent).toContain("M004 — Telegram Sync");
  });

  it("falls back to the dashboard task title when state and slice tasks lack one", () => {
    workflowHover.setWorkflowState(makeState({ task: { id: "T03", title: "" } }));
    workflowHover.setDashboardData(makeDashboard({ slices: [] }));
    hover();
    expect(popover()!.textContent).toContain("T03 — Wire polling loop");
  });

  it("renders titles as text, not HTML", () => {
    workflowHover.setWorkflowState(makeState({
      milestone: { id: "M001", title: "<img src=x onerror=alert(1)>" },
      slice: null,
      task: null,
    }));
    hover();
    expect(popover()!.querySelector("img")).toBeNull();
    expect(popover()!.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
