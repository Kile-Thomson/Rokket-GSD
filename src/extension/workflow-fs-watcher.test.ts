import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// The watcher reads gsd.workflowLivePanel at runtime; the mock's get() must
// honor the supplied default (true) so the panel is enabled during the test.
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({ get: (_key: string, def?: unknown) => def }),
  },
}));

import { WorkflowFsWatcher } from "./workflow-fs-watcher";
import type { ExtensionToWebviewMessage, WorkflowProgressData } from "../shared/types";

// Drive the REAL watcher against a REAL temp filesystem. The whole point: this
// proves the live path (discover run dir -> tail journal -> post running ->
// finalize from end-file -> retract) actually works, not just that pure helpers
// parse. Earlier rounds of this feature stayed green while the live feature was
// dead because the tests never touched disk.

interface TestHandle {
  watcher: WorkflowFsWatcher;
  posts: ExtensionToWebviewMessage[];
  journalPath: string;
  endFilePath: string;
  /** Force the next tick to treat the run as eligible / ancient. */
  setStartedAt(ms: number): void;
  tick(): Promise<void>;
  setDismissReady(runId: string): void;
}

const CWD = "g:\\Dropbox\\Rocket Social\\Rokketek\\Software\\RokketGSD - VS Code Plugin\\gsd-vscode";
const CONV = "conv-uuid-1234";
const RUN_ID = "wf_abc123def";

let tmp: string;
let prevEnv: string | undefined;

const livePosts = (posts: ExtensionToWebviewMessage[]): WorkflowProgressData[] =>
  posts.filter((m) => m.type === "workflow_live").map((m) => (m as { data: WorkflowProgressData }).data);

function makeHandle(): TestHandle {
  const slug = WorkflowFsWatcher.slugFor(CWD);
  const runDir = path.join(tmp, "projects", slug, CONV, "subagents", "workflows", RUN_ID);
  const scriptsDir = path.join(tmp, "projects", slug, CONV, "workflows", "scripts");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, `demo-${RUN_ID}.js`),
    `export const meta = { name: 'demo', phases: [{ title: 'A' }] }\n` +
      `agent('do alpha', { label: 'alpha', phase: 'A' })\n` +
      `agent('do beta', { label: 'beta', phase: 'A' })\n`,
  );
  const journalPath = path.join(runDir, "journal.jsonl");
  const endFilePath = path.join(tmp, "projects", slug, CONV, "workflows", `${RUN_ID}.json`);

  const posts: ExtensionToWebviewMessage[] = [];
  const webview = {
    postMessage: (m: ExtensionToWebviewMessage) => {
      posts.push(m);
      return Promise.resolve(true);
    },
  };
  const output = { appendLine: () => {} };

  const watcher = new WorkflowFsWatcher("s1", webview as never, output as never, CWD);
  const internals = watcher as unknown as {
    startedAt: number;
    tick(): Promise<void>;
    runs: Map<string, { dismissAt?: number; finished: boolean }>;
  };
  internals.startedAt = Date.now();

  return {
    watcher,
    posts,
    journalPath,
    endFilePath,
    setStartedAt: (ms) => { internals.startedAt = ms; },
    tick: () => internals.tick(),
    setDismissReady: (runId) => {
      const r = internals.runs.get(runId);
      if (r) r.dismissAt = Date.now() - 1;
    },
  };
}

