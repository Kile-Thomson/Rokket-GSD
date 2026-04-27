import { state, type AssistantTurn, pruneOldEntries } from "../state";
import {
  escapeAttr,
  renderMarkdown,
} from "../helpers";
import { evacuateDialogsFromTurn } from "../ui-dialogs";
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
      evacuateDialogsFromTurn(cte);
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
}
