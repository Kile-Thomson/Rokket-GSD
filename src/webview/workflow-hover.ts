// ============================================================
// Workflow Hover — rich popover for the header workflow badge.
// Shows milestone/slice/task titles, progress, risk, estimates,
// and the current slice's task checklist on hover or keyboard focus.
// ============================================================

import type { WorkflowState, DashboardData } from "../shared/types";

const SHOW_DELAY_MS = 200;
const HIDE_DELAY_MS = 150;
const MAX_CHECKLIST_TASKS = 8;

let badgeEl: HTMLElement | null = null;
let popoverEl: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

let currentState: WorkflowState | null = null;
let currentDashboard: DashboardData | null = null;
let hasState = false;

const PHASE_LABELS: Record<string, string> = {
  "pre-planning": "Pre-planning",
  "discussing": "Discussing",
  "researching": "Researching",
  "planning": "Planning",
  "executing": "Executing",
  "verifying": "Verifying",
  "summarizing": "Summarizing",
  "advancing": "Advancing",
  "completing-milestone": "Completing milestone",
  "replanning-slice": "Replanning slice",
  "complete": "Complete",
  "paused": "Paused",
  "blocked": "Blocked",
};

const AUTO_MODE_LABELS: Record<string, string> = {
  auto: "Auto-executing",
  next: "Auto (next unit)",
  paused: "Auto-mode paused",
};

/** Wire hover/focus listeners onto the workflow badge. */
export function init(badge: HTMLElement): void {
  badgeEl = badge;
  badge.addEventListener("mouseenter", scheduleShow);
  badge.addEventListener("mouseleave", scheduleHide);
  badge.addEventListener("focus", () => show());
  badge.addEventListener("blur", () => hide());
  badge.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

/** Latest workflow state from the extension (STATE.md parse). */
export function setWorkflowState(wf: WorkflowState | null): void {
  currentState = wf;
  hasState = true;
  if (popoverEl) renderInto(popoverEl);
}

/** Latest dashboard payload — provides slices, tasks, and registry detail. */
export function setDashboardData(data: DashboardData | null): void {
  currentDashboard = data;
  if (popoverEl) renderInto(popoverEl);
}

function scheduleShow(): void {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (popoverEl || showTimer) return;
  showTimer = setTimeout(() => { showTimer = null; show(); }, SHOW_DELAY_MS);
}

function scheduleHide(): void {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  // Keyboard focus keeps the popover open; blur/Escape close it instead
  if (badgeEl && document.activeElement === badgeEl) return;
  if (!popoverEl || hideTimer) return;
  hideTimer = setTimeout(() => { hideTimer = null; hide(); }, HIDE_DELAY_MS);
}

function show(): void {
  // Cancel a pending hide so focus during the hide delay keeps the popover
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (!badgeEl || popoverEl) return;
  // Nothing meaningful to show before any state has arrived
  if (!hasState && !currentDashboard) return;

  const pop = document.createElement("div");
  pop.className = "gsd-workflow-popover";
  pop.id = "workflowPopover";
  pop.setAttribute("role", "tooltip");
  renderInto(pop);

  // Keep the popover open while the pointer is over it
  pop.addEventListener("mouseenter", () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });
  pop.addEventListener("mouseleave", scheduleHide);

  badgeEl.setAttribute("aria-describedby", "workflowPopover");
  // Anchor to the badge's positioned wrapper (header) so it tracks layout
  badgeEl.insertAdjacentElement("afterend", pop);
  popoverEl = pop;
}

function hide(): void {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (popoverEl) {
    popoverEl.remove();
    popoverEl = null;
  }
  badgeEl?.removeAttribute("aria-describedby");
}

// ── Rendering ────────────────────────────────────────────────

function row(label: string, ...children: (HTMLElement | string)[]): HTMLElement {
  const r = document.createElement("div");
  r.className = "gsd-wf-pop-row";
  const l = document.createElement("span");
  l.className = "gsd-wf-pop-label";
  l.textContent = label;
  r.appendChild(l);
  const v = document.createElement("span");
  v.className = "gsd-wf-pop-value";
  for (const c of children) {
    if (typeof c === "string") v.appendChild(document.createTextNode(c));
    else v.appendChild(c);
  }
  r.appendChild(v);
  return r;
}

function meta(text: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "gsd-wf-pop-meta";
  s.textContent = text;
  return s;
}

function refText(id: string, title: string): string {
  return title ? `${id} — ${title}` : id;
}

