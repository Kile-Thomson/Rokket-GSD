#!/usr/bin/env node
/**
 * RPC Subagent Streaming Diagnostic — specifically tests whether subagent
 * tool_execution_update events flow during long agent runs.
 */

import { spawn, spawnSync } from "child_process";
import path from "path";
import fs from "fs";

function resolveGsd() {
  if (process.platform === "win32") {
    const result = spawnSync("where", ["gsd.cmd"], { encoding: "utf-8", timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const cmdPath = result.stdout.trim().split(/\r?\n/)[0];
      if (cmdPath && fs.existsSync(cmdPath)) {
        const content = fs.readFileSync(cmdPath, "utf-8");
        const match = content.match(/"%_prog%"\s+"([^"]+)"\s+%\*/);
        if (match) {
          let entryPath = match[1].replace(/%dp0%\\/gi, "").replace(/%dp0%/gi, "");
          const fullPath = path.resolve(path.dirname(cmdPath), entryPath);
          if (fs.existsSync(fullPath)) {
            const nodeResult = spawnSync("where", ["node"], { encoding: "utf-8", timeout: 5000 });
            const nodePath = nodeResult.stdout?.trim().split(/\r?\n/)[0] || "node";
            return { command: nodePath, args: [fullPath] };
          }
        }
      }
    }
  }
  return { command: "gsd", args: [] };
}

const events = [];
let startTime = null;
let lastEventTime = null;
let requestId = 0;
let promptSentTime = null;

function elapsed() { return startTime ? Date.now() - startTime : 0; }
function gap() { return lastEventTime ? Date.now() - lastEventTime : 0; }

const resolved = resolveGsd();
console.log(`\n🔧 Spawning GSD RPC for subagent test`);
console.log(`   ${resolved.command} ${resolved.args.join(" ")} --mode rpc\n`);

const cleanEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("VSCODE_") || key.startsWith("ELECTRON_") || key === "NODE_OPTIONS") continue;
  cleanEnv[key] = value;
}
cleanEnv.NO_COLOR = "1";
cleanEnv.FORCE_COLOR = "0";

const proc = spawn(resolved.command, [...resolved.args, "--mode", "rpc"], {
  cwd: process.cwd(),
  env: cleanEnv,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

console.log(`   PID: ${proc.pid}\n`);

let buffer = "";
proc.stdout.on("data", (chunk) => {
  const now = Date.now();
  const chunkStr = chunk.toString("utf-8");
  buffer += chunkStr;

  while (true) {
    const idx = buffer.indexOf("\n");
    if (idx === -1) break;
    let line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);
      const eventType = msg.type || "unknown";
      if (!startTime) startTime = now;

      const sincePrompt = promptSentTime ? now - promptSentTime : 0;
      const record = {
        t: now,
        elapsed: elapsed(),
        gap: gap(),
        sincePrompt,
        type: eventType,
        toolName: msg.toolName || undefined,
        toolCallId: msg.toolCallId ? "…" + msg.toolCallId.slice(-6) : undefined,
        partialLen: msg.partialResult?.content?.[0]?.text?.length || undefined,
      };
      events.push(record);
      lastEventTime = now;

      // Only log tool events and structural events, skip message_update spam
      const isInteresting = [
        "agent_start", "agent_end", "turn_start", "turn_end",
        "tool_execution_start", "tool_execution_update", "tool_execution_end",
        "response", "message_start", "message_end",
      ].includes(eventType);

      if (isInteresting) {
        const parts = [`+${String(record.sincePrompt).padStart(7)}ms`];
        if (record.gap > 2000) parts.push(`⚠️GAP=${(record.gap/1000).toFixed(1)}s`);
        parts.push(eventType);
        if (record.toolName) parts.push(`tool=${record.toolName}`);
        if (record.toolCallId) parts.push(`id=${record.toolCallId}`);
        if (record.partialLen) parts.push(`partial=${record.partialLen}ch`);
        if (eventType === "response") parts.push(`cmd=${msg.command} ok=${msg.success}`);
        console.log(`  ${parts.join("  ")}`);
      }
    } catch { /* not JSON */ }
  }
});

