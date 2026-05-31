#!/usr/bin/env node
// ============================================================
// probe-workflow-liveness.mjs — does workflows/wf_<id>.json update live?
// ============================================================
//
// Launches one workflow via `gsd --mode rpc`, parses the launch result for the
// run's state-file path, then polls that file every 300ms — recording each
// distinct (status + per-agent state) snapshot. If we see agents transition
// queued → running → done across snapshots, the file is a LIVE producer and an
// in-repo poller can render real-time per-agent progress. If every snapshot is
// already "completed", it's written only at the end (not usable for live view).
//
// Output: scripts/workflow-liveness-results.json (gitignored: scripts/*-results.json)

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "workflow-liveness-results.json");
const HARD_TIMEOUT_MS = 240_000;

function resolveGsd() {
  const isWin = process.platform === "win32";
  const finder = isWin ? "where" : "which";
  for (const c of isWin ? ["gsd.cmd", "gsd"] : ["gsd"]) {
    const r = spawnSync(finder, [c], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) {
      const first = r.stdout.trim().split(/\r?\n/)[0];
      if (first.toLowerCase().endsWith(".cmd")) {
        const loader = path.join(path.dirname(first), "node_modules", "@opengsd", "gsd-pi", "dist", "loader.js");
        if (fs.existsSync(loader)) return { command: process.execPath, args: [loader], useShell: false };
        // .cmd shim without a resolvable loader — Node can't exec a .cmd directly,
        // so fall back to the shell on Windows.
        return { command: first, args: [], useShell: isWin };
      }
      return { command: first, args: [], useShell: false };
    }
  }
  return { command: "gsd", args: [], useShell: isWin };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-wf-probe-"));
const { command, args: gsdArgs, useShell } = resolveGsd();
const child = spawn(command, [...gsdArgs, "--mode", "rpc"], {
  cwd, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", GSD_IDE: "1" },
  stdio: ["pipe", "pipe", "pipe"], shell: useShell, windowsHide: true,
});

let buffer = "", nextId = 1, stateFile = null, pollTimer = null;
const pending = new Map();
const snapshots = []; // {at, status, agents:[{label,state,tokens,toolCalls}]}
let lastSig = "";

function send(obj) {
  const id = String(nextId++);
  child.stdin.write(JSON.stringify({ ...obj, id }) + "\n");
  return new Promise((res) => { pending.set(id, res); setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ __timeout: true }); } }, 60_000); });
}

function deriveStateFile(text) {
  // launch result contains: 'Script file: <...>\workflows\scripts\<name>-<runId>.js' and 'Run ID: <runId>'
  const runId = (text.match(/Run ID:\s*(\S+)/) || [])[1];
  const scriptPath = (text.match(/Script file:\s*(.+\.js)/) || [])[1];
  if (scriptPath && runId) {
    const scriptsDir = path.dirname(scriptPath.trim());        // .../workflows/scripts
    const workflowsDir = path.dirname(scriptsDir);             // .../workflows
    return path.join(workflowsDir, `${runId}.json`);
  }
  return null;
}

function pollOnce() {
  if (!stateFile || !fs.existsSync(stateFile)) return;
  try {
    const data = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const agents = (data.workflowProgress || [])
      .filter((p) => p.type === "workflow_agent")
      .map((p) => ({ label: p.label, state: p.state, tokens: p.tokens, toolCalls: p.toolCalls }));
    const sig = JSON.stringify({ status: data.status, agents });
    if (sig !== lastSig) {
      lastSig = sig;
      snapshots.push({ at: new Date().toISOString(), status: data.status, agents });
      console.error(`[probe] snapshot: status=${data.status} agents=${agents.map((a) => `${a.label}:${a.state}`).join(",")}`);
    }
    if (data.status === "completed" || data.status === "failed") setTimeout(finish, 800);
  } catch { /* file mid-write — ignore */ }
}

function handle(msg) {
  if (msg.type === "response" && msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.type === "tool_execution_end" && msg.toolName === "Workflow") {
    const content = msg.result?.content;
    const text = Array.isArray(content)
      ? content.map((c) => (c && typeof c === "object" && typeof c.text === "string" ? c.text : "")).filter(Boolean).join("\n")
      : "";
    stateFile = deriveStateFile(text);
    console.error(`[probe] state file: ${stateFile}`);
    if (stateFile) pollTimer = setInterval(pollOnce, 300);
  }
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    let line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.trim()) { try { handle(JSON.parse(line)); } catch { /* */ } }
  }
});
let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
child.on("exit", (code) => { console.error(`[probe] gsd exited ${code}`); finish(); });

let finished = false;
function finish() {
  if (finished) return; finished = true;
  if (pollTimer) clearInterval(pollTimer);
  // final read
  pollOnce();
  const verdict = snapshots.length > 1 && snapshots.some((s) => s.status !== "completed" || s.agents.some((a) => a.state !== "done"))
    ? "LIVE — file updates incrementally during the run"
    : (snapshots.length ? "INCONCLUSIVE/END-ONLY — only saw completed snapshots" : "NO DATA — never found/read the state file");
  fs.writeFileSync(OUT_FILE, JSON.stringify({ verdict, stateFile, snapshotCount: snapshots.length, snapshots, stderrTail: stderr.slice(-1500) }, null, 2));
  console.error(`[probe] VERDICT: ${verdict}`);
  try { child.stdin.write(JSON.stringify({ type: "shutdown", id: String(nextId++) }) + "\n"); } catch { /* */ }
  setTimeout(() => { try { child.kill(); } catch { /* */ } process.exit(0); }, 1200);
}
setTimeout(() => { console.error("[probe] hard timeout"); finish(); }, HARD_TIMEOUT_MS);

// Five agents across phases so the run lasts long enough to catch mid-flight states.
const PROMPT = [
  "Run the Workflow tool RIGHT NOW. Create a workflow with FIVE agents across two phases (3 in phase A, 2 in phase B).",
  "Each agent's only task: reply with one short sentence about a different color. Keep a minimal meta block.",
  "Do NOT read or write files yourself. After launching, just wait for completion, then reply 'done'.",
].join(" ");

(async () => {
  await send({ type: "init", protocolVersion: 2 });
  await send({ type: "subscribe", events: ["*"] });
  console.error("[probe] sending workflow prompt…");
  await send({ type: "prompt", message: PROMPT });
})();
