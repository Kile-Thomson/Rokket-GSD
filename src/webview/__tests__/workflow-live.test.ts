// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
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

const container = () => document.getElementById("gsd-wf-live");

describe("workflow-live floating panel", () => {
  beforeEach(() => {
    reset();
    document.body.innerHTML = "";
  });

  it("mounts a fixed container on document.body, independent of #messages", () => {
    expect(container()).toBeNull();
    update(snapshot());
    const el = container();
    expect(el).not.toBeNull();
    expect(el?.parentElement).toBe(document.body);
    // It renders the run's name and agent labels.
    expect(el?.textContent).toContain("demo");
    expect(el?.textContent).toContain("alpha");
    expect(el?.textContent).toContain("beta");
  });

  it("shows a running count in the header while a run is live", () => {
    update(snapshot());
    expect(container()?.querySelector(".gsd-wf-live-count")?.textContent).toContain("1 running");
  });

  it("keeps one card per run id and updates it in place", () => {
    update(snapshot({ doneAgentCount: 0 }));
    update(snapshot({ doneAgentCount: 1, agents: [
      { label: "alpha", phase: "A", state: "done" },
      { label: "beta", phase: "A", state: "running" },
    ] }));
    const cards = container()?.querySelectorAll(".gsd-wf-live-card");
    expect(cards?.length).toBe(1);
    // alpha's done state is reflected in its agent row.
    expect(container()?.querySelector(".gsd-wf-agent-done")).not.toBeNull();
  });

  it("stacks multiple concurrent runs as separate cards", () => {
    update(snapshot({ toolCallId: "wf_a", name: "alpha-wf" }));
    update(snapshot({ toolCallId: "wf_b", name: "beta-wf" }));
    expect(container()?.querySelectorAll(".gsd-wf-live-card").length).toBe(2);
    expect(container()?.textContent).toContain("alpha-wf");
    expect(container()?.textContent).toContain("beta-wf");
  });

  it("removes a card and tears down the container when the last run is retracted", () => {
    update(snapshot({ toolCallId: "wf_a" }));
    update(snapshot({ toolCallId: "wf_b" }));
    remove("wf_a");
    expect(container()?.querySelectorAll(".gsd-wf-live-card").length).toBe(1);
    remove("wf_b");
    expect(container()).toBeNull();
  });

  it("reset() clears all cards and removes the container", () => {
    update(snapshot({ toolCallId: "wf_a" }));
    update(snapshot({ toolCallId: "wf_b" }));
    reset();
    expect(container()).toBeNull();
  });
});
