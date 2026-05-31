import { describe, it, expect } from "vitest";
import * as path from "path";
import {
  parseWorkflowScript,
  parseWorkflowLaunch,
  deriveWorkflowPaths,
  parseJournalLines,
  parseWorkflowEndFile,
  buildAgentRows,
  decideLiveWorkflowStatus,
  type ParsedWorkflowPlan,
} from "./workflow-progress";

// Real script text captured from a live Workflow run (workflow-events-results.json).
const REAL_SCRIPT = `export const meta = {
  name: 'two-ok-agents',
  description: 'Run two agents that each return the word ok',
  phases: [
    { title: 'First' },
    { title: 'Second' },
  ],
}

phase('First')
const a = await agent('Return only the single word: ok', { label: 'first', phase: 'First' })
phase('Second')
const b = await agent('Return only the single word: ok', { label: 'second', phase: 'Second' })
return { a, b }
`;

// Real "launched in background" result text (paths shortened but structurally identical).
const REAL_LAUNCH = `Workflow launched in background. Task ID: wdqnq4w7q
Summary: Run two agents that each return the word ok
Transcript dir: C:\\Users\\K\\proj\\f991c5ce\\subagents\\workflows\\wf_c2b92968-f6f
Script file: C:\\Users\\K\\proj\\f991c5ce\\workflows\\scripts\\two-ok-agents-wf_c2b92968-f6f.js
Run ID: wf_c2b92968-f6f
You will be notified when it completes. Use /workflows to watch live progress.`;

describe("parseWorkflowScript", () => {
  it("extracts name, description, phases, and labelled agents in order", () => {
    const plan = parseWorkflowScript(REAL_SCRIPT);
    expect(plan.name).toBe("two-ok-agents");
    expect(plan.description).toBe("Run two agents that each return the word ok");
    expect(plan.phases).toEqual(["First", "Second"]);
    expect(plan.agents).toEqual([
      { label: "first", phase: "First" },
      { label: "second", phase: "Second" },
    ]);
  });

  it("captures agents declared inline in a parallel/map fan-out", () => {
    const script = `export const meta = { name: 'review', phases: [{ title: 'Find' }] }
const dims = ['bugs','perf'];
await parallel(dims.map(d => () => agent('check ' + d, { label: 'review:' + d, phase: 'Find', schema: S })));
const x = await agent('synth', { label: 'synthesize', phase: 'Find' });`;
    const plan = parseWorkflowScript(script);
    expect(plan.name).toBe("review");
    expect(plan.phases).toEqual(["Find"]);
    // Computed labels ('review:' + d) have no string literal and are not captured;
    // the literal 'synthesize' label is.
    expect(plan.agents).toEqual([{ label: "synthesize", phase: "Find" }]);
  });

  it("degrades gracefully on an unparseable script", () => {
    const plan = parseWorkflowScript("not a workflow");
    expect(plan.name).toBe("workflow");
    expect(plan.phases).toEqual([]);
    expect(plan.agents).toEqual([]);
  });
});

describe("parseWorkflowLaunch", () => {
  it("extracts runId, transcript dir, and script path", () => {
    const info = parseWorkflowLaunch(REAL_LAUNCH);
    expect(info).not.toBeNull();
    expect(info!.runId).toBe("wf_c2b92968-f6f");
    expect(info!.transcriptDir).toBe("C:\\Users\\K\\proj\\f991c5ce\\subagents\\workflows\\wf_c2b92968-f6f");
    expect(info!.scriptPath).toContain("two-ok-agents-wf_c2b92968-f6f.js");
  });

  it("returns null when the text is not a launch result", () => {
    expect(parseWorkflowLaunch("some other tool output")).toBeNull();
  });
});

describe("deriveWorkflowPaths", () => {
  it("derives journal + end-file paths from the transcript dir", () => {
    // Build platform-correct input so dirname logic is exercised cross-platform.
    const projectDir = path.join("root", "proj", "f991c5ce");
    const runId = "wf_abc";
    const transcriptDir = path.join(projectDir, "subagents", "workflows", runId);
    const { journalPath, endFilePath } = deriveWorkflowPaths(transcriptDir, runId);
    expect(journalPath).toBe(path.join(transcriptDir, "journal.jsonl"));
    expect(endFilePath).toBe(path.join(projectDir, "workflows", "wf_abc.json"));
  });
});

