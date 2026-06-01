#!/usr/bin/env node
// ============================================================
// probe-journal-growth.mjs — full on-disk timeline of a workflow run
// ============================================================
//
// Watches from tool_execution_START (not end), discovering the run dir by
// scanning ~/.claude/projects/**/subagents/workflows/wf_* for this cwd's session,
// then polls journal.jsonl every 500ms. Records, relative to tool_start:
//   tToolStart, tToolEnd, tRunDirCreated, each journal line-count growth, tEndFile.
//
// This answers the question six rounds of static analysis could not:
//   Does journal.jsonl grow INCREMENTALLY during the background run (so a 2s
//   poller would see live data), or does it appear all-at-once at completion
//   together with the end-file (no live window — blank UI is inevitable)?
//
// And: does tool_execution_END fire at LAUNCH (background) or only at COMPLETION?
// That single fact decides whether the extension poller ever gets a live window.
//
// Output: scripts/journal-growth-results.json (gitignored: scripts/*-results.json)

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "journal-growth-results.json");
const HARD_TIMEOUT_MS = 300_000;
const POLL_MS = 500;

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
        return { command: first, args: [], useShell: isWin };
      }
      return { command: first, args: [], useShell: false };
    }
  }
  return { command: "gsd", args: [], useShell: isWin };
}

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-wf-journal-"));
const projectsRoot = path.join(os.homedir(), ".claude", "projects");

function findRunDir() {
  // Find the session dir for THIS cwd, then its newest subagents/workflows/wf_* dir.
  if (!fs.existsSync(projectsRoot)) return null;
  const tail = path.basename(cwd).toLowerCase(); // e.g. gsd-wf-journal-xxxx
  let sessionParents = [];
  try {
    sessionParents = fs.readdirSync(projectsRoot)
      .filter((d) => d.toLowerCase().includes(tail))
      .map((d) => path.join(projectsRoot, d));
  } catch { return null; }
  let newest = null, newestMtime = 0;
  for (const sp of sessionParents) {
    // sp may itself be the project dir, or contain session subdirs — search both.
    const candidates = [sp];
    try { for (const sub of fs.readdirSync(sp)) candidates.push(path.join(sp, sub)); } catch { /* */ }
    for (const c of candidates) {
      const wfRoot = path.join(c, "subagents", "workflows");
      let entries = [];
      try { entries = fs.readdirSync(wfRoot); } catch { continue; }
      for (const e of entries) {
        if (!/^wf_/.test(e)) continue;
        const dir = path.join(wfRoot, e);
        let m = 0; try { m = fs.statSync(dir).mtimeMs; } catch { /* */ }
        if (m >= newestMtime) { newestMtime = m; newest = dir; }
      }
    }
  }
  return newest;
}

const { command, args: gsdArgs, useShell } = resolveGsd();
const child = spawn(command, [...gsdArgs, "--mode", "rpc"], {
  cwd, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", GSD_IDE: "1" },
  stdio: ["pipe", "pipe", "pipe"], shell: useShell, windowsHide: true,
});

let buffer = "", nextId = 1, pollTimer = null;
let tToolStart = 0, tToolEnd = 0, tRunDir = null, tEndFile = null, tJournalFirst = null;
let runDir = null, journalPath = null, endFilePath = null, lastLineCount = -1;
const pending = new Map();
const growth = []; // {dtMs, lineCount}

function send(obj) {
  const id = String(nextId++);
  child.stdin.write(JSON.stringify({ ...obj, id }) + "\n");
  return new Promise((res) => { pending.set(id, res); setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ __timeout: true }); } }, 60_000); });
}
const dt = () => Date.now() - tToolStart;
function countLines(p) { try { return fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim()).length; } catch { return -1; } }