proc.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf-8").trim();
  if (text && !text.includes("[gsd] Extension load error")) {
    console.log(`   [stderr] ${text.split("\n")[0]}`);
  }
});

proc.on("exit", (code, signal) => {
  console.log(`\n📊 Process exited: code=${code} signal=${signal}`);
  printSummary();
  process.exit(0);
});

function send(obj) {
  const id = `diag-${++requestId}`;
  proc.stdin.write(JSON.stringify({ ...obj, id }) + "\n");
  return id;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let summaryPrinted = false;

function printSummary() {
  if (summaryPrinted) return;
  summaryPrinted = true;
  console.log("\n" + "=".repeat(70));
  console.log("SUBAGENT STREAMING DIAGNOSTIC SUMMARY");
  console.log("=".repeat(70));

  const toolUpdates = events.filter(e => e.type === "tool_execution_update");
  const toolStarts = events.filter(e => e.type === "tool_execution_start");
  const toolEnds = events.filter(e => e.type === "tool_execution_end");
  const allGaps = events.map(e => e.gap).filter(g => g > 0);
  const maxGap = Math.max(0, ...allGaps);

  console.log(`Total events:          ${events.length}`);
  console.log(`Tool starts:           ${toolStarts.length}`);
  console.log(`Tool updates:          ${toolUpdates.length}`);
  console.log(`Tool ends:             ${toolEnds.length}`);
  console.log(`Max gap:               ${(maxGap / 1000).toFixed(1)}s`);

  if (toolStarts.length > 0) {
    console.log("\nPer-tool:");
    for (const start of toolStarts) {
      const end = toolEnds.find(e => e.toolCallId === start.toolCallId);
      const updates = toolUpdates.filter(e => e.toolCallId === start.toolCallId);
      const duration = end ? end.t - start.t : "still running";
      console.log(`  ${start.toolName} (${start.toolCallId}): ${typeof duration === "number" ? `${(duration/1000).toFixed(1)}s` : duration}, ${updates.length} updates`);
      if (updates.length > 0) {
        const gaps = updates.map(u => u.gap);
        console.log(`    Update gaps: min=${(Math.min(...gaps)/1000).toFixed(1)}s max=${(Math.max(...gaps)/1000).toFixed(1)}s`);
      } else {
        console.log(`    ⚠️ ZERO intermediate updates — results arrived as single dump`);
      }
    }
  }

  console.log("=".repeat(70));
  const outPath = path.join(process.cwd(), "scripts", "rpc-subagent-results.json");
  fs.writeFileSync(outPath, JSON.stringify(events, null, 2));
  console.log(`Raw data: ${outPath}`);
}

// ── Test ──────────────────────────────────────────────────────────────

async function run() {
  await sleep(3000);

  console.log("─".repeat(70));
  console.log("TEST: Subagent tool — does it stream tool_execution_update events?");
  console.log("Sending a prompt that triggers a subagent call...");
  console.log("─".repeat(70));

  promptSentTime = Date.now();

  // This prompt should trigger the subagent tool to spawn a worker agent
  send({
    type: "prompt",
    message: 'Use the subagent tool to delegate this task to the "worker" agent: "Read the file package.json in the current directory and tell me the version number and name of the project. That is all — just report the name and version."'
  });

  // Wait up to 90 seconds for the subagent to complete
  let agentEnded = false;
  const checkInterval = setInterval(() => {
    if (events.some(e => e.type === "agent_end" && e.sincePrompt > 1000)) {
      agentEnded = true;
      clearInterval(checkInterval);
    }
  }, 1000);

  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (agentEnded) break;
  }
  clearInterval(checkInterval);

  if (!agentEnded) {
    console.log("\n⚠️  Agent did not complete within 90s — aborting");
    send({ type: "abort" });
    await sleep(3000);
  }

  console.log("\nShutting down...");
  proc.kill("SIGTERM");
  await sleep(2000);
  try { proc.kill("SIGKILL"); } catch {}
  printSummary();
  process.exit(0);
}

run().catch((err) => {
  console.error("Diagnostic failed:", err);
  proc.kill();
  process.exit(1);
});