describe("parseJournalLines", () => {
  it("recognizes started/result keyed by agentId", () => {
    const content = [
      JSON.stringify({ started: true, agentId: "a1", label: "first", phase: "First" }),
      JSON.stringify({ started: true, agentId: "a2", label: "second" }),
      JSON.stringify({ result: "ok", agentId: "a1" }),
    ].join("\n");
    const { agents, lineCount } = parseJournalLines(content);
    expect(lineCount).toBe(3);
    expect(agents.get("a1")).toMatchObject({ state: "done", label: "first", phase: "First" });
    expect(agents.get("a2")).toMatchObject({ state: "running", label: "second" });
  });

  it("recognizes type/event discriminators and errors", () => {
    const content = [
      JSON.stringify({ type: "agent_start", agentId: "x" }),
      JSON.stringify({ type: "agent_end", agentId: "x", tokens: 100, toolCalls: 2 }),
      JSON.stringify({ event: "error", agentId: "y", error: "boom" }),
    ].join("\n");
    const { agents } = parseJournalLines(content);
    expect(agents.get("x")).toMatchObject({ state: "done", tokens: 100, toolCalls: 2 });
    expect(agents.get("y")).toMatchObject({ state: "error" });
  });

  it("collects log lines and skips garbage without throwing", () => {
    const content = [
      `{ broken json`,
      JSON.stringify({ log: "starting phase Find" }),
      "",
      JSON.stringify({ started: true, agentId: "a1" }),
    ].join("\n");
    const { agents, logs, lineCount } = parseJournalLines(content);
    expect(logs).toEqual(["starting phase Find"]);
    expect(agents.get("a1")?.state).toBe("running");
    expect(lineCount).toBe(2); // the two valid JSON lines (log + started)
  });
});

describe("parseWorkflowEndFile", () => {
  it("parses the captured end-file shape", () => {
    // Shape from workflow-liveness-results.json.
    const content = JSON.stringify({
      status: "completed",
      agents: [
        { label: "red", state: "done", tokens: 20525, toolCalls: 0 },
        { label: "blue", state: "done", tokens: 20526, toolCalls: 0 },
      ],
    });
    const end = parseWorkflowEndFile(content);
    expect(end).not.toBeNull();
    expect(end!.status).toBe("completed");
    expect(end!.agents).toHaveLength(2);
    expect(end!.agents[0]).toMatchObject({ label: "red", state: "done", tokens: 20525 });
  });

  it("returns null on corrupt content", () => {
    expect(parseWorkflowEndFile("{ not json")).toBeNull();
    expect(parseWorkflowEndFile(JSON.stringify({ noAgents: true }))).toBeNull();
  });
});

describe("decideLiveWorkflowStatus", () => {
  const base = { staleThresholdMs: 45_000 };

  it("stays running while the journal is still growing", () => {
    const d = decideLiveWorkflowStatus({
      ...base, sawActivity: true, quietForMs: 1_000, runningAgentCount: 1, doneAgentCount: 1,
    });
    expect(d).toEqual({ status: "running", stale: false, settled: false });
  });

  it("treats a quiet journal with nothing in flight as completed, not hung", () => {
    // The exact bug: a finished run's journal goes silent and was mislabelled
    // "stalled". With all agents terminal it must read completed + settle.
    const d = decideLiveWorkflowStatus({
      ...base, sawActivity: true, quietForMs: 60_000, runningAgentCount: 0, doneAgentCount: 4,
    });
    expect(d).toEqual({ status: "completed", stale: false, settled: true });
  });

  it("flags a genuine stall only when an agent is still mid-flight", () => {
    const d = decideLiveWorkflowStatus({
      ...base, sawActivity: true, quietForMs: 60_000, runningAgentCount: 1, doneAgentCount: 2,
    });
    expect(d).toEqual({ status: "stalled", stale: true, settled: false });
  });

  it("holds at running before any journal activity is seen (no fake completion or hang)", () => {
    const d = decideLiveWorkflowStatus({
      ...base, sawActivity: false, quietForMs: 60_000, runningAgentCount: 0, doneAgentCount: 0,
    });
    expect(d).toEqual({ status: "running", stale: false, settled: false });
  });

  it("reports completed but keeps polling when the journal schema yields no agent states", () => {
    // Quiet + activity seen but zero recognized terminal agents (unknown schema):
    // show completed (don't cry hung) yet do not settle, so the authoritative
    // end-file can still be picked up.
    const d = decideLiveWorkflowStatus({
      ...base, sawActivity: true, quietForMs: 60_000, runningAgentCount: 0, doneAgentCount: 0,
    });
    expect(d).toEqual({ status: "completed", stale: false, settled: false });
  });
});

