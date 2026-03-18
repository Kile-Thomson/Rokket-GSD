// ============================================================
// Parallel Worker Status Reader
//
// Reads .gsd/parallel/*.status.json files to get per-worker
// progress during parallel auto-mode. Pure filesystem functions
// with null-return semantics for missing data.
// ============================================================

import * as fs from "fs";
import * as path from "path";

export interface RawWorkerStatus {
  milestoneId?: string;
  pid?: number;
  state?: string;
  currentUnit?: { type?: string; id?: string } | null;
  completedUnits?: number;
  cost?: number;
  lastHeartbeat?: number;
  startedAt?: number;
  worktreePath?: string;
}

/** Filename pattern: bare <id>.status.json, rejecting Dropbox conflicted copies */
const STATUS_FILE_RE = /^[^(]+\.status\.json$/;

/** Staleness threshold — workers with heartbeat older than this are marked stale */
const STALE_THRESHOLD_MS = 30_000;

/**
 * Read all parallel worker status files from .gsd/parallel/.
 * Returns null if the directory doesn't exist or is empty.
 * Skips corrupt/malformed files and Dropbox conflicted copies.
 */
export function readParallelWorkers(cwd: string): Array<{
  id: string;
  pid: number;
  state: "running" | "paused" | "stopped" | "error";
  currentUnit: { type: string; id: string } | null;
  completedUnits: number;
  cost: number;
  lastHeartbeat: number;
  stale: boolean;
}> | null {
  const dir = path.join(cwd, ".gsd", "parallel");

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null; // Directory doesn't exist
  }

  const statusFiles = entries.filter(f => STATUS_FILE_RE.test(f));
  if (statusFiles.length === 0) return null;

  const workers: Array<{
    id: string;
    pid: number;
    state: "running" | "paused" | "stopped" | "error";
    currentUnit: { type: string; id: string } | null;
    completedUnits: number;
    cost: number;
    lastHeartbeat: number;
    stale: boolean;
  }> = [];

  const now = Date.now();

  for (const file of statusFiles) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const data: RawWorkerStatus = JSON.parse(raw);

      const validStates = ["running", "paused", "stopped", "error"];
      const state = validStates.includes(data.state || "")
        ? (data.state as "running" | "paused" | "stopped" | "error")
        : "error";

      const lastHeartbeat = typeof data.lastHeartbeat === "number" ? data.lastHeartbeat : 0;

      let currentUnit: { type: string; id: string } | null = null;
      if (data.currentUnit && typeof data.currentUnit.type === "string" && typeof data.currentUnit.id === "string") {
        currentUnit = { type: data.currentUnit.type, id: data.currentUnit.id };
      }

      workers.push({
        id: data.milestoneId || file.replace(/\.status\.json$/, ""),
        pid: typeof data.pid === "number" ? data.pid : 0,
        state,
        currentUnit,
        completedUnits: typeof data.completedUnits === "number" ? data.completedUnits : 0,
        cost: typeof data.cost === "number" ? data.cost : 0,
        lastHeartbeat,
        stale: lastHeartbeat > 0 && (now - lastHeartbeat) > STALE_THRESHOLD_MS,
      });
    } catch {
      // Corrupt/malformed file — skip silently
    }
  }

  return workers.length > 0 ? workers : null;
}

/**
 * Read budget_ceiling from .gsd/preferences.md.
 * Returns null if file doesn't exist or key not found.
 */
export function readBudgetCeiling(cwd: string): number | null {
  const filePath = path.join(cwd, ".gsd", "preferences.md");

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  for (const line of content.split("\n")) {
    const match = line.match(/^\s*budget_ceiling\s*:\s*(.+)/);
    if (match) {
      const val = parseFloat(match[1].trim());
      return isFinite(val) && val > 0 ? val : null;
    }
  }

  return null;
}
