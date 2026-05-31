#!/usr/bin/env node
// ============================================================
// capture-subagent-events.mjs — RPC frame capture for subagent dispatch
// ============================================================
//
// Companion to capture-workflow-events.mjs. Drives a throwaway `gsd --mode rpc`
// process the way the extension does (rpc-client.ts): init(v2) → subscribe(["*"])
// → prompt. The prompt asks the agent to dispatch ONE minimal subagent that just
// returns "ok", and take no other action.
//
// The decisive question this answers: while a subagent is running (between the
// `tool_execution_start` for the subagent tool and its `tool_execution_end`),
// does the parent RPC stream emit ANY cost/token/message movement that the
// extension could use as a liveness signal — or does it go silent like a
// Workflow launch does? If silent, a "stats-movement" stall badge cannot
// distinguish a hung subagent from a working one.
//
// Output: scripts/subagent-events-results.json  (gitignored: scripts/*-results.json)
//   - counts: frequency of each event type
//   - order: sequence of types (first 400)
//   - distinctTypes: one full sample per distinct type
//   - subagentWindow: events that arrived DURING the subagent execution window,
//       with elapsed-ms timestamps and any cost field — the heart of the test
//   - costTimeline: every cost-bearing event (message_end / cost_update) with
//       elapsed ms and cost value, so movement (or its absence) is visible
//
// Runs in an isolated temp cwd. Safe to delete afterward.

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "subagent-events-results.json");
const HARD_TIMEOUT_MS = 180_000;

// --- resolve the gsd executable (mirror rpc-client's Windows-friendly lookup) ---
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
        return { command: first, args: [], useShell: isWin };
      }
      return { command: first, args: [], useShell: false };
    }
  }
  return { command: "gsd", args: [], useShell: isWin };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-sa-capture-"));
const { command, args: gsdArgs, useShell } = resolveGsd();
console.error(`[capture] spawning: ${command} ${gsdArgs.join(" ")} --mode rpc   (cwd=${cwd}, shell=${useShell})`);

const child = spawn(command, [...gsdArgs, "--mode", "rpc"], {
  cwd,
  env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", GSD_IDE: "1" },
  stdio: ["pipe", "pipe", "pipe"],
  shell: useShell,
  windowsHide: true,
});

const t0 = process.hrtime.bigint();
const elapsedMs = () => Number((process.hrtime.bigint() - t0) / 1_000_000n);

const distinctTypes = new Map(); // type -> first sample
const counts = new Map(); // type -> count
const order = []; // sequence of types
const costTimeline = []; // {ms, type, cost} for every cost-bearing event
const subagentWindow = []; // events that arrived while a subagent tool was running
let buffer = "";
let nextId = 1;
const pending = new Map();

// track subagent execution windows by tool call id
const runningSubagents = new Set();
const SUBAGENT_TOOLS = new Set(["subagent", "Agent", "Task"]);

function send(obj) {
  const id = String(nextId++);
  const line = JSON.stringify({ ...obj, id }) + "\n";
  child.stdin.write(line);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ __timeout: true }); } }, 60_000);
  });
}

function toolName(msg) {
  return msg?.toolName ?? msg?.tool ?? msg?.name ?? msg?.tool_name ??
    (msg?.toolCall && (msg.toolCall.name ?? msg.toolCall.toolName)) ?? undefined;
}

function extractCost(msg) {
  // cost_update (v2): cumulativeCost
  if (typeof msg?.cumulativeCost === "number") return msg.cumulativeCost;
  // message_end: message.usage.cost.total
  const usage = msg?.message?.usage;
  if (usage?.cost && typeof usage.cost.total === "number") return usage.cost.total;
  return undefined;
}

function record(msg) {
  const type = typeof msg?.type === "string" ? msg.type : "<no-type>";
  const ms = elapsedMs();
  counts.set(type, (counts.get(type) ?? 0) + 1);
  if (order.length < 400) order.push(type);
  if (!distinctTypes.has(type)) {
    const json = JSON.stringify(msg);
    distinctTypes.set(type, json.length > 8000 ? { __truncated: true, bytes: json.length, preview: json.slice(0, 8000) } : msg);
    console.error(`[capture] new event type: ${type} @ ${ms}ms`);
  }

  // track subagent execution windows
  const name = toolName(msg);
  const callId = msg?.toolCallId ?? msg?.callId ?? msg?.id;
  if (type === "tool_execution_start" && name && SUBAGENT_TOOLS.has(name)) {
    runningSubagents.add(callId);
    console.error(`[capture] SUBAGENT START (${name}) @ ${ms}ms`);
  }
  if (type === "tool_execution_end" && runningSubagents.has(callId)) {
    runningSubagents.delete(callId);
    console.error(`[capture] SUBAGENT END @ ${ms}ms`);
  }

  // cost-bearing events
  const cost = extractCost(msg);
  if (cost !== undefined) {
    costTimeline.push({ ms, type, cost, duringSubagent: runningSubagents.size > 0 });
  }

  // any event that arrives while a subagent is running is part of the window
  if (runningSubagents.size > 0 && type !== "tool_execution_start") {
    subagentWindow.push({ ms, type, tool: name, cost });
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
  // summary: did cost move during a subagent window?
  const duringCount = costTimeline.filter((c) => c.duringSubagent).length;
  const windowCostEvents = subagentWindow.filter((e) => e.cost !== undefined);
  const result = {
    capturedAt: new Date().toISOString(),
    verdict: {
      costEventsDuringSubagent: duringCount,
      anyMovementDuringSubagent: duringCount > 0,
      subagentWindowEventCount: subagentWindow.length,
      subagentWindowCostEventCount: windowCostEvents.length,
      note: duringCount > 0
        ? "Cost/token movement DOES cross during a subagent run — a stats-movement liveness signal is viable."
        : "NO cost/token movement crossed during the subagent window — stats-movement stall badge is NOT viable; need a different signal.",
    },
    counts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
    order,
    costTimeline,
    subagentWindow,
    distinctTypes: Object.fromEntries(distinctTypes),
    stderrTail: stderr.slice(-2000),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.error(`[capture] wrote ${OUT_FILE} — verdict.anyMovementDuringSubagent=${result.verdict.anyMovementDuringSubagent}`);
  try { child.stdin.write(JSON.stringify({ type: "shutdown", id: String(nextId++) }) + "\n"); } catch { /* */ }
  setTimeout(() => { try { child.kill(); } catch { /* */ } process.exit(0); }, 1500);
}

setTimeout(() => { console.error("[capture] hard timeout reached"); finish(); }, HARD_TIMEOUT_MS);

const SUBAGENT_PROMPT = [
  "Use the subagent tool RIGHT NOW in single mode to dispatch exactly one subagent.",
  "The subagent's only task is to return the single word \"ok\".",
  "Pass model: \"claude-sonnet-4-6\" in the subagent call.",
  "Do NOT read or write any files. Do NOT take any other action before or after.",
  "After the subagent returns, reply with just \"done\".",
].join(" ");

(async () => {
  const init = await send({ type: "init", protocolVersion: 2 });
  console.error(`[capture] init: ${JSON.stringify(init).slice(0, 300)}`);
  await send({ type: "subscribe", events: ["*"] });
  console.error("[capture] subscribed to all events; sending subagent prompt…");
  await send({ type: "prompt", message: SUBAGENT_PROMPT });
})();
