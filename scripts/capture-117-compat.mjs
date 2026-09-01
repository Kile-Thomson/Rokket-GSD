#!/usr/bin/env node
// ============================================================
// capture-117-compat.mjs — gsd-pi 1.17 RPC compatibility capture
// ============================================================
//
// Drives a throwaway `gsd --mode rpc` exactly the way the extension does
// (rpc-client.ts): init(v2) → subscribe(["*"]) → prompt, using a trivial
// prompt that forces a real streaming assistant turn plus one tool call.
//
// Answers three concrete compatibility questions for the 1.x reboot:
//   1. init capabilities shape — the EXACT { protocolVersion, sessionId,
//      capabilities: { events, commands } } the server returns, so we can
//      diff the advertised events/commands against what rpc-events.ts handles.
//   2. Live event inventory — every distinct event type that crosses a real
//      turn, with one full sample each. This is the set the renderer must cope
//      with. Anything new/renamed since the code was written shows up here.
//   3. Delta-event shape — the 1.16.0 "delta-event decoupling / O(n^2) fix"
//      changed how streaming text is delivered. We capture the raw
//      message_update / message_end frames so we can confirm our extractor
//      (event.assistantMessageEvent.{type,delta}) still matches.
//
// Output: scripts/compat-117-results.json  (gitignored: scripts/*-results.json)
//
// Runs in an isolated temp cwd. Safe to delete afterward.

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "compat-117-results.json");
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

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-117-capture-"));
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

const distinctTypes = new Map(); // type -> first full sample
const counts = new Map();        // type -> count
const order = [];                // sequence of types (first 500)
const messageUpdates = [];       // first 20 raw message_update frames (delta shape)
const messageEnds = [];          // first 10 raw message_end frames
// --- cancellation investigation state ---
const timeline = [];             // { ms, type, hasCancel } for EVERY inbound frame
const uiFrames = [];             // raw extension_ui_request / elicitation frames
const cancelFrames = [];         // any raw frame whose JSON mentions "cancel"
let agentEndSeenAtMs = null;
let initResult = null;           // the raw init response
let buffer = "";
let nextId = 1;
const pending = new Map();

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
  const ms = elapsedMs();
  counts.set(type, (counts.get(type) ?? 0) + 1);
  if (order.length < 500) order.push(type);
  if (!distinctTypes.has(type)) {
    const json = JSON.stringify(msg);
    distinctTypes.set(type, json.length > 8000 ? { __truncated: true, bytes: json.length, preview: json.slice(0, 8000) } : msg);
    console.error(`[capture] new event type: ${type} @ ${ms}ms`);
  }
  if (type === "message_update" && messageUpdates.length < 20) messageUpdates.push({ ms, frame: msg });
  if (type === "message_end" && messageEnds.length < 10) messageEnds.push({ ms, frame: msg });

  // --- cancellation investigation ---
  const json = JSON.stringify(msg);
  const hasCancel = /cancel/i.test(json);
  timeline.push({ ms, type, hasCancel });
  if (/extension_ui|elicit/i.test(type) || /extension_ui|elicitation/i.test(json)) {
    if (uiFrames.length < 40) uiFrames.push({ ms, frame: msg });
  }
  if (hasCancel && cancelFrames.length < 40) cancelFrames.push({ ms, type, frame: msg });
  if (type === "agent_end" && agentEndSeenAtMs === null) agentEndSeenAtMs = ms;
}

function handle(msg) {
  if (msg.type === "response" && msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  record(msg);
  // NB: we deliberately do NOT answer the extension_ui_request. The experiment
  // is to watch what the server does to the pending elicitation once the turn
  // ends with no client response. Keep a generous window (15s) after agent_end
  // so any deferred server-side cancel is captured before we finish.
  if (msg.type === "execution_complete" || msg.type === "agent_end") {
    setTimeout(finish, 15_000);
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
    gsdVersion: (spawnSync(command, [...gsdArgs, "--version"], { encoding: "utf8" }).stdout || "").trim(),
    init: initResult,
    counts: Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])),
    order,
    messageUpdatesSample: messageUpdates,
    messageEndsSample: messageEnds,
    distinctTypes: Object.fromEntries(distinctTypes),
    // --- cancellation investigation ---
    agentEndSeenAtMs,
    // Every frame that arrived AT or AFTER agent_end — a cancel appearing here
    // (that we never sent a response to) proves the cancel is server-side.
    framesAtOrAfterAgentEnd: agentEndSeenAtMs === null
      ? null
      : timeline.filter((t) => t.ms >= agentEndSeenAtMs),
    timeline,
    uiFrames,
    cancelFrames,
    stderrTail: stderr.slice(-2000),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.error(`[capture] wrote ${OUT_FILE} — ${distinctTypes.size} distinct event types`);
  try { child.stdin.write(JSON.stringify({ type: "shutdown", id: String(nextId++) }) + "\n"); } catch { /* */ }
  setTimeout(() => { try { child.kill(); } catch { /* */ } process.exit(0); }, 1500);
}

setTimeout(() => { console.error("[capture] hard timeout reached"); finish(); }, HARD_TIMEOUT_MS);

// A prompt that FORCES a real ask_user_questions elicitation, so we exercise
// the extension_ui_request/select path. We then deliberately send NO
// extension_ui_response — the whole point is to observe whether gsd-pi
// auto-resolves the elicitation to cancelled:true when the turn ends without
// any client answer (server-side cancel) vs. whether that verdict only
// originates in our webview.
const PROMPT = [
  "Call the ask_user_questions tool exactly once to ask me a single",
  "multiple-choice question: 'Pick a color' with options red, green, blue.",
  "Do not do anything else before or after — just ask the question.",
].join(" ");

(async () => {
  const init = await send({ type: "init", protocolVersion: 2 });
  initResult = init?.data ?? init;
  console.error(`[capture] init: ${JSON.stringify(initResult).slice(0, 500)}`);
  await send({ type: "subscribe", events: ["*"] });
  console.error("[capture] subscribed to all events; sending prompt…");
  await send({ type: "prompt", message: PROMPT });
})();
