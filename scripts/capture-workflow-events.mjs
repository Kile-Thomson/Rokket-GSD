#!/usr/bin/env node
// ============================================================
// capture-workflow-events.mjs — RPC frame capture for workflow runs
// ============================================================
//
// Drives a throwaway `gsd --mode rpc` process exactly the way the VS Code
// extension does (rpc-client.ts): init(v2) → subscribe(["*"]) → prompt. The
// prompt asks the agent to run one minimal 2-agent Workflow and stop. Every
// JSON frame the process emits on stdout is recorded so we can see precisely
// which events (and shapes) the runtime sends while a workflow fans out —
// the data the extension would need to render live per-agent progress.
//
// Output: scripts/workflow-events-results.json  (gitignored: scripts/*-results.json)
//   - distinctTypes: one full sample per distinct event type
//   - counts: how many of each type arrived (frequency profile)
//   - order: the sequence of types as they arrived (first 400)
//
// Runs in an isolated temp cwd; the synthetic workflow is told to take no
// other action. Safe to delete afterward.

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "workflow-events-results.json");
const HARD_TIMEOUT_MS = 180_000; // give the model time to run a 2-agent workflow

// --- resolve the gsd executable (mirror rpc-client's Windows-friendly lookup) ---
// On Windows, `gsd.cmd` is an npm shim that calls `node <loader.js>`. Spawning
// the .cmd via shell:true breaks on spaces in the path (e.g. "Kile Thomson"),
// so we parse the shim to spawn node + the loader directly with shell:false.
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
        if (fs.existsSync(loader)) {
          return { command: process.execPath, args: [loader], useShell: false };
        }
      }
      return { command: first, args: [], useShell: false };
    }
  }
  return { command: "gsd", args: [], useShell: isWin };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-wf-capture-"));
const { command, args: gsdArgs, useShell } = resolveGsd();
console.error(`[capture] spawning: ${command} ${gsdArgs.join(" ")} --mode rpc   (cwd=${cwd}, shell=${useShell})`);

const child = spawn(command, [...gsdArgs, "--mode", "rpc"], {
  cwd,
  env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", GSD_IDE: "1" },
  stdio: ["pipe", "pipe", "pipe"],
  shell: useShell,
  windowsHide: true,
});

const distinctTypes = new Map(); // type -> first sample
const counts = new Map(); // type -> count
const order = []; // sequence of types
let buffer = "";
let nextId = 1;
const pending = new Map(); // id -> resolve

function send(obj) {
  const id = String(nextId++);
  const line = JSON.stringify({ ...obj, id }) + "\n";
  child.stdin.write(line);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ __timeout: true }); } }, 60_000);
  });
}

function record(msg) {
  const type = typeof msg?.type === "string" ? msg.type : "<no-type>";
  counts.set(type, (counts.get(type) ?? 0) + 1);
  if (order.length < 400) order.push(type);
  if (!distinctTypes.has(type)) {
    const json = JSON.stringify(msg);
    distinctTypes.set(type, json.length > 8000 ? { __truncated: true, bytes: json.length, preview: json.slice(0, 8000) } : msg);
    console.error(`[capture] new event type: ${type}`);
  }
}

function handle(msg) {
  if (msg.type === "response" && msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  record(msg);
  if (msg.type === "execution_complete" || msg.type === "agent_end") {
    // let a moment of trailing events flush, then finish
    setTimeout(finish, 4000);
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
    try { handle(JSON.parse(line)); } catch { /* ignore non-JSON noise */ }
  }
});

let stderr = "";
child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
child.on("exit", (code) => { console.error(`[capture] gsd exited code=${code}`); finish(); });

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const result = {
    capturedAt: new Date().toISOString(),
    counts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
    order,
    distinctTypes: Object.fromEntries(distinctTypes),
    stderrTail: stderr.slice(-2000),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.error(`[capture] wrote ${OUT_FILE} — ${counts.size} distinct types`);
  try { child.stdin.write(JSON.stringify({ type: "shutdown", id: String(nextId++) }) + "\n"); } catch { /* */ }
  setTimeout(() => { try { child.kill(); } catch { /* */ } process.exit(0); }, 1500);
}

setTimeout(() => { console.error("[capture] hard timeout reached"); finish(); }, HARD_TIMEOUT_MS);

const WORKFLOW_PROMPT = [
  "Run the Workflow tool RIGHT NOW with exactly two agents.",
  "Each agent's only task is to return the single word \"ok\".",
  "Use a minimal meta block with two phases. Do NOT read or write any files.",
  "Do NOT take any other action before or after. After the workflow returns, reply with just \"done\".",
].join(" ");

(async () => {
  const init = await send({ type: "init", protocolVersion: 2 });
  console.error(`[capture] init: ${JSON.stringify(init).slice(0, 300)}`);
  await send({ type: "subscribe", events: ["*"] });
  console.error("[capture] subscribed to all events; sending workflow prompt…");
  await send({ type: "prompt", message: WORKFLOW_PROMPT });
})();
