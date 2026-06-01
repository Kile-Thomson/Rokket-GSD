#!/usr/bin/env node
// ============================================================
// watch-real-journal.mjs — observe a REAL workflow's on-disk journal
// ============================================================
//
// Unlike the headless probes (whose agents finish in <0.5s, giving no live
// window), this watches the journal of a workflow launched by the REAL Claude
// Code session driving this extension — real model-backed agents that take real
// wall-clock time. It polls every 300ms and records, with timestamps, every time
// journal.jsonl changes line-count, plus when the end-file appears.
//
// Decisive question: does journal.jsonl grow INCREMENTALLY across the run's
// wall-clock (=> a proactive filesystem watcher could render live progress), or
// does it land all-at-once with the end-file (=> no on-disk live window)?
//
// Run this in the background, THEN launch a slow workflow in the same session.
// Output: scripts/real-journal-results.json
//
// Args: optional max-seconds (default 240).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "real-journal-results.json");
const MAX_MS = (Number(process.argv[2]) || 240) * 1000;
const POLL_MS = 300;
const START = Date.now();

const projectsRoot = path.join(os.homedir(), ".claude", "projects");
// This project's encoded session-parent dir (verified from the live Output log).
const ENC = "g--Dropbox-Rocket-Social-Rokketek-Software-RokketGSD---VS-Code-Plugin-gsd-vscode";

function projectDir() {
  const direct = path.join(projectsRoot, ENC);
  if (fs.existsSync(direct)) return direct;
  // Fallback: newest projects dir mentioning this repo.
  try {
    const cands = fs.readdirSync(projectsRoot)
      .filter((d) => d.toLowerCase().includes("gsd-vscode"))
      .map((d) => path.join(projectsRoot, d));
    let best = null, m = 0;
    for (const c of cands) { const s = fs.statSync(c).mtimeMs; if (s >= m) { m = s; best = c; } }
    return best;
  } catch { return null; }
}

const dt = () => Date.now() - START;
function countLines(p) {
  try { return fs.readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim()).length; }
  catch { return -1; }
}

// runDir -> { runId, firstSeenMs, samples:[{dtMs,lines}], lastLines, endFileMs, endFile }
const runs = new Map();

function scan() {
  const pdir = projectDir();
  if (!pdir) return;
  let sessions = [];
  try { sessions = fs.readdirSync(pdir).map((d) => path.join(pdir, d)); } catch { return; }
  for (const sess of sessions) {
    const wfRoot = path.join(sess, "subagents", "workflows");
    let entries = [];
    try { entries = fs.readdirSync(wfRoot); } catch { continue; }
    for (const e of entries) {
      if (!/^wf_/.test(e)) continue;
      const runDir = path.join(wfRoot, e);
      let st;
      try { st = fs.statSync(runDir); } catch { continue; }
      // Only runs created at/after we started watching (within a small skew).
      if (st.mtimeMs < START - 4000 && !runs.has(runDir)) continue;
      if (!runs.has(runDir)) {
        runs.set(runDir, {
          runId: e, firstSeenMs: dt(), samples: [], lastLines: -1,
          endFileMs: null, endFile: path.join(sess, "workflows", `${e}.json`),
          journalPath: path.join(runDir, "journal.jsonl"),
        });
        console.error(`[+${(dt()/1000).toFixed(1)}s] NEW run: ${e}`);
      }
    }
  }
}

function poll() {
  scan();
  for (const r of runs.values()) {
    const lc = countLines(r.journalPath);
    if (lc !== r.lastLines) {
      r.lastLines = lc;
      r.samples.push({ dtMs: dt(), lines: lc });
      console.error(`[+${(dt()/1000).toFixed(1)}s] ${r.runId} journal: ${lc} lines`);
    }
    if (r.endFileMs === null && fs.existsSync(r.endFile)) {
      r.endFileMs = dt();
      console.error(`[+${(dt()/1000).toFixed(1)}s] ${r.runId} END-FILE appeared`);
    }
  }
}

function finish() {
  poll();
  const report = [...runs.values()].map((r) => {
    const positive = r.samples.filter((s) => s.lines > 0);
    const beforeEnd = r.endFileMs === null ? positive : positive.filter((s) => s.dtMs < r.endFileMs - 200);
    const distinctBeforeEnd = [...new Set(beforeEnd.map((s) => s.lines))];
    const grewLiveBeforeEnd = distinctBeforeEnd.length > 1;
    let verdict;
    if (positive.length === 0) verdict = "NO JOURNAL OBSERVED";
    else if (grewLiveBeforeEnd) verdict = "LIVE ON DISK — journal grew incrementally before end-file; proactive watcher CAN render live";
    else verdict = "END-ONLY — journal reached full size in one step at/after end-file; no on-disk live window";
    return {
      runId: r.runId, verdict, firstSeenMs: r.firstSeenMs, endFileMs: r.endFileMs,
      distinctLineCountsBeforeEnd: distinctBeforeEnd, sampleCount: r.samples.length, samples: r.samples,
    };
  });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ watchedForMs: dt(), runsObserved: runs.size, report }, null, 2));
  console.error(`[watch] wrote ${OUT_FILE} — ${runs.size} run(s) observed`);
  process.exit(0);
}

console.error(`[watch] watching ${projectDir()} for new wf_* runs (max ${MAX_MS/1000}s)…`);
const timer = setInterval(poll, POLL_MS);
// Stop early once every observed run has an end-file + 3s settle, but only after we've seen at least one.
const settleCheck = setInterval(() => {
  if (runs.size > 0 && [...runs.values()].every((r) => r.endFileMs !== null && dt() - r.endFileMs > 3000)) {
    clearInterval(timer); clearInterval(settleCheck); finish();
  }
}, 500);
setTimeout(() => { clearInterval(timer); clearInterval(settleCheck); finish(); }, MAX_MS);
