import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WorkflowProgressManager } from "./workflow-progress-poller";

// Drives the REAL manager against a journal that grows on disk over time, with
// real fs and real timers, recording every webview post. This is the coverage
// the suite was missing: the pure-function tests pass even when the live poll
// loop never emits a running frame.

function makeWebview() {
  const posts: any[] = [];
  return {
    posts,
    webview: { postMessage: (m: any) => { posts.push(m); return Promise.resolve(true); } } as any,
  };
}
const output = { appendLine: () => {} } as any;

describe("WorkflowProgressManager live polling (real fs)", () => {
  let dir: string;
  let transcriptDir: string;
  let journalPath: string;
  let endFilePath: string;
  const runId = "wf_testlive01";

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-poll-"));
    transcriptDir = path.join(dir, "sess", "subagents", "workflows", runId);
    fs.mkdirSync(transcriptDir, { recursive: true });
    journalPath = path.join(transcriptDir, "journal.jsonl");
    endFilePath = path.join(dir, "sess", "workflows", `${runId}.json`);
    fs.mkdirSync(path.dirname(endFilePath), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("emits running frames as the journal grows", async () => {
    const { posts, webview } = makeWebview();
    const mgr = new WorkflowProgressManager("s1", webview, output);
    const script = `export const meta = { name: 'live', description: 'd', phases: [{ title: 'A' }] }`;
    mgr.onWorkflowStart("tc1", script);
    const launch = `Workflow launched in background. Task ID: x\nTranscript dir: ${transcriptDir}\nRun ID: ${runId}\n`;
    mgr.onWorkflowEnd("tc1", launch);

    await sleep(300); // immediate first tick

    fs.writeFileSync(journalPath, JSON.stringify({ type: "started", agentId: "a1" }) + "\n");
    await sleep(2200);
    fs.appendFileSync(journalPath, JSON.stringify({ type: "started", agentId: "a2" }) + "\n");
    await sleep(2200);
    fs.appendFileSync(journalPath, JSON.stringify({ type: "result", agentId: "a1" }) + "\n");
    await sleep(2200);

    mgr.dispose();

    const summary = posts.map((p) => ({
      status: p.data.status,
      run: p.data.runningAgentCount,
      done: p.data.doneAgentCount,
    }));

    // The launch frame alone is not enough — the live poll loop must emit
    // running frames as the journal grows. A regression that stops the poller
    // (e.g. a launch-parse failure) leaves only the launching/completed frames,
    // which is exactly the "nothing until turn end" symptom this guards against.
    const runningFrames = posts.filter((p) => p.data.status === "running");
    expect(runningFrames.length, `posts=${JSON.stringify(summary)}`).toBeGreaterThan(1);
    // It must observe agents starting (runningAgentCount climbs above 0)…
    expect(Math.max(...posts.map((p) => p.data.runningAgentCount))).toBeGreaterThan(0);
    // …and an agent finishing (a result event lands).
    expect(Math.max(...posts.map((p) => p.data.doneAgentCount))).toBeGreaterThan(0);
    // Real timers + a 2s poll interval: the scenario drives ~7s of wall-clock
    // sleeps to span multiple ticks, so it needs a timeout well above vitest's
    // 5s default — otherwise it times out before the journal-growth frames land.
  }, 20_000);
});
