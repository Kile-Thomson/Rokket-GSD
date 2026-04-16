import { state, type AssistantTurn, pruneOldEntries } from "../state";
import {
  escapeHtml,
  escapeAttr,
  formatDuration,
  formatTokens,
  renderMarkdown,
} from "../helpers";
import { PARALLEL_TIME_SAVED_THRESHOLD_MS } from "../../shared/constants";
import { buildStaleEchoHtml, buildTimestampHtml, patchToolBlockElement } from "./html-builders";
import {
  stopElapsedTimer,
  cancelPendingRender,
  getCurrentTurnElement,
  getPriorTurnElements,
  getSegmentElements,
  getMessagesContainer,
  resetStreamingInternals,
  detectStaleEcho,
} from "./streaming";

let activeBatchElement: HTMLElement | null = null;
let finalizedBatchElement: HTMLElement | null = null;

export function finalizeCurrentTurn(): void {
  if (!state.currentTurn) return;
  stopElapsedTimer();
  cancelPendingRender();

  const turn = state.currentTurn;
  turn.isComplete = true;

  for (const [, tc] of turn.toolCalls) { tc.isRunning = false; }
  for (const seg of turn.segments) {
    if (seg.type === "server_tool" && !seg.isComplete) seg.isComplete = true;
  }

  const isStaleEcho = detectStaleEcho(turn);
  turn.isStaleEcho = isStaleEcho;

  const existingEntry = state.entries.find(e => e.type === "assistant" && e.turn === turn);
  if (!existingEntry) {
    state.entries.push({ id: turn.id, type: "assistant", turn, timestamp: turn.timestamp });
    pruneOldEntries(getMessagesContainer());
  }

  const cte = getCurrentTurnElement();
  const priorElements = getPriorTurnElements();
  if (cte) {
    cte.classList.remove("streaming");
    if (priorElements.length > 0) {
      for (const prior of priorElements) prior.classList.remove("streaming");
      if (cte.innerHTML.trim() === "") cte.remove();
    } else if (isStaleEcho) {
      cte.classList.add("gsd-stale-echo");
      cte.innerHTML = buildStaleEchoHtml(turn);
    } else {
      finalizeStreamingDom(turn, cte);
    }
  }

  state.currentTurn = null;
  resetStreamingInternals();
}

function finalizeStreamingDom(turn: AssistantTurn, container: HTMLElement): void {
  const segmentEls = getSegmentElements();
  for (let i = 0; i < turn.segments.length; i++) {
    const seg = turn.segments[i];
    const el = segmentEls.get(i);
    if (!el) continue;

    if (seg.type === "text") {
      const text = seg.chunks.join("");
      if (text) el.innerHTML = renderMarkdown(text);
    } else if (seg.type === "thinking") {
      if (el.tagName === "DETAILS") el.removeAttribute("open");
    } else if (seg.type === "server_tool") {
      const card = el.querySelector<HTMLElement>(".gsd-server-tool-card");
      if (card) {
        card.classList.remove("running");
        card.classList.add("done");
        const spinner = card.querySelector(".gsd-tool-spinner");
        if (spinner) spinner.outerHTML = `<span class="gsd-server-tool-check">✓</span>`;
      }
    }
  }

  for (const [, tc] of turn.toolCalls) {
    const toolEl = container.querySelector<HTMLElement>(`[data-tool-id="${tc.id}"]`);
    if (toolEl) {
      const block = toolEl.classList.contains("gsd-tool-block") ? toolEl : toolEl.querySelector<HTMLElement>(".gsd-tool-block");
      if (block) patchToolBlockElement(block, tc);
    }
  }

  const textContent = turn.segments
    .filter(s => s.type === "text")
    .map(s => s.chunks.join(""))
    .join("\n\n");

  if (textContent) {
    const actionsHtml = `<div class="gsd-turn-actions">` +
      `<button class="gsd-copy-response-btn" data-copy-text="${escapeAttr(textContent)}" title="Copy response" aria-label="Copy response">` +
      `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 4h8v8H4V4zm1 1v6h6V5H5zm-3-3h8v1H3v7H2V2h8z"/></svg> Copy</button>` +
      (turn.timestamp ? buildTimestampHtml(turn.timestamp) : "") +
      `</div>`;
    container.insertAdjacentHTML("beforeend", actionsHtml);
  } else if (turn.timestamp) {
    container.insertAdjacentHTML("beforeend", buildTimestampHtml(turn.timestamp));
  }
}

