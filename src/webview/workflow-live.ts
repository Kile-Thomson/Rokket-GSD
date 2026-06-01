// ============================================================
// Workflow Live Panel (webview)
//
// A turn-independent floating panel that shows Claude Code Workflow fan-out as it
// happens — fed by the extension's proactive filesystem watcher, not by RPC tool
// events. It exists because the originating `Workflow` tool block isn't rendered
// into the conversation until the turn ends (the runtime batches tool events),
// so there's nothing in the message DOM to attach to mid-run. Like the
// diagnostics overlay, this panel is fixed to document.body and re-rendered on
// each update, so it survives the conversation DOM being rebuilt.
//
// Each card is keyed by the run id (carried in data.toolCallId). Cards appear as
// the watcher discovers a live run and are retracted shortly after completion.
// ============================================================

import type { WorkflowProgressData } from "../shared/types";
import { buildPanelHtml } from "./workflow-progress";

const CONTAINER_ID = "gsd-wf-live";

/** Live cards keyed by run id. */
const cards = new Map<string, WorkflowProgressData>();

function isLive(status: WorkflowProgressData["status"]): boolean {
  return status === "running" || status === "launching" || status === "stalled";
}

/** Upsert a live workflow card and re-render the panel. */
export function update(data: WorkflowProgressData): void {
  cards.set(data.toolCallId, data);
  render();
}

/** Retract a completed/dismissed run's card. */
export function remove(runId: string): void {
  if (cards.delete(runId)) render();
}

/** Clear all cards (new conversation / session switch / shutdown). */
export function reset(): void {
  cards.clear();
  const el = document.getElementById(CONTAINER_ID);
  if (el) el.remove();
}

function render(): void {
  const body = document.body;
  if (!body) return;

  let el = document.getElementById(CONTAINER_ID);
  if (cards.size === 0) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = CONTAINER_ID;
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-label", "Live workflow progress");
    body.appendChild(el);
  }

  const list = [...cards.values()].sort((a, b) => a.startedAt - b.startedAt);
  const runningCount = list.filter((d) => isLive(d.status)).length;
  const summary = runningCount > 0
    ? `${runningCount} running · ${list.length}`
    : `${list.length}`;

  const title = `<div class="gsd-wf-live-title"><span class="gsd-wf-live-glyph">⋔</span> Workflows <span class="gsd-wf-live-count">${summary}</span></div>`;

  const body_ = list
    .map(
      (d) =>
        `<div class="gsd-workflow-panel gsd-wf-live-card status-${d.status}">${buildPanelHtml(d)}</div>`,
    )
    .join("");

  el.innerHTML = title + body_;
}
