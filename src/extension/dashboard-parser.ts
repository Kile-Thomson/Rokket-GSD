import * as fs from "fs";
import * as path from "path";
import { parseGsdWorkflowState } from "./state-parser";

// ============================================================
// Dashboard Parser
// Reads .gsd/ project files and builds a dashboard model
// for the webview to render.
// ============================================================

export interface DashboardSlice {
  id: string;
  title: string;
  done: boolean;
  risk: string;
  active: boolean;
  tasks: DashboardTask[];
  taskProgress?: { done: number; total: number };
}

export interface DashboardTask {
  id: string;
  title: string;
  done: boolean;
  active: boolean;
  estimate?: string;
}

export interface DashboardData {
  hasMilestone: boolean;
  milestone: { id: string; title: string } | null;
  slice: { id: string; title: string } | null;
  task: { id: string; title: string } | null;
  phase: string;
  slices: DashboardSlice[];
  progress: {
    tasks: { done: number; total: number };
    slices: { done: number; total: number };
  };
}

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
 * Find a file matching a pattern in a directory.
 */
function findFile(dir: string, suffix: string): string | null {
  try {
    const files = fs.readdirSync(dir);
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

  const wfState = await parseGsdWorkflowState(cwd);
  if (!wfState?.milestone) return null;

  const mid = wfState.milestone.id;
  const milestoneDir = path.join(gsdDir, "milestones", mid);

  // Parse roadmap
  const roadmapFile = findFile(milestoneDir, "-ROADMAP.md");
  const slices: DashboardSlice[] = [];

  if (roadmapFile) {
    const content = fs.readFileSync(roadmapFile, "utf-8");
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
        const planFile = findFile(sliceDir, "-PLAN.md");
        if (planFile) {
          const planContent = fs.readFileSync(planFile, "utf-8");
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

  return {
    hasMilestone: true,
    milestone: wfState.milestone,
    slice: wfState.slice,
    task: wfState.task,
    phase: wfState.phase,
    slices,
    progress: {
      tasks: { done: tasksDone, total: tasksTotal },
      slices: { done: doneSlices, total: slices.length },
    },
  };
}
