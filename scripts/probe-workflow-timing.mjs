#!/usr/bin/env node
// ============================================================
// probe-workflow-timing.mjs — does the runtime expose a workflow run at
// LAUNCH or only at COMPLETION?
// ============================================================
//
// The fast 2-agent capture (capture-workflow-events.mjs) can't answer this: it
// kills the process 4s after `execution_complete`, which fires at TURN end —
// before the background agents finish. This probe instead:
//
//   1. Timestamps every RPC frame (ms since the prompt was sent).
//   2. Runs a deliberately LONGER workflow (multiple phases, several agents) so
//      launch and completion are seconds apart, not simultaneous.
//   3. Keeps recording past turn_end, watching the on-disk run artifacts
//      (subagents/workflows/<runId>/journal.jsonl and workflows/<runId>.json)
//      and timestamping when each appears/grows.
//   4. Finishes only when the end-file is written (+grace) or a hard timeout.
//
// The decisive comparison in the output:
//   - tEnd  = timestamp of tool_execution_end(Workflow)
//   - tJournalFirst / tJournalLastGrowth = live journal activity window
//   - tEndFile = end-file written (background work truly done)
//
// If tEnd ≈ tEndFile  → the extension only learns the run dir at completion;
//                       live in-repo polling via onWorkflowEnd is impossible.
// If tEnd ≪ tEndFile  → the run dir is known at launch; the journal is written
//                       live in a window the extension's poller could observe,
//                       so the live-progress bug is delivery-side, not timing.
//
// Output: scripts/workflow-timing-results.json (gitignored: scripts/*-results.json)

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "workflow-timing-results.json");
const HARD_TIMEOUT_MS = 300_000;

function resolveGsd() {
  const isWin = process.platform === "win32";
  const finder = isWin ? "where" : "which";
  const candidates = isWin ? ["gsd.cmd", "gsd"] : ["gsd"];
  for (const c of candidates) {
    const r = spawnSync(finder, [c], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) {
      const first = r.stdout.trim().split(/\r?\n/)[0];
      if (first.toLowerCase().endsWith(".cmd")) {
        const loader = path.join(path.dirname(first), "node_modules", "@opengsd", "gsd-pi", "dist", "loader.js");
        if (fs.existsSync(loader)) return { command: process.execPath, args: [loader], useShell: false };
        return { command: first, args: [], useShell: isWin };
      }
      return { command: first, args: [], useShell: false };
    }
  }
  return { command: "gsd", args: [], useShell: isWin };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-wf-timing-"));
const { command, args: gsdArgs, useShell } = resolveGsd();
console.error(`[probe] spawning: ${command} ${gsdArgs.join(" ")} --mode rpc   (cwd=${cwd})`);

const child = spawn(command, [...gsdArgs, "--mode", "rpc"], {
  cwd,
  env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", GSD_IDE: "1" },
  stdio: ["pipe", "pipe", "pipe"],
  shell: useShell,
  windowsHide: true,
});

let t0 = Date.now(); // reset when the prompt is sent
const rel = () => Date.now() - t0;
const timeline = []; // { t, kind, detail }
const counts = new Map();
let toolStartArgs = null;
let toolEndResult = null;
let buffer = "";
let nextId = 1;
const pending = new Map();

function send(obj) {
  const id = String(nextId++);
  child.stdin.write(JSON.stringify({ ...obj, id }) + "\n");
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ __timeout: true }); } }, 120_000);
  });
}

function mark(kind, detail) {
  timeline.push({ t: rel(), kind, detail });
  console.error(`[probe] +${rel()}ms  ${kind}${detail ? "  " + detail : ""}`);
}

function handle(msg) {
  if (msg.type === "response" && msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  const type = typeof msg?.type === "string" ? msg.type : "<no-type>";
  counts.set(type, (counts.get(type) ?? 0) + 1);

  if (type === "tool_execution_start" && msg.toolName === "Workflow") {
    toolStartArgs = msg.args ?? null;
    mark("tool_execution_start(Workflow)", `scriptBytes=${typeof msg.args?.script === "string" ? msg.args.script.length : "?"}`);
  } else if (type === "tool_execution_end" && msg.toolName === "Workflow") {
    toolEndResult = msg.result ?? null;
    const txt = JSON.stringify(msg.result ?? "");
    mark("tool_execution_end(Workflow)", `resultBytes=${txt.length}`);
  } else if (type === "turn_end") {
    mark("turn_end");
  } else if (type === "execution_complete") {
    mark("execution_complete");
  } else if (type === "agent_end") {
    mark("agent_end");
  }
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    let line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch { /* ignore non-JSON */ }
  }
});