function pollOnce() {
  if (!runDir) {
    runDir = findRunDir();
    if (runDir) {
      tRunDir = dt();
      journalPath = path.join(runDir, "journal.jsonl");
      const base = path.basename(runDir);
      endFilePath = path.join(path.dirname(path.dirname(path.dirname(runDir))), "workflows", `${base}.json`);
      console.error(`[+${(tRunDir / 1000).toFixed(1)}s] run dir found: ${base}`);
    }
  }
  if (journalPath) {
    const lc = fs.existsSync(journalPath) ? countLines(journalPath) : 0;
    if (lc > 0 && tJournalFirst === null) tJournalFirst = dt();
    if (lc !== lastLineCount) {
      lastLineCount = lc;
      growth.push({ dtMs: dt(), lineCount: lc });
      console.error(`[+${(dt() / 1000).toFixed(1)}s] journal: ${lc} lines`);
    }
    if (endFilePath && tEndFile === null && fs.existsSync(endFilePath)) {
      tEndFile = dt();
      console.error(`[+${(tEndFile / 1000).toFixed(1)}s] END-FILE appeared`);
      setTimeout(finish, 2000);
    }
  }
}

function handle(msg) {
  if (msg.type === "response" && msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.type === "tool_execution_start" && msg.toolName === "Workflow") {
    tToolStart = Date.now();
    console.error("[+0.0s] tool_execution_start(Workflow)");
    pollTimer = setInterval(pollOnce, POLL_MS);
  } else if (msg.type === "tool_execution_end" && msg.toolName === "Workflow") {
    tToolEnd = dt();
    console.error(`[+${(tToolEnd / 1000).toFixed(1)}s] tool_execution_end(Workflow)`);
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
  pollOnce();
  const distinct = [...new Set(growth.map((g) => g.lineCount))];
  const grewIncrementally = distinct.filter((n) => n > 0).length > 1;
  const grewBeforeEnd = growth.some((g) => g.lineCount > 0 && (tEndFile === null || g.dtMs < tEndFile)) &&
    [...new Set(growth.filter((g) => tEndFile === null || g.dtMs < tEndFile).map((g) => g.lineCount))].filter((n) => n > 0).length > 1;
  const toolEndAtLaunch = tToolEnd !== 0 && tEndFile !== null && tToolEnd < tEndFile - 1500;
  let verdict;
  if (growth.every((g) => g.lineCount <= 0)) verdict = "NO JOURNAL — never appeared; live journal feed impossible (use agent-<id>.jsonl)";
  else if (grewBeforeEnd) verdict = "LIVE ON DISK — journal grew incrementally before end-file => correct poller WOULD show live data; blank UI is a DELIVERY/timer bug";
  else verdict = "END-ONLY — journal did not grow incrementally before completion; no usable live window from the journal";
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    verdict,
    toolEndFiredAtLaunch: toolEndAtLaunch,
    tToolStartMs: 0, tToolEndMs: tToolEnd, tRunDirMs: tRunDir, tJournalFirstMs: tJournalFirst, tEndFileMs: tEndFile,
    grewIncrementally, distinctLineCounts: distinct, growth,
    stderrTail: stderr.slice(-1500),
  }, null, 2));
  console.error(`[probe] VERDICT: ${verdict}`);
  console.error(`[probe] toolEnd@${tToolEnd}ms endFile@${tEndFile}ms => toolEnd fired ${toolEndAtLaunch ? "AT LAUNCH (bg)" : "AT/NEAR COMPLETION"}`);
  try { child.stdin.write(JSON.stringify({ type: "shutdown", id: String(nextId++) }) + "\n"); } catch { /* */ }
  setTimeout(() => { try { child.kill(); } catch { /* */ } process.exit(0); }, 1500);
}
setTimeout(() => { console.error("[probe] hard timeout"); finish(); }, HARD_TIMEOUT_MS);

// DEEP pipeline: 8 items through a 4-stage chain => wall-clock spans many ticks
// even though each agent is trivial, because stages run sequentially per item.
const PROMPT = [
  "Run the Workflow tool RIGHT NOW. Use pipeline() with EIGHT items through a FOUR-stage chain (stage1..stage4).",
  "Each stage's agent task: reply with one short sentence transforming the item. Minimal meta block, no schema.",
  "Do NOT read or write files yourself. After launching, just wait for completion, then reply 'done'.",
].join(" ");

(async () => {
  await send({ type: "init", protocolVersion: 2 });
  await send({ type: "subscribe", events: ["*"] });
  console.error("[probe] sending workflow prompt…");
  await send({ type: "prompt", message: PROMPT });
})();