export function resetStreamingState(): void {
  resetStreamingInternals();
  stopElapsedTimer();
  activeBatchElement = null;
  finalizedBatchElement = null;
}

export function createParallelBatch(toolIds: string[]): void {
  const cte = getCurrentTurnElement();
  if (!cte) return;

  const batch = document.createElement("div");
  batch.className = "gsd-parallel-batch running";
  batch.dataset.batchSize = String(toolIds.length);

  const header = document.createElement("div");
  header.className = "gsd-parallel-batch-header";
  header.innerHTML =
    `<span class="gsd-tool-spinner"></span>` +
    `<span class="gsd-parallel-batch-label">${toolIds.length} tools running in parallel</span>` +
    `<span class="gsd-parallel-batch-elapsed elapsed-live"></span>`;

  const content = document.createElement("div");
  content.className = "gsd-parallel-batch-content";
  batch.appendChild(header);
  batch.appendChild(content);

  let firstEl: HTMLElement | null = null;
  for (const toolId of toolIds) {
    const el = cte.querySelector<HTMLElement>(`.gsd-tool-segment[data-tool-id="${toolId}"]`);
    if (el && (!firstEl || el.compareDocumentPosition(firstEl) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      firstEl = el;
    }
  }

  if (!firstEl) { cte.appendChild(batch); } else { firstEl.parentNode!.insertBefore(batch, firstEl); }

  for (const toolId of toolIds) {
    const el = cte.querySelector<HTMLElement>(`.gsd-tool-segment[data-tool-id="${toolId}"]`);
    if (el) content.appendChild(el);
  }

  activeBatchElement = batch;
  batch.dataset.startTime = String(Date.now());
}

export function expandParallelBatch(toolId: string): void {
  const cte = getCurrentTurnElement();
  if (!activeBatchElement || !cte) return;
  const content = activeBatchElement.querySelector(".gsd-parallel-batch-content");
  if (!content) return;
  const el = cte.querySelector<HTMLElement>(`.gsd-tool-segment[data-tool-id="${toolId}"]`);
  if (el) content.appendChild(el);
  const count = content.children.length;
  activeBatchElement.dataset.batchSize = String(count);
  const label = activeBatchElement.querySelector(".gsd-parallel-batch-label");
  if (label) label.textContent = `${count} tools running in parallel`;
}

export function reopenParallelBatch(toolId: string): void {
  const cte = getCurrentTurnElement();
  if (!finalizedBatchElement || !cte) return;
  activeBatchElement = finalizedBatchElement;
  finalizedBatchElement = null;
  activeBatchElement.classList.remove("done");
  activeBatchElement.classList.add("running");
  const icon = activeBatchElement.querySelector(".gsd-parallel-batch-header .gsd-tool-icon");
  if (icon) {
    const spinner = document.createElement("span");
    spinner.className = "gsd-tool-spinner";
    icon.replaceWith(spinner);
  }
  activeBatchElement.dataset.startTime = String(Date.now());

  const content = activeBatchElement.querySelector(".gsd-parallel-batch-content");
  if (!content) return;
  const el = cte.querySelector<HTMLElement>(`.gsd-tool-segment[data-tool-id="${toolId}"]`);
  if (el) content.appendChild(el);
  const count = content.children.length;
  activeBatchElement.dataset.batchSize = String(count);
  const label = activeBatchElement.querySelector(".gsd-parallel-batch-label");
  if (label) label.textContent = `${count} tools running in parallel`;
}

export function updateParallelBatchStatus(): void {
  if (!activeBatchElement || !state.currentTurn) return;
  const content = activeBatchElement.querySelector(".gsd-parallel-batch-content");
  if (!content) return;

  let running = 0, done = 0, errored = 0;
  for (const el of Array.from(content.children) as HTMLElement[]) {
    const toolId = el.dataset.toolId;
    if (!toolId) continue;
    const tc = state.currentTurn.toolCalls.get(toolId);
    if (!tc) continue;
    if (tc.isRunning) running++;
    else if (tc.isError) errored++;
    else done++;
  }

  const total = running + done + errored;
  const label = activeBatchElement.querySelector(".gsd-parallel-batch-label");
  if (label && running > 0) {
    label.textContent = `${total} tools — ${done + errored} done, ${running} running`;
  }
  updateBatchElapsed();
}

export function finalizeParallelBatch(turnUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } } | null): void {
  if (!activeBatchElement || !state.currentTurn) return;

  const startTime = parseInt(activeBatchElement.dataset.startTime || "0", 10);
  const totalDuration = startTime ? Date.now() - startTime : 0;

  const content = activeBatchElement.querySelector(".gsd-parallel-batch-content");
  const total = content ? content.children.length : 0;

  let errored = 0;
  if (content) {
    for (const el of Array.from(content.children) as HTMLElement[]) {
      const toolId = el.dataset.toolId;
      if (!toolId) continue;
      const tc = state.currentTurn.toolCalls.get(toolId);
      if (tc?.isError) errored++;
    }
  }

  activeBatchElement.classList.remove("running");
  activeBatchElement.classList.add("done");

  const spinner = activeBatchElement.querySelector(".gsd-parallel-batch-header .gsd-tool-spinner");
  if (spinner) {
    const icon = document.createElement("span");
    icon.className = errored > 0 ? "gsd-tool-icon error" : "gsd-tool-icon success";
    icon.textContent = errored > 0 ? "✗" : "✓";
    spinner.replaceWith(icon);
  }

  let sequentialTotal = 0;
  let earliestStart = Infinity;
  let latestEnd = 0;
  if (content) {
    for (const el of Array.from(content.children) as HTMLElement[]) {
      const toolId = el.dataset.toolId;
      if (!toolId) continue;
      const tc = state.currentTurn.toolCalls.get(toolId);
      if (tc?.startTime && tc.endTime) {
        sequentialTotal += tc.endTime - tc.startTime;
        if (tc.startTime < earliestStart) earliestStart = tc.startTime;
        if (tc.endTime > latestEnd) latestEnd = tc.endTime;
      }
    }
  }
  const actualParallelDuration = latestEnd > earliestStart ? latestEnd - earliestStart : 0;

  const label = activeBatchElement.querySelector(".gsd-parallel-batch-label");
  if (label) {
    const durationStr = formatDuration(actualParallelDuration || totalDuration);
    const statusText = errored > 0
      ? `${total} tools completed (${errored} failed) in ${durationStr}`
      : `${total} tools completed in ${durationStr}`;
    label.textContent = statusText;
  }

  const existingFooter = activeBatchElement.querySelector(".gsd-parallel-batch-footer");
  if (!existingFooter) {
    const pills: string[] = [];

    if (sequentialTotal > 0 && actualParallelDuration > 0) {
      pills.push(`${total} tools`);
      pills.push(`sequential: ${formatDuration(sequentialTotal)}`);
      pills.push(`parallel: ${formatDuration(actualParallelDuration)}`);
      const saved = sequentialTotal - actualParallelDuration;
      if (saved > PARALLEL_TIME_SAVED_THRESHOLD_MS) {
        const pct = Math.round((saved / sequentialTotal) * 100);
        pills.push(`saved ${formatDuration(saved)} (${pct}%)`);
      }
    }

    if (turnUsage) {
      if (turnUsage.input) pills.push(`↑${formatTokens(turnUsage.input)}`);
      if (turnUsage.output) pills.push(`↓${formatTokens(turnUsage.output)}`);
      if (turnUsage.cacheRead) pills.push(`R${formatTokens(turnUsage.cacheRead)}`);
      if (turnUsage.cacheWrite) pills.push(`W${formatTokens(turnUsage.cacheWrite)}`);
      if (turnUsage.cost?.total) pills.push(`$${turnUsage.cost.total.toFixed(4)}`);
    }

    if (pills.length > 0) {
      const footer = document.createElement("div");
      footer.className = "gsd-parallel-batch-footer";
      footer.innerHTML = pills.map(p => `<span class="gsd-batch-pill">${escapeHtml(p)}</span>`).join("");
      activeBatchElement.appendChild(footer);
    }
  }

  const elapsed = activeBatchElement.querySelector(".gsd-parallel-batch-elapsed");
  if (elapsed) elapsed.textContent = "";

  finalizedBatchElement = activeBatchElement;
  activeBatchElement = null;
}

