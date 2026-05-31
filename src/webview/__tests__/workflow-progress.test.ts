// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { update, reset, setDiagnostics } from "../workflow-progress";
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

function diagEl(): HTMLElement | null {
  return document.getElementById("gsd-wf-diag");
}

describe("workflow diagnostics overlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });
  afterEach(() => {
    setDiagnostics(false);
    reset();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("stays absent until explicitly enabled", () => {
    mountSegment();
    update(snapshot());
    expect(diagEl()).toBeNull();
  });

  it("appears when enabled and reports a found anchor with a live segment", () => {
    mountSegment();
    setDiagnostics(true);
    update(snapshot({ status: "running" }));
    const el = diagEl();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("messages: 1");
    expect(el!.textContent).toContain("FOUND");
  });

  it("stays visible and reports a missing anchor when no segment exists", () => {
    // No #messages / tool segment — the panel cannot attach, but the overlay
    // must still be visible (that is the whole point of the diagnostic).
    document.body.innerHTML = "";
    setDiagnostics(true);
    update(snapshot({ status: "launching" }));
    expect(diagEl()).not.toBeNull();
    expect(diagEl()!.textContent).toContain("RETRYING");
    // After retries are exhausted it reports MISSING — and is still on screen.
    vi.advanceTimersByTime(25 * 120 + 200);
    expect(diagEl()).not.toBeNull();
    expect(diagEl()!.textContent).toContain("MISSING");
    expect(diagEl()!.textContent).toContain("#messages: no");
  });

  it("accumulates per-status message counts and clears them on reset", () => {
    mountSegment();
    setDiagnostics(true);
    update(snapshot({ status: "launching" }));
    update(snapshot({ status: "running" }));
    update(snapshot({ status: "completed", runningAgentCount: 0, doneAgentCount: 1 }));
    expect(diagEl()!.textContent).toContain("messages: 3");
    reset();
    expect(diagEl()!.textContent).toContain("messages: 0");
  });

  it("removes the overlay when disabled", () => {
    mountSegment();
    setDiagnostics(true);
    update(snapshot());
    expect(diagEl()).not.toBeNull();
    setDiagnostics(false);
    expect(diagEl()).toBeNull();
  });
});
