#!/usr/bin/env node
/**
 * RPC Streaming Diagnostic — measures event flow timing from GSD's RPC mode.
 *
 * Spawns GSD in RPC mode, sends prompts that trigger tool execution,
 * and logs every event with precise timestamps to identify streaming gaps.
 *
 * Usage: node scripts/rpc-streaming-diagnostic.mjs
 */

import { spawn, spawnSync } from "child_process";
import { createInterface } from "readline";
import path from "path";
import fs from "fs";

// ── Resolve GSD binary (same logic as rpc-client.ts) ──────────────────

function resolveGsd() {
  if (process.platform === "win32") {
    const result = spawnSync("where", ["gsd.cmd"], { encoding: "utf-8", timeout: 5000 });
    if (result.status === 0 && result.stdout) {
      const cmdPath = result.stdout.trim().split(/\r?\n/)[0];
      if (cmdPath && fs.existsSync(cmdPath)) {
        // Parse .cmd to find JS entry
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

// ── State ──────────────────────────────────────────────────────────────

const events = [];
let startTime = null;
let requestId = 0;
let lastEventTime = null;
let shuttingDown = false;

function elapsed() {
  return startTime ? Date.now() - startTime : 0;
}

function gap() {
  if (!lastEventTime) return 0;
  return Date.now() - lastEventTime;
}

// ── Spawn GSD in RPC mode ─────────────────────────────────────────────

const resolved = resolveGsd();
console.log(`\n🔧 Spawning: ${resolved.command} ${resolved.args.join(" ")} --mode rpc`);
console.log(`   CWD: ${process.cwd()}\n`);

// Strip VS Code / Electron env vars
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

// ── Parse stdout as JSONL ─────────────────────────────────────────────

let buffer = "";
proc.stdout.on("data", (chunk) => {
  const now = Date.now();
  const chunkStr = chunk.toString("utf-8");
  const rawLines = chunkStr.split("\n").filter(l => l.trim());

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

      const record = {
        t: now,
        elapsed: elapsed(),
        gap: gap(),
        type: eventType,
        toolName: msg.toolName || undefined,
        toolCallId: msg.toolCallId ? "…" + msg.toolCallId.slice(-6) : undefined,
        hasPartialResult: eventType === "tool_execution_update" ? !!msg.partialResult : undefined,
        partialLen: msg.partialResult?.content?.[0]?.text?.length || undefined,
      };
      events.push(record);
      lastEventTime = now;

      // Pretty-print
      const parts = [`+${String(record.elapsed).padStart(7)}ms`];
      if (record.gap > 100) parts.push(`gap=${record.gap}ms`);
      parts.push(eventType);
      if (record.toolName) parts.push(`tool=${record.toolName}`);
      if (record.toolCallId) parts.push(`id=${record.toolCallId}`);
      if (record.partialLen) parts.push(`partial=${record.partialLen}ch`);

      // Highlight gaps > 1s
      const prefix = record.gap > 5000 ? "🔴" : record.gap > 1000 ? "⚠️ " : "  ";
      console.log(`${prefix}${parts.join("  ")}`);

      // Response to our request
      if (msg.type === "response") {
        console.log(`   ↳ response: command=${msg.command} success=${msg.success}`);
      }
    } catch {
      // Not JSON — skip
    }
  }
});

proc.stderr.on("data", (chunk) => {
  const text = chunk.toString("utf-8").trim();
  if (text) {
    for (const line of text.split("\n")) {
      console.log(`   [stderr] ${line}`);
    }
  }
});

proc.on("exit", (code, signal) => {
  console.log(`\n📊 Process exited: code=${code} signal=${signal}`);
  printSummary();
  process.exit(shuttingDown ? 0 : (code || 1));
});

// ── RPC helpers ───────────────────────────────────────────────────────

function send(obj) {
  if (!proc.stdin?.writable) {
    console.log("⚠ Cannot send — GSD process stdin is not writable");
    return null;
  }
  const id = `diag-${++requestId}`;
  const withId = { ...obj, id };
  proc.stdin.write(JSON.stringify(withId) + "\n");
  return id;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Summary ───────────────────────────────────────────────────────────

let summaryPrinted = false;

function printSummary() {
  if (summaryPrinted) return;
  summaryPrinted = true;
  console.log("\n" + "=".repeat(70));
  console.log("STREAMING DIAGNOSTIC SUMMARY");
  console.log("=".repeat(70));

  const totalEvents = events.length;
  const toolUpdates = events.filter(e => e.type === "tool_execution_update");
  const toolStarts = events.filter(e => e.type === "tool_execution_start");
  const toolEnds = events.filter(e => e.type === "tool_execution_end");
  const gaps1s = events.filter(e => e.gap > 1000);
  const gaps5s = events.filter(e => e.gap > 5000);
  const gaps30s = events.filter(e => e.gap > 30000);
  const maxGap = Math.max(0, ...events.map(e => e.gap));

  console.log(`Total events:          ${totalEvents}`);
  console.log(`Tool starts:           ${toolStarts.length}`);
  console.log(`Tool updates:          ${toolUpdates.length}`);
  console.log(`Tool ends:             ${toolEnds.length}`);
  console.log(`Gaps > 1s:             ${gaps1s.length}`);
  console.log(`Gaps > 5s:             ${gaps5s.length}`);
  console.log(`Gaps > 30s:            ${gaps30s.length}`);
  console.log(`Max gap:               ${maxGap}ms (${(maxGap / 1000).toFixed(1)}s)`);

  if (toolStarts.length > 0) {
    console.log("\nPer-tool breakdown:");
    for (const start of toolStarts) {
      const end = toolEnds.find(e => e.toolCallId === start.toolCallId);
      const updates = toolUpdates.filter(e => e.toolCallId === start.toolCallId);
      const duration = end ? end.t - start.t : "still running";
      console.log(`  ${start.toolName} (${start.toolCallId}):`);
      console.log(`    Duration: ${typeof duration === "number" ? `${duration}ms` : duration}`);
      console.log(`    Updates:  ${updates.length}`);
      if (updates.length > 0) {
        const updateGaps = updates.map(u => u.gap);
        console.log(`    Update gaps: min=${Math.min(...updateGaps)}ms max=${Math.max(...updateGaps)}ms avg=${Math.round(updateGaps.reduce((a, b) => a + b, 0) / updateGaps.length)}ms`);
      }
    }
  }

  if (gaps5s.length > 0) {
    console.log("\n⚠️  Significant gaps (>5s):");
    for (const g of gaps5s) {
      console.log(`  ${g.gap}ms before ${g.type} ${g.toolName || ""}`);
    }
  }

  console.log("=".repeat(70));

  // Write raw data to file
  const outPath = path.join(process.cwd(), "scripts", "rpc-diagnostic-results.json");
  fs.writeFileSync(outPath, JSON.stringify(events, null, 2));
  console.log(`\nRaw data: ${outPath}`);
}

// ── Test sequence ─────────────────────────────────────────────────────

async function run() {
  // Wait for process to be ready
  await sleep(3000);

  console.log("─".repeat(70));
  console.log("TEST 1: Simple bash tool (should stream stdout chunks)");
  console.log("─".repeat(70));

  // Send a prompt that triggers a bash tool with incremental output
  send({
    type: "prompt",
    message: 'Run this exact bash command and show me the output: for i in 1 2 3 4 5; do echo "Line $i at $(date +%H:%M:%S)"; sleep 2; done'
  });

  // Wait for the bash to complete (5 iterations × 2s = ~10s + overhead)
  await sleep(30000);

  console.log("\n" + "─".repeat(70));
  console.log("TEST 2: Multi-tool sequence (read + bash)");
  console.log("─".repeat(70));

  send({
    type: "prompt",
    message: "Read the file package.json and then run: echo 'done reading'"
  });

  await sleep(20000);

  // Shut down
  shuttingDown = true;
  console.log("\n" + "─".repeat(70));
  console.log("Shutting down...");
  console.log("─".repeat(70));

  send({ type: "abort" });
  await sleep(2000);
  proc.kill("SIGTERM");
  await sleep(3000);
  
  // Force exit if still alive
  try { proc.kill("SIGKILL"); } catch {}
  printSummary();
  process.exit(0);
}

run().catch((err) => {
  console.error("Diagnostic failed:", err);
  proc.kill();
  process.exit(1);
});
