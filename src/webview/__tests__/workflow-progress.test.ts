// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { update, reset } from "../workflow-progress";
import type { WorkflowProgressData } from "../../shared/types";

function snapshot(over: Partial<WorkflowProgressData> = {}): WorkflowProgressData {
  return {
    toolCallId: "tc1",
    name: "wf",
    phases: [],
    status: "running",
    agents: [{ label: "a", state: "running" }],
    plannedAgentCount: 1,
    doneAgentCount: 0,
    runningAgentCount: 1,
    startedAt: 1000,
    updatedAt: 2000,
    stale: false,
    ...over,
  };
}

/** Build the #messages → tool segment DOM the panel anchors against. */
function mountSegment(toolCallId = "tc1"): HTMLElement {
  document.body.innerHTML = `<div id="messages">
    <div class="gsd-tool-segment">
      <div class="gsd-tool-block" data-tool-id="${toolCallId}"></div>
    </div>
  </div>`;
  return document.querySelector<HTMLElement>(".gsd-tool-segment")!;
}

function panelEl(toolCallId = "tc1"): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.gsd-workflow-panel[data-workflow-tool-id="${toolCallId}"]`,
  );
}

describe("workflow-progress panel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });
  afterEach(() => {
    reset();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("attaches a panel as a sibling after the tool segment", () => {
    mountSegment();
    update(snapshot());
    const panel = panelEl();
    expect(panel).not.toBeNull();
    expect(panel!.previousElementSibling?.classList.contains("gsd-tool-segment")).toBe(true);
    expect(panel!.className).toContain("status-running");
  });

  it("re-attaches a live panel after a turn DOM rebuild drops it", () => {
    mountSegment();
    update(snapshot({ status: "running" }));
    expect(panelEl()).not.toBeNull();

    // Simulate a streaming/finalize/history rebuild of the turn: the segment is
    // re-created (fresh) and the injected sibling panel is gone.
    mountSegment();
    expect(panelEl()).toBeNull();

    // The self-healing heartbeat re-attaches it without a new extension poll.
    vi.advanceTimersByTime(1000);
    expect(panelEl()).not.toBeNull();
    expect(panelEl()!.className).toContain("status-running");
  });

  it("stops re-attaching once the run reaches a terminal state", () => {
    mountSegment();
    update(snapshot({ status: "running" }));
    update(snapshot({ status: "completed", runningAgentCount: 0, doneAgentCount: 1 }));

    // After completion the heartbeat should no longer re-create a dropped panel.
    mountSegment();
    expect(panelEl()).toBeNull();
    vi.advanceTimersByTime(3000);
    expect(panelEl()).toBeNull();
  });

  it("reset() clears cached panels and halts the heartbeat", () => {
    mountSegment();
    update(snapshot({ status: "running" }));
    reset();
    mountSegment();
    vi.advanceTimersByTime(3000);
    expect(panelEl()).toBeNull();
  });
});