describe("buildAgentRows", () => {
  const plan: ParsedWorkflowPlan = {
    name: "wf",
    phases: ["First", "Second"],
    agents: [
      { label: "first", phase: "First" },
      { label: "second", phase: "Second" },
    ],
  };

  it("returns all planned agents pending when there is no disk data yet", () => {
    const { agents, doneAgentCount, runningAgentCount } = buildAgentRows(plan, null, null);
    expect(agents.map((a) => a.state)).toEqual(["pending", "pending"]);
    expect(doneAgentCount).toBe(0);
    expect(runningAgentCount).toBe(0);
  });

  it("overlays journal state by dispatch order when labels are absent", () => {
    const journal = parseJournalLines([
      JSON.stringify({ started: true, agentId: "anon-1" }),
      JSON.stringify({ result: "ok", agentId: "anon-1" }),
      JSON.stringify({ started: true, agentId: "anon-2" }),
    ].join("\n"));
    const { agents, doneAgentCount, runningAgentCount } = buildAgentRows(plan, journal, null);
    expect(agents[0]).toMatchObject({ label: "first", state: "done" });
    expect(agents[1]).toMatchObject({ label: "second", state: "running" });
    expect(doneAgentCount).toBe(1);
    expect(runningAgentCount).toBe(1);
  });

  it("matches journal agents to planned rows by label when present", () => {
    const journal = parseJournalLines([
      JSON.stringify({ started: true, agentId: "id", label: "second" }),
      JSON.stringify({ result: "ok", agentId: "id", label: "second" }),
    ].join("\n"));
    const { agents } = buildAgentRows(plan, journal, null);
    expect(agents.find((a) => a.label === "second")?.state).toBe("done");
    expect(agents.find((a) => a.label === "first")?.state).toBe("pending");
  });

  it("does not let a labeled journal entry clobber an already-matched row by dispatch order", () => {
    // "second" matches a planned row by label; "ghost" has a label not in the
    // plan — it must NOT fall back to dispatch-order binding (which would have
    // overwritten the "first" row), since order-binding is for unlabeled entries.
    const journal = parseJournalLines([
      JSON.stringify({ started: true, agentId: "id-second", label: "second" }),
      JSON.stringify({ result: "ok", agentId: "id-second", label: "second" }),
      JSON.stringify({ started: true, agentId: "id-ghost", label: "ghost" }),
    ].join("\n"));
    const { agents } = buildAgentRows(plan, journal, null);
    expect(agents.find((a) => a.label === "first")?.state).toBe("pending");
    expect(agents.find((a) => a.label === "second")?.state).toBe("done");
    // The unmatched labeled entry appears as its own appended row.
    expect(agents.find((a) => a.label === "ghost")?.state).toBe("running");
  });

  it("treats the end-file as authoritative", () => {
    const end = parseWorkflowEndFile(JSON.stringify({
      status: "completed",
      agents: [
        { label: "first", state: "done", tokens: 10 },
        { label: "second", state: "done", tokens: 20 },
      ],
    }));
    const { agents, doneAgentCount } = buildAgentRows(plan, null, end);
    expect(doneAgentCount).toBe(2);
    expect(agents[0]).toMatchObject({ label: "first", phase: "First", tokens: 10 });
  });
});
