// ============================================================
// Workflow Live Card (webview)
//
// Renders Claude Code Workflow fan-out inline in the conversation, as it happens.
// It is fed by the extension's proactive filesystem watcher (`workflow_live`),
// NOT by RPC tool events — the runtime returns the `Workflow` tool instantly and
// runs the fan-out in the background, batching its RPC events until the turn
// ends, so the originating tool block can't carry live progress. The watcher
// polls the run's journal on disk and pushes a snapshot the moment a run starts
// writing, well before the turn finalizes.
//
// Each run gets one card, keyed by its run id, appended into the conversation
// (`#messagesContainer`). That container is appended to — not rebuilt — by
// streaming and finalization, so an inline card placed there survives the turn
// ending. A 1s
// heartbeat re-attaches any live card that a rebuild nonetheless dropped, and
// terminal cards persist as a permanent transcript record (the watcher's
// post-completion "remove" only ends liveness tracking, it doesn't erase the
// rendered card). Everything is cleared on a new conversation / session switch.
// ============================================================

import type { WorkflowProgressData } from "../shared/types";
import { buildPanelHtml, noteMessage } from "./workflow-progress";

const CARD_CLASS = "gsd-wf-inline";
const HEARTBEAT_INTERVAL_MS = 1000;

/** Latest snapshot per run id (drives the heartbeat's re-attach). */
const latest = new Map<string, WorkflowProgressData>();

/** Self-healing re-attach timer — runs only while at least one run is live. */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Live = still producing progress; terminal cards don't need re-attaching. */
function isLive(status: WorkflowProgressData["status"]): boolean {
  return status === "running" || status === "launching" || status === "stalled";
}

/**
 * The conversation scroll container the renderer appends turn entries into.
 * Production markup mounts it as `#messagesContainer` (see index.ts) — there is
 * no `#messages` element in the real webview, only in older test fixtures, so
 * targeting `#messages` silently dropped the card onto <body> where it rendered
 * nowhere visible. Prefer the real id; keep `#messages` as a last-ditch fallback.
 */
function messagesEl(): HTMLElement | null {
  return document.getElementById("messagesContainer") ?? document.getElementById("messages");
}

function findCard(runId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${CARD_CLASS}[data-workflow-run-id="${cssEscape(runId)}"]`);
}

/**
 * Place a fresh card just *above* the most recent conversation entry — the
 * assistant turn that launched the workflow — so it reads as a header for that
 * turn rather than trailing underneath its text. Falls back to appending when no
 * entry has rendered yet (defensive; the launching turn always exists by the time
 * a run surfaces). Insertion happens once, at create time; an existing card is
 * never moved, so later turns don't shuffle a settled record.
 */
function insertCardInto(container: HTMLElement, card: HTMLElement): void {
  const entries = container.querySelectorAll<HTMLElement>(".gsd-entry");
  const anchor = entries.length ? entries[entries.length - 1] : null;
  if (anchor) container.insertBefore(card, anchor);
  else container.appendChild(card);
}

/** Find this run's card, creating and inserting it above the launching turn if absent. */
function ensureCard(runId: string): HTMLElement {
  let card = findCard(runId);
  if (!card) {
    card = document.createElement("div");
    card.className = `gsd-workflow-panel ${CARD_CLASS}`;
    card.dataset.workflowRunId = runId;
    card.setAttribute("aria-live", "polite");
    insertCardInto(messagesEl() ?? document.body, card);
  }
  return card;
}

function paint(card: HTMLElement, data: WorkflowProgressData): void {
  card.className = `gsd-workflow-panel ${CARD_CLASS} status-${data.status}`;
  card.innerHTML = buildPanelHtml(data);
}

/** Upsert a run's inline card and re-render it in place. */
export function update(data: WorkflowProgressData): void {
  latest.set(data.toolCallId, data);
  noteMessage(data);
  paint(ensureCard(data.toolCallId), data);
  if (isLive(data.status)) startHeartbeat();
}

/**
 * End liveness tracking for a run. The rendered card stays in the conversation
 * as a permanent record — the watcher sends this only after a run has settled
 * (it was previously used to retract the floating overlay). The card is cleared
 * by {@link reset} when the conversation changes.
 */
export function remove(runId: string): void {
  latest.delete(runId);
}

/** Clear all inline cards and tracking (new conversation / session switch / shutdown). */
export function reset(): void {
  latest.clear();
  stopHeartbeat();
  document.querySelectorAll(`.${CARD_CLASS}`).forEach((el) => el.remove());
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Re-attach any live card that has gone missing from the conversation DOM.
 *
 * Cards live in `#messagesContainer`, which streaming/finalization append to
 * rather than rebuild, so a card placed there normally persists across the turn
 * ending. The
 * heartbeat is cheap insurance: if some rebuild does drop a still-live run's
 * card, it reappears within a second instead of waiting on the next watcher poll.
 * Present cards are left untouched (no flicker). Terminal cards are not tracked
 * here, so they're never resurrected. The timer stops once nothing is live.
 */
function heartbeatTick(): void {
  let anyLive = false;
  for (const [runId, data] of latest) {
    if (!isLive(data.status)) continue;
    anyLive = true;
    if (!findCard(runId)) paint(ensureCard(runId), data);
  }
  if (!anyLive) stopHeartbeat();
}

/** Minimal CSS.escape fallback for attribute-selector safety. */
function cssEscape(value: string): string {
  if (typeof (window as unknown as { CSS?: { escape?: (s: string) => string } }).CSS?.escape === "function") {
    return (window as unknown as { CSS: { escape: (s: string) => string } }).CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, "\\$&");
}