function renderInto(pop: HTMLElement): void {
  pop.textContent = "";
  const wf = currentState;
  const d = currentDashboard;

  if (!wf) {
    const p = document.createElement("div");
    p.className = "gsd-wf-pop-empty";
    p.textContent = "Self-directed — no active GSD workflow.";
    pop.appendChild(p);
    return;
  }

  // Milestone: prefer dashboard title (same source, but registry adds position)
  if (wf.milestone) {
    const extras: HTMLElement[] = [];
    const registry = d?.milestoneRegistry ?? [];
    const idx = registry.findIndex((m) => m.id === wf.milestone!.id);
    if (idx >= 0) extras.push(meta(`${idx + 1} of ${registry.length} milestones`));
    const title = wf.milestone.title || registry[idx]?.title || "";
    pop.appendChild(row("Milestone", refText(wf.milestone.id, title), ...extras));
  }

  // Slice: title, risk, task progress
  const dashSlice = wf.slice ? (d?.slices ?? []).find((s) => s.id === wf.slice!.id) : undefined;
  if (wf.slice) {
    const extras: HTMLElement[] = [];
    if (dashSlice?.risk && dashSlice.risk !== "low") extras.push(meta(`risk: ${dashSlice.risk}`));
    const prog = dashSlice?.taskProgress
      ?? (dashSlice ? { done: dashSlice.tasks.filter((t) => t.done).length, total: dashSlice.tasks.length } : null);
    if (prog && prog.total > 0) extras.push(meta(`${prog.done}/${prog.total} tasks done`));
    const title = wf.slice.title || dashSlice?.title || "";
    pop.appendChild(row("Slice", refText(wf.slice.id, title), ...extras));
  }

  // Task: title + estimate
  if (wf.task) {
    const extras: HTMLElement[] = [];
    const dashTask = dashSlice?.tasks.find((t) => t.id === wf.task!.id);
    if (dashTask?.estimate) extras.push(meta(`est: ${dashTask.estimate}`));
    const title = wf.task.title || dashTask?.title || "";
    pop.appendChild(row("Task", refText(wf.task.id, title), ...extras));
  }

  // Phase + auto-mode status
  const statusParts: string[] = [];
  const phaseLabel = PHASE_LABELS[wf.phase] || (wf.phase !== "unknown" ? wf.phase : "");
  if (phaseLabel) statusParts.push(phaseLabel);
  if (wf.autoMode && AUTO_MODE_LABELS[wf.autoMode]) statusParts.push(AUTO_MODE_LABELS[wf.autoMode]);
  if (statusParts.length > 0) {
    pop.appendChild(row("Status", statusParts.join(" · ")));
  }

  // Mini checklist of the active slice's tasks
  if (dashSlice && dashSlice.tasks.length > 0) {
    const list = document.createElement("ul");
    list.className = "gsd-wf-pop-tasks";
    const tasks = dashSlice.tasks.slice(0, MAX_CHECKLIST_TASKS);
    for (const t of tasks) {
      const li = document.createElement("li");
      li.className = "gsd-wf-pop-task" + (t.done ? " done" : "") + (t.id === wf.task?.id ? " active" : "");
      const mark = document.createElement("span");
      mark.className = "gsd-wf-pop-task-mark";
      mark.textContent = t.done ? "✓" : t.id === wf.task?.id ? "▸" : "○";
      li.appendChild(mark);
      const label = document.createElement("span");
      label.className = "gsd-wf-pop-task-title";
      label.textContent = `${t.id}: ${t.title}`;
      li.appendChild(label);
      list.appendChild(li);
    }
    if (dashSlice.tasks.length > MAX_CHECKLIST_TASKS) {
      const li = document.createElement("li");
      li.className = "gsd-wf-pop-task more";
      li.textContent = `+${dashSlice.tasks.length - MAX_CHECKLIST_TASKS} more`;
      list.appendChild(li);
    }
    pop.appendChild(list);
  }

  // Next pending task (after the active one) when not shown in checklist context
  if (dashSlice && !wf.task) {
    const next = dashSlice.tasks.find((t) => !t.done);
    if (next) pop.appendChild(row("Next", refText(next.id, next.title)));
  }

  if (pop.childElementCount === 0) {
    const p = document.createElement("div");
    p.className = "gsd-wf-pop-empty";
    p.textContent = "No active workflow details.";
    pop.appendChild(p);
  }
}

/** Test-only: reset module state between tests. */
export function _resetForTest(): void {
  hide();
  badgeEl = null;
  currentState = null;
  currentDashboard = null;
  hasState = false;
}
