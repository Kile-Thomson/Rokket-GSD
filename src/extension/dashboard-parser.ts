import * as fs from "fs";
import * as path from "path";
import { parseGsdWorkflowState } from "./state-parser";
import type { DashboardSlice, MilestoneRegistryEntry, DashboardData } from "../shared/types";

// ============================================================
// Dashboard Parser
// Reads .gsd/ project files and builds a dashboard model
// for the webview to render.
// ============================================================

/**
 * Parse a ROADMAP.md file and extract slice entries.
 */
function parseRoadmapSlices(content: string): Array<{ id: string; title: string; done: boolean; risk: string }> {
  const slices: Array<{ id: string; title: string; done: boolean; risk: string }> = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)/);
    if (m) {
      const risk = m[4].match(/`risk:(\w+)`/)?.[1] || "low";
      slices.push({ id: m[2], title: m[3], done: m[1].toLowerCase() === "x", risk });
    }
  }
  return slices;
}

/**
 * Parse a PLAN.md file and extract task entries.
 */
function parsePlanTasks(content: string): Array<{ id: string; title: string; done: boolean; estimate: string }> {
  const tasks: Array<{ id: string; title: string; done: boolean; estimate: string }> = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^-\s+\[([ xX])\]\s+\*\*(\w+):\s+(.+?)\*\*\s*(.*)/);
    if (m) {
      const est = m[4].match(/`est:([^`]+)`/)?.[1] || "";
      tasks.push({ id: m[2], title: m[3], done: m[1].toLowerCase() === "x", estimate: est });
    }
  }
  return tasks;
}

/**
 * Parse milestone registry from STATE.md.
 * Lines like: `- ✅ **M001:** Title` or `- 🔄 **M002:** Title` or `- ⏸️ **M003:** Title` or `- ⬜ **M004:** Title`
 *
 * Glyph mapping (as of gsd-pi 2.44):
 *   ✅ = complete, 🔄 = active, ⏸️ = parked, ⬜ = pending
 * Legacy formats without a glyph or with only ✅/⬜ still parse correctly.
 */
function parseMilestoneRegistry(content: string): MilestoneRegistryEntry[] {
  const entries: MilestoneRegistryEntry[] = [];
  const lines = content.split("\n");
  let inRegistry = false;

  for (const line of lines) {
    if (line.match(/##\s*Milestone\s*Registry/i)) {
      inRegistry = true;
      continue;
    }
    if (inRegistry && line.startsWith("##")) break;
    if (!inRegistry) continue;

    // Match any status glyph (or none) before the bolded milestone ID.
    // The glyph capture is generous — we classify by known values below.
    const m = line.match(/^-\s*([^\s*]*)?\s*\*\*(\w+):\*\*\s*(.+)/);
    if (m) {
      const glyph = (m[1] || "").trim();
      entries.push({
        id: m[2],
        title: m[3].trim(),
        done: glyph === "✅",
        active: glyph === "🔄",
      });
    }
  }

  return entries;
}

/**
 * Parse blockers from STATE.md.
 */
function parseBlockers(content: string): string[] {
  const blockers: string[] = [];
  const lines = content.split("\n");
  let inBlockers = false;

  for (const line of lines) {
    if (line.match(/##\s*Blockers/i)) {
      inBlockers = true;
      continue;
    }
    if (inBlockers && line.startsWith("##")) break;
    if (!inBlockers) continue;

    const trimmed = line.replace(/^-\s*/, "").trim();
    if (trimmed && trimmed.toLowerCase() !== "none") {
      blockers.push(trimmed);
    }
  }

  return blockers;
}

/**
 * Parse "Next Action" from STATE.md.
 */
function parseNextAction(content: string): string | null {
  const lines = content.split("\n");
  let inNext = false;

  for (const line of lines) {
    if (line.match(/##\s*Next\s*Action/i)) {
      inNext = true;
      continue;
    }
    if (inNext && line.startsWith("##")) break;
    if (!inNext) continue;

    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

/**
 * Find a file matching a pattern in a directory.
 */
async function findFile(dir: string, suffix: string): Promise<string | null> {
  try {
    const files = await fs.promises.readdir(dir);
    const match = files.find(f => f.toUpperCase().endsWith(suffix.toUpperCase()));
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

/**
 * Build the full dashboard data from .gsd/ project files.
 */
export async function buildDashboardData(cwd: string): Promise<DashboardData | null> {
  const gsdDir = path.join(cwd, ".gsd");
  if (!fs.existsSync(gsdDir)) return null;

  // Read STATE.md raw content for registry/blockers/next
  const statePath = path.join(gsdDir, "STATE.md");
  let stateContent = "";
  try {
    stateContent = await fs.promises.readFile(statePath, "utf-8");
  } catch {
    // No STATE.md
  }

  const wfState = await parseGsdWorkflowState(cwd);
  const milestoneRegistry = parseMilestoneRegistry(stateContent);
  const blockers = parseBlockers(stateContent);
  const nextAction = parseNextAction(stateContent);

  // Mark active milestone in registry
  if (wfState?.milestone) {
    for (const entry of milestoneRegistry) {
      entry.active = entry.id === wfState.milestone.id;
    }
  }

  // If no active milestone, still return project-level data
  if (!wfState?.milestone) {
    const doneMilestones = milestoneRegistry.filter(m => m.done).length;
    return {
      hasProject: milestoneRegistry.length > 0 || stateContent.length > 0,
      hasMilestone: false,
      milestone: null,
      slice: null,
      task: null,
      phase: wfState?.phase || "complete",
      slices: [],
      milestoneRegistry,
      progress: {
        tasks: { done: 0, total: 0 },
        slices: { done: 0, total: 0 },
        milestones: { done: doneMilestones, total: milestoneRegistry.length },
      },
      blockers,
      nextAction,
    };
  }

  const mid = wfState.milestone.id;
  const milestoneDir = path.join(gsdDir, "milestones", mid);

  // Parse roadmap
  const roadmapFile = await findFile(milestoneDir, "-ROADMAP.md");
  const slices: DashboardSlice[] = [];

  if (roadmapFile) {
    const content = await fs.promises.readFile(roadmapFile, "utf-8");
    const rawSlices = parseRoadmapSlices(content);

    for (const rs of rawSlices) {
      const isActive = wfState.slice?.id === rs.id;
      const sliceEntry: DashboardSlice = {
        ...rs,
        active: isActive,
        tasks: [],
      };

      // If this is the active slice, parse its plan for tasks
      if (isActive) {
        const sliceDir = path.join(milestoneDir, "slices", rs.id);
        const planFile = await findFile(sliceDir, "-PLAN.md");
        if (planFile) {
          const planContent = await fs.promises.readFile(planFile, "utf-8");
          const rawTasks = parsePlanTasks(planContent);
          sliceEntry.tasks = rawTasks.map(t => ({
            id: t.id,
            title: t.title,
            done: t.done,
            active: wfState.task?.id === t.id,
            estimate: t.estimate,
          }));
          sliceEntry.taskProgress = {
            done: rawTasks.filter(t => t.done).length,
            total: rawTasks.length,
          };
        }
      }

      slices.push(sliceEntry);
    }
  }

  const doneSlices = slices.filter(s => s.done).length;
  const activeSlice = slices.find(s => s.active);
  const tasksDone = activeSlice?.taskProgress?.done ?? 0;
  const tasksTotal = activeSlice?.taskProgress?.total ?? 0;
  const doneMilestones = milestoneRegistry.filter(m => m.done).length;

  return {
    hasProject: true,
    hasMilestone: true,
    milestone: wfState.milestone,
    slice: wfState.slice,
    task: wfState.task,
    phase: wfState.phase,
    slices,
    milestoneRegistry,
    progress: {
      tasks: { done: tasksDone, total: tasksTotal },
      slices: { done: doneSlices, total: slices.length },
      milestones: { done: doneMilestones, total: milestoneRegistry.length },
    },
    blockers,
    nextAction,
  };
}