export function updateBatchElapsed(): void {
  if (!activeBatchElement) return;
  const startTime = parseInt(activeBatchElement.dataset.startTime || "0", 10);
  if (!startTime) return;
  const elapsed = activeBatchElement.querySelector(".gsd-parallel-batch-elapsed");
  if (elapsed) elapsed.textContent = formatDuration(Date.now() - startTime);
}

export function getActiveBatchElement(): HTMLElement | null { return activeBatchElement; }
export function getFinalizedBatchElement(): HTMLElement | null { return finalizedBatchElement; }
export function clearActiveBatch(): void { activeBatchElement = null; finalizedBatchElement = null; }

export function syncBatchState(trackedIds: Set<string>): void {
  const cte = getCurrentTurnElement();
  if (!cte || trackedIds.size < 2) return;

  const readySegments: { id: string; el: HTMLElement }[] = [];
  for (const toolId of trackedIds) {
    const el = cte.querySelector<HTMLElement>(`.gsd-tool-segment[data-tool-id="${toolId}"]`);
    if (el) readySegments.push({ id: toolId, el });
  }
  if (readySegments.length < 2) return;

  if (!activeBatchElement) {
    const canReopen =
      finalizedBatchElement &&
      Array.from(
        finalizedBatchElement.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]"),
      ).some((el) => trackedIds.has(el.dataset.toolId!));

    if (canReopen && finalizedBatchElement) {
      activeBatchElement = finalizedBatchElement;
      finalizedBatchElement = null;
      activeBatchElement.classList.remove("done");
      activeBatchElement.classList.add("running");
      activeBatchElement.querySelector(".gsd-parallel-batch-footer")?.remove();
      const elapsed = activeBatchElement.querySelector(".gsd-parallel-batch-elapsed");
      if (elapsed) elapsed.textContent = "";
      const icon = activeBatchElement.querySelector(".gsd-parallel-batch-header .gsd-tool-icon");
      if (icon) {
        const spinner = document.createElement("span");
        spinner.className = "gsd-tool-spinner";
        icon.replaceWith(spinner);
      }
      activeBatchElement.dataset.startTime = String(Date.now());
    } else {
      const batch = document.createElement("div");
      batch.className = "gsd-parallel-batch running";
      batch.dataset.batchSize = String(readySegments.length);

      const header = document.createElement("div");
      header.className = "gsd-parallel-batch-header";
      header.innerHTML =
        `<span class="gsd-tool-spinner"></span>` +
        `<span class="gsd-parallel-batch-label">${readySegments.length} tools running in parallel</span>` +
        `<span class="gsd-parallel-batch-elapsed elapsed-live"></span>`;

      const content = document.createElement("div");
      content.className = "gsd-parallel-batch-content";
      batch.appendChild(header);
      batch.appendChild(content);

      let firstEl: HTMLElement | null = null;
      for (const { el } of readySegments) {
        if (!firstEl || el.compareDocumentPosition(firstEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
          firstEl = el;
        }
      }
      if (firstEl && firstEl.parentNode) { firstEl.parentNode.insertBefore(batch, firstEl); }
      else { cte.appendChild(batch); }

      activeBatchElement = batch;
      batch.dataset.startTime = String(Date.now());
    }
  }

  const content = activeBatchElement.querySelector(".gsd-parallel-batch-content");
  if (!content) return;

  for (const { el } of readySegments) {
    if (!content.contains(el)) content.appendChild(el);
  }

  const count = content.children.length;
  activeBatchElement.dataset.batchSize = String(count);
  const label = activeBatchElement.querySelector(".gsd-parallel-batch-label");
  if (label) label.textContent = `${count} tools running in parallel`;
}
