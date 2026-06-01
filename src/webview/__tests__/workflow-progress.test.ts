// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

function diagEl(): HTMLElement | null {
  return document.getElementById("gsd-wf-diag");
}

describe("workflow diagnostics overlay", () => {
  beforeEach(() => {
    reset();
  });
  afterEach(() => {
    setDiagnostics(false);
    reset();
    document.body.innerHTML = "";
  });

  it("stays absent until explicitly enabled", () => {
    update(snapshot());
    expect(diagEl()).toBeNull();
  });

  it("appears when enabled and counts received messages with the conversation root present", () => {
    document.body.innerHTML = `<main id="messagesContainer"></main>`;
    setDiagnostics(true);
    update(snapshot({ status: "running" }));
    const el = diagEl();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("messages: 1");
    expect(el!.textContent).toContain("conversation: yes");
  });

  it("stays visible and reports conversation: no when the conversation root is absent", () => {
    document.body.innerHTML = "";
    setDiagnostics(true);
    update(snapshot({ status: "launching" }));
    expect(diagEl()).not.toBeNull();
    expect(diagEl()!.textContent).toContain("conversation: no");
  });

  it("accumulates per-status message counts and clears them on reset", () => {
    setDiagnostics(true);
    update(snapshot({ status: "launching" }));
    update(snapshot({ status: "running" }));
    update(snapshot({ status: "completed", runningAgentCount: 0, doneAgentCount: 1 }));
    expect(diagEl()!.textContent).toContain("messages: 3");
    reset();
    expect(diagEl()!.textContent).toContain("messages: 0");
  });

  it("removes the overlay when disabled", () => {
    setDiagnostics(true);
    update(snapshot());
    expect(diagEl()).not.toBeNull();
    setDiagnostics(false);
    expect(diagEl()).toBeNull();
  });
});
