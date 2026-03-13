import * as fs from "fs";
import * as path from "path";
import type { WorkflowStateRef } from "../shared/types";

// ============================================================
// GSD STATE.md Parser
// Reads `.gsd/STATE.md` and extracts workflow state for the header badge.
// ============================================================

export interface GsdWorkflowState {
  milestone: WorkflowStateRef | null;
  slice: WorkflowStateRef | null;
  task: WorkflowStateRef | null;
  /** Current phase */
  phase: string;
  /** Auto-mode status: "auto", "next", "paused", or null (not in auto-mode) */
  autoMode: string | null;
}

/**
 * Parse the active ref line from STATE.md.
 * Format: `**Active Milestone:** M004 — Title` or `**Active Milestone:** (none)`
 * Also handles: `M004 — Title ✓ COMPLETE`
 */
function parseActiveRef(content: string, label: string): { id: string; title: string } | null {
  // Match: **Active <Label>:** <id> — <title> [optional ✓ COMPLETE]
  const re = new RegExp(`\\*\\*Active ${label}:\\*\\*\\s*(.+)`, "i");
  const match = content.match(re);
  if (!match) return null;

  const value = match[1].trim();
  if (value === "(none)" || value === "—" || !value) return null;

  // Try to parse "ID — Title" or "ID: Title" or just "ID"
  const dashMatch = value.match(/^(\S+)\s*[—–-]\s*(.+?)(?:\s*✓.*)?$/);
  if (dashMatch) {
    return { id: dashMatch[1], title: dashMatch[2].trim() };
  }

  const colonMatch = value.match(/^(\S+):\s*(.+?)(?:\s*✓.*)?$/);
  if (colonMatch) {
    return { id: colonMatch[1], title: colonMatch[2].trim() };
  }

  // Just an ID with no title
  return { id: value.replace(/\s*✓.*$/, "").trim(), title: "" };
}

/**
 * Parse the phase line from STATE.md.
 * Format: `**Phase:** Executing` or `**Phase:** Complete`
 */
function parsePhase(content: string): string {
  const match = content.match(/\*\*Phase:\*\*\s*(.+)/i);
  if (!match) return "unknown";
  return match[1].trim().toLowerCase();
}

/**
 * Read and parse `.gsd/STATE.md` from the given workspace root.
 * Returns null if `.gsd/STATE.md` doesn't exist or can't be parsed.
 */
export async function parseGsdWorkflowState(cwd: string): Promise<GsdWorkflowState | null> {
  const statePath = path.join(cwd, ".gsd", "STATE.md");

  try {
    const content = await fs.promises.readFile(statePath, "utf-8");

    const milestone = parseActiveRef(content, "Milestone");
    const slice = parseActiveRef(content, "Slice");
    const task = parseActiveRef(content, "Task");
    const phase = parsePhase(content);

    return {
      milestone,
      slice,
      task,
      phase,
      autoMode: null, // Set externally from setStatus events
    };
  } catch {
    // File doesn't exist or can't be read
    return null;
  }
}
