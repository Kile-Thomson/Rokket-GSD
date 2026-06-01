// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { update, reset, setDiagnostics, buildPanelHtml } from "../workflow-progress";
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

describe("buildPanelHtml agent token formatting", () => {
  it("keeps one decimal through 100k so near-identical agents read as distinct", () => {
    // Real fan-out agents land at e.g. 14649 / 14724 — whole-k rounding would
    // collapse both to a flat, fake-looking "15k". One decimal surfaces the diff.
    const html = buildPanelHtml(
      snapshot({
        status: "completed",
        agents: [
          { label: "a", state: "done", tokens: 14649, toolCalls: 0 },
          { label: "b", state: "done", tokens: 14724, toolCalls: 0 },
        ],
      }),
    );
    expect(html).toContain("14.6k tok");
    expect(html).toContain("14.7k tok");
    expect(html).not.toContain("15k tok");
  });

  it("renders a genuine zero tool count rather than hiding it", () => {
    const html = buildPanelHtml(
      snapshot({ status: "completed", agents: [{ label: "a", state: "done", tokens: 14650, toolCalls: 0 }] }),
    );
    expect(html).toContain("0 tools");
  });
});
