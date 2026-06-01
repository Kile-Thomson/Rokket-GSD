// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { update, remove, reset } from "../workflow-live";
import type { WorkflowProgressData } from "../../shared/types";

function snapshot(over: Partial<WorkflowProgressData> = {}): WorkflowProgressData {
  return {
    toolCallId: "wf_run1",
    name: "demo",
    phases: ["A"],
    status: "running",
    agents: [
      { label: "alpha", phase: "A", state: "running" },
      { label: "beta", phase: "A", state: "pending" },
    ],
    plannedAgentCount: 2,
    doneAgentCount: 0,
    runningAgentCount: 1,
    startedAt: 1000,
    updatedAt: 3000,
    stale: false,
    ...over,
  };
}

const cards = () => document.querySelectorAll<HTMLElement>(".gsd-wf-inline");
const card = (runId = "wf_run1") =>
  document.querySelector<HTMLElement>(`.gsd-wf-inline[data-workflow-run-id="${runId}"]`);

describe("workflow-live inline conversation card", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
    document.body.innerHTML = `<div id="messages"></div>`;
  });
  afterEach(() => {
    reset();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("renders a card inside #messages, not a floating overlay", () => {
    expect(card()).toBeNull();
    update(snapshot());
    const el = card();
    expect(el).not.toBeNull();
    expect(el!.parentElement?.id).toBe("messages");
    // It renders the run's name and agent labels.
    expect(el!.textContent).toContain("demo");
    expect(el!.textContent).toContain("alpha");
    expect(el!.textContent).toContain("beta");
    expect(el!.className).toContain("status-running");
  });

  it("keeps one card per run id and updates it in place", () => {
    update(snapshot({ doneAgentCount: 0 }));
    update(
      snapshot({
        doneAgentCount: 1,
        agents: [
          { label: "alpha", phase: "A", state: "done" },
          { label: "beta", phase: "A", state: "running" },
        ],
      }),
    );
    expect(cards().length).toBe(1);
    // alpha's done state is reflected in its agent row.
    expect(card()!.querySelector(".gsd-wf-agent-done")).not.toBeNull();
  });

  it("stacks multiple concurrent runs as separate cards", () => {
    update(snapshot({ toolCallId: "wf_a", name: "alpha-wf" }));
    update(snapshot({ toolCallId: "wf_b", name: "beta-wf" }));
    expect(cards().length).toBe(2);
    expect(document.body.textContent).toContain("alpha-wf");
    expect(document.body.textContent).toContain("beta-wf");
  });

  it("re-appears within a heartbeat if a DOM rebuild drops a live card", () => {
    update(snapshot({ status: "running" }));
    expect(card()).not.toBeNull();

    // Simulate a streaming/finalize/history rebuild wiping the conversation.
    document.getElementById("messages")!.innerHTML = "";
    expect(card()).toBeNull();

    // The self-healing heartbeat re-attaches it without a new watcher poll.
    vi.advanceTimersByTime(1000);
    expect(card()).not.toBeNull();
    expect(card()!.className).toContain("status-running");
  });

  it("persists the terminal card as a record after completion + remove", () => {
    update(snapshot({ status: "running" }));
    update(
      snapshot({
        status: "completed",
        runningAgentCount: 0,
        doneAgentCount: 2,
        agents: [
          { label: "alpha", phase: "A", state: "done" },
          { label: "beta", phase: "A", state: "done" },
        ],
      }),
    );
    remove("wf_run1");

    // The terminal card stays in the transcript...
    expect(card()).not.toBeNull();
    expect(card()!.className).toContain("status-completed");

    // ...and is never resurrected once it's no longer live.
    document.getElementById("messages")!.innerHTML = "";
    vi.advanceTimersByTime(3000);
    expect(card()).toBeNull();
  });

  it("does not run a heartbeat when the only run is already terminal", () => {
    update(snapshot({ status: "completed", runningAgentCount: 0, doneAgentCount: 2 }));
    document.getElementById("messages")!.innerHTML = "";
    vi.advanceTimersByTime(3000);
    expect(card()).toBeNull();
  });

  it("reset() clears all inline cards", () => {
    update(snapshot({ toolCallId: "wf_a" }));
    update(snapshot({ toolCallId: "wf_b" }));
    expect(cards().length).toBe(2);
    reset();
    expect(cards().length).toBe(0);
  });
});