let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
child.on("exit", (code) => { mark("process_exit", `code=${code}`); finish(); });

// --- filesystem watcher: when does the run dir / journal / end-file appear? ---
const fsState = { runDir: null, journalPath: null, endFilePath: null, journalFirstSize: null, journalLastSize: 0 };
function scanFs() {
  try {
    const wfRoot = path.join(cwd, "subagents", "workflows");
    if (!fsState.runDir && fs.existsSync(wfRoot)) {
      const dirs = fs.readdirSync(wfRoot).filter((d) => d.startsWith("wf_"));
      if (dirs.length) {
        fsState.runDir = path.join(wfRoot, dirs[0]);
        fsState.journalPath = path.join(fsState.runDir, "journal.jsonl");
        mark("FS: run dir created", dirs[0]);
      }
    }
    if (fsState.journalPath && fs.existsSync(fsState.journalPath)) {
      const sz = fs.statSync(fsState.journalPath).size;
      if (fsState.journalFirstSize === null) { fsState.journalFirstSize = sz; mark("FS: journal first seen", `${sz}B`); }
      if (sz > fsState.journalLastSize) { fsState.journalLastSize = sz; mark("FS: journal grew", `${sz}B`); }
    }
    const runId = fsState.runDir ? path.basename(fsState.runDir) : null;
    if (runId && !fsState.endFilePath) {
      const ef = path.join(cwd, "workflows", `${runId}.json`);
      if (fs.existsSync(ef)) {
        fsState.endFilePath = ef;
        mark("FS: END-FILE written", `${fs.statSync(ef).size}B`);
        setTimeout(finish, 6000); // grace for trailing frames, then stop
      }
    }
  } catch (e) { /* ignore races */ }
}
const fsTimer = setInterval(scanFs, 400);

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  clearInterval(fsTimer);
  const ev = (k) => timeline.find((e) => e.kind.startsWith(k))?.t ?? null;
  const summary = {
    tToolStart: ev("tool_execution_start(Workflow)"),
    tToolEnd: ev("tool_execution_end(Workflow)"),
    tTurnEnd: ev("turn_end"),
    tExecutionComplete: ev("execution_complete"),
    tAgentEnd: ev("agent_end"),
    tRunDirCreated: ev("FS: run dir created"),
    tJournalFirst: ev("FS: journal first seen"),
    tJournalLastGrowth: [...timeline].reverse().find((e) => e.kind === "FS: journal grew")?.t ?? null,
    tEndFile: ev("FS: END-FILE written"),
  };
  const verdict =
    summary.tToolEnd != null && summary.tEndFile != null
      ? (summary.tEndFile - summary.tToolEnd > 5000
          ? "tool_execution_end fires at LAUNCH (run dir known early; live polling possible in-repo)"
          : "tool_execution_end fires at/near COMPLETION (extension only learns run dir when done)")
      : "inconclusive — missing tToolEnd or tEndFile";
  const result = {
    capturedAt: new Date().toISOString(),
    summary,
    verdict,
    counts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
    timeline,
    toolEndResultSample: typeof toolEndResult === "object" ? JSON.stringify(toolEndResult).slice(0, 2000) : String(toolEndResult).slice(0, 2000),
    cwd,
    stderrTail: stderr.slice(-1500),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.error(`\n[probe] VERDICT: ${verdict}`);
  console.error(`[probe] summary: ${JSON.stringify(summary)}`);
  console.error(`[probe] wrote ${OUT_FILE}`);
  try { child.stdin.write(JSON.stringify({ type: "shutdown", id: String(nextId++) }) + "\n"); } catch { /* */ }
  setTimeout(() => { try { child.kill(); } catch { /* */ } process.exit(0); }, 1500);
}

setTimeout(() => { mark("hard_timeout"); finish(); }, HARD_TIMEOUT_MS);

// A workflow long enough that launch and completion are clearly separated.
const WORKFLOW_PROMPT = [
  "Run the Workflow tool RIGHT NOW. Build a workflow with THREE phases, each",
  "phase running THREE agents (nine agents total), pipelined so they run over",
  "many seconds. Each agent's task: write one short haiku about its phase and",
  "return it. Do NOT read or write any files yourself. Do NOT take any other",
  "action before or after launching the workflow. After it returns, reply 'done'.",
].join(" ");

(async () => {
  const init = await send({ type: "init", protocolVersion: 2 });
  console.error(`[probe] init: ${JSON.stringify(init).slice(0, 200)}`);
  await send({ type: "subscribe", events: ["*"] });
  console.error("[probe] subscribed; sending workflow prompt…");
  t0 = Date.now();
  await send({ type: "prompt", message: WORKFLOW_PROMPT });
})();
