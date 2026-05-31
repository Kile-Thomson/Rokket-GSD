import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: undefined } }));

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  captureRpcEvent,
  flushWorkflowEventCapture,
  __resetWorkflowEventCaptureForTests,
  __getWorkflowEventCaptureState,
} from "./workflow-event-capture";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wf-capture-"));
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const debugFileFor = (cwd: string) => path.join(cwd, ".gsd", "runtime", "workflow-events-debug.jsonl");

describe("workflow-event-capture", () => {
  let cwd: string;
  let output: { lines: string[]; appendLine(l: string): void };

  beforeEach(() => {
    __resetWorkflowEventCaptureForTests();
    cwd = makeTmpDir();
    output = { lines: [], appendLine(l: string) { this.lines.push(l); } };
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("writes one disk sample per distinct event type, regardless of volume", () => {
    captureRpcEvent({ type: "task_progress", agent: "a" }, output, cwd);
    captureRpcEvent({ type: "task_progress", agent: "b" }, output, cwd);
    captureRpcEvent({ type: "task_progress", agent: "c" }, output, cwd);
    captureRpcEvent({ type: "agent_start" }, output, cwd);

    const rows = readJsonl(debugFileFor(cwd));
    const samples = rows.filter((r) => r.kind === "sample");
    expect(samples.map((s) => s.type).sort()).toEqual(["agent_start", "task_progress"]);
    // First sighting is captured — the sample is the first event's payload.
    const tp = samples.find((s) => s.type === "task_progress")!;
    expect((tp.sample as Record<string, unknown>).agent).toBe("a");
  });

  it("counts every sighting and flushes a sorted summary", () => {
    for (let i = 0; i < 5; i++) captureRpcEvent({ type: "task_progress" }, output, cwd);
    captureRpcEvent({ type: "agent_end" }, output, cwd);

    const state = __getWorkflowEventCaptureState();
    expect(state.counts).toEqual({ task_progress: 5, agent_end: 1 });

    flushWorkflowEventCapture(output, cwd);
    const summary = readJsonl(debugFileFor(cwd)).find((r) => r.kind === "summary")!;
    // Sorted by frequency descending — first key is the most frequent type.
    expect(Object.keys(summary.counts as object)[0]).toBe("task_progress");
    expect(output.lines.some((l) => l.includes("event counts"))).toBe(true);
  });

  it("handles events with no type field without throwing", () => {
    expect(() => captureRpcEvent({} as Record<string, unknown>, output, cwd)).not.toThrow();
    expect(__getWorkflowEventCaptureState().counts["<no-type>"]).toBe(1);
  });

  it("truncates oversized samples", () => {
    const big = "x".repeat(20000);
    captureRpcEvent({ type: "huge", blob: big }, output, cwd);
    const sample = readJsonl(debugFileFor(cwd)).find((r) => r.kind === "sample")!.sample as Record<string, unknown>;
    expect(sample.__truncated).toBe(true);
    expect(typeof sample.preview).toBe("string");
  });

  it("does not write a summary when nothing was captured", () => {
    flushWorkflowEventCapture(output, cwd);
    expect(fs.existsSync(debugFileFor(cwd))).toBe(false);
  });
});