beforeEach(() => {
  prevEnv = process.env.CLAUDE_CONFIG_DIR;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-watch-"));
  process.env.CLAUDE_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevEnv;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("WorkflowFsWatcher.slugFor", () => {
  it("encodes a Windows cwd the way Claude Code names its transcript dir", () => {
    expect(WorkflowFsWatcher.slugFor(CWD)).toBe(
      "g--Dropbox-Rocket-Social-Rokketek-Software-RokketGSD---VS-Code-Plugin-gsd-vscode",
    );
  });

  it("maps each non-alphanumeric character to its own dash", () => {
    expect(WorkflowFsWatcher.slugFor("/Users/me/proj.x")).toBe("-Users-me-proj-x");
  });
});

describe("WorkflowFsWatcher live discovery", () => {
  it("surfaces a running workflow from its growing journal, with script labels", async () => {
    const h = makeHandle();
    fs.writeFileSync(h.journalPath, JSON.stringify({ type: "started", agentId: "a1", label: "alpha" }) + "\n");

    await h.tick();

    const live = livePosts(h.posts);
    expect(live.length).toBeGreaterThan(0);
    const snap = live[live.length - 1];
    expect(snap.toolCallId).toBe(RUN_ID);
    expect(snap.name).toBe("demo");
    expect(snap.phases).toEqual(["A"]);
    expect(snap.status).toBe("running");
    expect(snap.plannedAgentCount).toBe(2);
    // alpha is mid-flight, beta is still planned/pending.
    const alpha = snap.agents.find((a) => a.label === "alpha");
    const beta = snap.agents.find((a) => a.label === "beta");
    expect(alpha?.state).toBe("running");
    expect(beta?.state).toBe("pending");
    expect(snap.runningAgentCount).toBe(1);
  });

  it("advances agent state as the journal grows", async () => {
    const h = makeHandle();
    fs.writeFileSync(h.journalPath, JSON.stringify({ type: "started", agentId: "a1", label: "alpha" }) + "\n");
    await h.tick();

    fs.appendFileSync(h.journalPath, JSON.stringify({ type: "result", agentId: "a1" }) + "\n");
    fs.appendFileSync(h.journalPath, JSON.stringify({ type: "started", agentId: "b1", label: "beta" }) + "\n");
    await h.tick();

    const snap = livePosts(h.posts).at(-1)!;
    expect(snap.agents.find((a) => a.label === "alpha")?.state).toBe("done");
    expect(snap.agents.find((a) => a.label === "beta")?.state).toBe("running");
    expect(snap.doneAgentCount).toBe(1);
    expect(snap.runningAgentCount).toBe(1);
  });

  it("finalizes from the end-file then retracts the card after the grace period", async () => {
    const h = makeHandle();
    fs.writeFileSync(h.journalPath, JSON.stringify({ type: "started", agentId: "a1", label: "alpha" }) + "\n");
    await h.tick();

    fs.writeFileSync(
      h.endFilePath,
      JSON.stringify({
        status: "completed",
        workflowProgress: [
          { type: "workflow_agent", label: "alpha", state: "done", tokens: 1200, toolCalls: 3, durationMs: 4000 },
          { type: "workflow_agent", label: "beta", state: "done", tokens: 800, toolCalls: 1, durationMs: 2500 },
        ],
      }),
    );
    await h.tick();

    const completed = livePosts(h.posts).at(-1)!;
    expect(completed.status).toBe("completed");
    expect(completed.doneAgentCount).toBe(2);
    expect(completed.agents.find((a) => a.label === "alpha")?.tokens).toBe(1200);

    // After the dismiss grace elapses, the next tick retracts the card.
    h.setDismissReady(RUN_ID);
    await h.tick();
    const removed = h.posts.filter((m) => m.type === "workflow_live_remove");
    expect(removed).toEqual([{ type: "workflow_live_remove", runId: RUN_ID }]);
  });

  it("ignores pre-existing runs whose journal predates the watcher start", async () => {
    const h = makeHandle();
    fs.writeFileSync(h.journalPath, JSON.stringify({ type: "started", agentId: "a1", label: "alpha" }) + "\n");
    // Pretend the watcher started long after this journal was last written.
    h.setStartedAt(Date.now() + 10 * 60_000);

    await h.tick();

    expect(livePosts(h.posts)).toHaveLength(0);
  });

  it("replays the last snapshot to a rebound webview (sidebar hide/show)", async () => {
    const h = makeHandle();
    fs.writeFileSync(
      h.endFilePath,
      JSON.stringify({
        status: "completed",
        workflowProgress: [
          { type: "workflow_agent", label: "alpha", state: "done", tokens: 1200, toolCalls: 3, durationMs: 4000 },
        ],
      }),
    );
    fs.writeFileSync(h.journalPath, JSON.stringify({ type: "started", agentId: "a1", label: "alpha" }) + "\n");
    await h.tick();
    expect(livePosts(h.posts).at(-1)!.status).toBe("completed");

    // Sidebar re-resolves: a brand-new webview, nothing rendered yet.
    const replayed: ExtensionToWebviewMessage[] = [];
    h.watcher.rebindWebview({
      postMessage: (m: ExtensionToWebviewMessage) => { replayed.push(m); return Promise.resolve(true); },
    } as never);

    const snap = livePosts(replayed).at(-1)!;
    expect(snap.toolCallId).toBe(RUN_ID);
    expect(snap.status).toBe("completed");
    expect(snap.agents.find((a) => a.label === "alpha")?.tokens).toBe(1200);
  });

  it("retracts visible cards when the process exits", async () => {
    const h = makeHandle();
    fs.writeFileSync(h.journalPath, JSON.stringify({ type: "started", agentId: "a1", label: "alpha" }) + "\n");
    await h.tick();
    expect(livePosts(h.posts).length).toBeGreaterThan(0);

    h.watcher.onProcessExit();
    const removed = h.posts.filter((m) => m.type === "workflow_live_remove");
    expect(removed).toEqual([{ type: "workflow_live_remove", runId: RUN_ID }]);
  });
});
