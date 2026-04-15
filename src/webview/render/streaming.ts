import { state, type ChatEntry, type ToolCallState } from "../state";
import {
  escapeHtml,
  scrollToBottom,
  resetAutoScroll,
  lexMarkdown,
  parseTokens,
  sanitizeAndPostProcess,
} from "../helpers";
import { shouldCollapseWithPredecessor, collapseToolIntoGroup } from "../tool-grouping";
import { SHORT_TEXT_THRESHOLD, TURN_COALESCE_WINDOW_MS } from "../../shared/constants";
import { registerCleanup } from "../dispose";
import { createEntryElement, buildToolCallHtml, patchToolBlockElement } from "./html-builders";

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let currentTurnElement: HTMLElement | null = null;
let priorTurnElements: HTMLElement[] = [];
let _splitSegmentBarrier = -1;
const segmentElements = new Map<number, HTMLElement>();
let _activeSegmentIndex = -1;
let pendingTextRender: number | null = null;
const incrementalState = new Map<number, {
  frozenBlockCount: number;
  lastLexedText: string;
  lastTokens: any[];
  textLengthAtLastRaf: number;
}>();
const liveTextNodes = new Map<number, Text>();
let elapsedTimerHandle: ReturnType<typeof setInterval> | null = null;
let _onElapsedTick: (() => void) | null = null;

export function registerElapsedTick(cb: () => void): void { _onElapsedTick = cb; }
export function getMessagesContainer(): HTMLElement { return messagesContainer; }
export function getSegmentElements(): Map<number, HTMLElement> { return segmentElements; }
export function setCurrentTurnElement(el: HTMLElement | null): void { currentTurnElement = el; }
export function getPriorTurnElements(): HTMLElement[] { return priorTurnElements; }
export function setPriorTurnElements(v: HTMLElement[]): void { priorTurnElements = v; }
export function cancelPendingRender(): void {
  if (pendingTextRender !== null) { cancelAnimationFrame(pendingTextRender); pendingTextRender = null; }
}
export function resetStreamingInternals(): void {
  currentTurnElement = null;
  priorTurnElements = [];
  _splitSegmentBarrier = -1;
  segmentElements.clear();
  incrementalState.clear();
  liveTextNodes.clear();
  _activeSegmentIndex = -1;
}

function startElapsedTimer(): void {
  if (elapsedTimerHandle) return;
  elapsedTimerHandle = setInterval(() => {
    if (!state.currentTurn) { stopElapsedTimer(); return; }
    let anyRunning = false;
    for (const [, tc] of state.currentTurn.toolCalls) {
      if (tc.isRunning) { anyRunning = true; updateToolSegmentElement(tc.id); }
    }
    _onElapsedTick?.();
    if (!anyRunning) stopElapsedTimer();
  }, 1000);
}

export function stopElapsedTimer(): void {
  if (elapsedTimerHandle) { clearInterval(elapsedTimerHandle); elapsedTimerHandle = null; }
}

export function clearMessages(): void {
  const els = messagesContainer.querySelectorAll(".gsd-entry");
  els.forEach((el) => el.remove());
  messagesContainer.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
  messagesContainer.querySelector(".gsd-pruned-indicator")?.remove();
  resetAutoScroll();
}

export function renderNewEntry(entry: ChatEntry): void {
  messagesContainer.appendChild(createEntryElement(entry));
}
export function getCurrentTurnElement(): HTMLElement | null { return currentTurnElement; }
export function showPendingDots(): void {
  const container = ensureCurrentTurnElement();
  if (!container.querySelector(".gsd-thinking-dots")) {
    const dots = document.createElement("div");
    dots.className = "gsd-thinking-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";
    container.appendChild(dots);
  }
}
function removePendingDotsFromContainer(container: HTMLElement): void {
  container.querySelector(".gsd-thinking-dots")?.remove();
}

export function ensureCurrentTurnElement(): HTMLElement {
  if (!currentTurnElement) {
    const candidates = messagesContainer.querySelectorAll<HTMLElement>(
      ".gsd-entry-assistant.streaming"
    );
    let existing: HTMLElement | null = null;
    for (const el of Array.from(candidates)) {
      const onlyDots = el.children.length === 1 &&
        el.firstElementChild?.classList.contains("gsd-thinking-dots");
      if (onlyDots) { existing = el; break; }
    }
    if (existing) {
      const newId = state.currentTurn?.id;
      if (newId && existing.dataset.entryId !== newId) {
        existing.dataset.entryId = newId;
      }
      currentTurnElement = existing;
      welcomeScreen.classList.add("gsd-hidden");
    } else {
      const el = document.createElement("div");
      el.className = "gsd-entry gsd-entry-assistant streaming";
      el.dataset.entryId = state.currentTurn?.id || "stream";
      messagesContainer.appendChild(el);
      currentTurnElement = el;
      welcomeScreen.classList.add("gsd-hidden");
    }
  }
  return currentTurnElement;
}

export function reattachTurnElement(entryId: string): void {
  const el = messagesContainer.querySelector(`[data-entry-id="${entryId}"]`) as HTMLElement | null;
  if (el) { currentTurnElement = el; el.classList.add("streaming"); }
  else { ensureCurrentTurnElement(); }
}

export function appendToTextSegment(segType: "text" | "thinking", delta: string): void {
  if (!state.currentTurn) return;
  const turn = state.currentTurn;
  const segments = turn.segments;
  let segIdx: number;
  const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
  if (lastSeg && lastSeg.type === segType && (segments.length - 1) > _splitSegmentBarrier) {
    segIdx = segments.length - 1;
    lastSeg.chunks.push(delta);
  } else {
    segIdx = segments.length;
    segments.push({ type: segType, chunks: [delta] });
  }
  _activeSegmentIndex = segIdx;

  if (segType === "text") {
    const liveNode = liveTextNodes.get(segIdx);
    if (liveNode) {
      const seg = turn.segments[segIdx];
      if (seg.type === "text") {
        const incState = incrementalState.get(segIdx);
        const base = incState?.textLengthAtLastRaf ?? 0;
        const fullText = seg.chunks.join("");
        liveNode.data = fullText.slice(base);
      }
    } else if (!segmentElements.has(segIdx)) {
      const container = ensureCurrentTurnElement();
      removePendingDotsFromContainer(container);
      const el = document.createElement("div");
      el.className = "gsd-assistant-text";
      const seg = turn.segments[segIdx];
      const node = document.createTextNode(
        seg.type === "text" ? seg.chunks.join("") : ""
      );
      el.appendChild(node);
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
      liveTextNodes.set(segIdx, node);
    }
  } else if (segType === "thinking") {
    const el = segmentElements.get(segIdx);
    if (el) {
      const content = el.querySelector(".gsd-thinking-content");
      if (content) {
        const seg = turn.segments[segIdx];
        if (seg.type === "thinking") content.textContent = seg.chunks.join("");
      }
    } else if (!segmentElements.has(segIdx)) {
      const container = ensureCurrentTurnElement();
      removePendingDotsFromContainer(container);
      const el = document.createElement("details");
      el.className = "gsd-thinking-block";
      el.setAttribute("open", "");
      el.innerHTML = `<summary class="gsd-thinking-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
        <span class="gsd-thinking-label">Thinking</span>
        <span class="gsd-thinking-lines"></span>
      </summary>
      <div class="gsd-thinking-content"></div>`;
      const seg = turn.segments[segIdx];
      if (seg.type === "thinking") {
        const content = el.querySelector(".gsd-thinking-content");
        if (content) content.textContent = seg.chunks.join("");
      }
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }
  }

  if (pendingTextRender === null) {
    pendingTextRender = requestAnimationFrame(() => {
      pendingTextRender = null;
      renderTextSegment(segIdx);
      scrollToBottom(messagesContainer);
    });
  }
}

export function appendToolSegmentElement(tc: ToolCallState, segIdx: number): void {
  const container = ensureCurrentTurnElement();
  removePendingDotsFromContainer(container);
  const el = document.createElement("div");
  el.className = "gsd-tool-segment";
  el.dataset.segIdx = String(segIdx);
  el.dataset.toolId = tc.id;
  el.innerHTML = buildToolCallHtml(tc);
  insertSegmentElement(container, segIdx, el);
  segmentElements.set(segIdx, el);
  if (tc.isRunning) startElapsedTimer();
}

export function appendServerToolSegment(toolId: string, toolName: string, input?: unknown): void {
  if (!state.currentTurn) return;
  const segIdx = state.currentTurn.segments.length;
  state.currentTurn.segments.push({ type: "server_tool", serverToolId: toolId, name: toolName, input, isComplete: false });
  const container = ensureCurrentTurnElement();
  removePendingDotsFromContainer(container);
  const el = document.createElement("div");
  el.className = "gsd-server-tool-segment";
  el.dataset.segIdx = String(segIdx);
  el.dataset.serverToolId = toolId;
  const displayName = toolName === "web_search" ? "Web Search" : toolName;
  const icon = toolName === "web_search" ? "🔍" : "⚡";
  const inputSummary = input && typeof input === "object" && "query" in (input as Record<string, unknown>)
    ? String((input as Record<string, unknown>).query ?? "") : "";
  el.innerHTML = `<div class="gsd-server-tool-card running">` +
    `<span class="gsd-server-tool-icon">${icon}</span>` +
    `<span class="gsd-server-tool-name">${escapeHtml(displayName)}</span>` +
    (inputSummary ? `<span class="gsd-server-tool-query">${escapeHtml(inputSummary)}</span>` : "") +
    `<span class="gsd-tool-spinner"></span></div>`;
  insertSegmentElement(container, segIdx, el);
  segmentElements.set(segIdx, el);
}

export function completeServerToolSegment(toolUseId: string, results?: unknown): void {
  if (!state.currentTurn) return;
  const turn = state.currentTurn;
  let segIdx = -1;
  for (let i = 0; i < turn.segments.length; i++) {
    const seg = turn.segments[i];
    if (seg.type === "server_tool" && seg.serverToolId === toolUseId) {
      seg.results = results;
      seg.isComplete = true;
      segIdx = i;
      break;
    }
  }
  if (segIdx === -1) return;
  const el = segmentElements.get(segIdx);
  if (!el) return;
  const card = el.querySelector(".gsd-server-tool-card");
  if (!card) return;
  card.classList.remove("running");
  card.classList.add("done");
  const spinner = card.querySelector(".gsd-tool-spinner");
  if (spinner) {
    const check = document.createElement("span");
    check.className = "gsd-server-tool-check";
    check.textContent = "✓";
    spinner.replaceWith(check);
  }
  if (Array.isArray(results)) {
    const searchResults = results.filter(
      (r: unknown) => r && typeof r === "object" && "type" in (r as Record<string, unknown>) && (r as Record<string, unknown>).type === "web_search_result"
    );
    if (searchResults.length > 0) {
      const countText = `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}`;
      let countEl = card.querySelector(".gsd-server-tool-count") as HTMLElement | null;
      if (countEl) { countEl.textContent = countText; }
      else {
        countEl = document.createElement("span");
        countEl.className = "gsd-server-tool-count";
        countEl.textContent = countText;
        card.appendChild(countEl);
      }
    }
  }
}

export function updateToolSegmentElement(toolCallId: string, searchAllEntries: boolean = false): void {
  let tc: ToolCallState | undefined;
  if (state.currentTurn) tc = state.currentTurn.toolCalls.get(toolCallId);
  if (!tc && searchAllEntries) {
    for (let i = state.entries.length - 1; i >= 0; i--) {
      tc = state.entries[i].turn?.toolCalls.get(toolCallId);
      if (tc) break;
    }
  }
  if (!tc) return;
  let targetEl: HTMLElement | null = null;
  let targetSegIdx: number | null = null;
  for (const [segIdx, el] of segmentElements) {
    if (el.dataset.toolId === toolCallId) { targetEl = el; targetSegIdx = segIdx; break; }
  }
  if (!targetEl && currentTurnElement) {
    targetEl = currentTurnElement.querySelector<HTMLElement>(`[data-tool-id="${toolCallId}"]`)
      ?.closest<HTMLElement>(".gsd-tool-segment") ?? null;
  }
  if (!targetEl) {
    const mc = document.getElementById("messages");
    if (mc) {
      const found = mc.querySelector<HTMLElement>(`[data-tool-id="${toolCallId}"]`);
      targetEl = found?.closest<HTMLElement>(".gsd-tool-segment") ?? found ?? null;
    }
  }
  if (!targetEl) return;
  patchToolBlockElement(targetEl, tc);
  if (!tc.isRunning && targetSegIdx !== null && !targetEl.closest(".gsd-parallel-batch-content")) {
    if (tc.isSkipped) {
      tryStreamingSkippedCollapse(targetEl, targetSegIdx);
    } else {
      tryStreamingCollapse(targetEl, targetSegIdx);
    }
  }
}

function tryStreamingSkippedCollapse(el: HTMLElement, _segIdx: number): void {
  const predecessor = el.previousElementSibling as HTMLElement | null;
  if (predecessor?.classList.contains("gsd-skipped-group")) {
    const count = parseInt(predecessor.dataset.count || "1", 10) + 1;
    predecessor.dataset.count = String(count);
    const labelEl = predecessor.querySelector(".gsd-skipped-label");
    if (labelEl) labelEl.textContent = `${count} tool calls skipped — agent redirected`;
    el.remove();
    return;
  }
  const skippedEl = document.createElement("div");
  skippedEl.className = "gsd-skipped-group";
  skippedEl.dataset.count = "1";
  skippedEl.innerHTML = `<span class="gsd-skipped-icon">⏭</span>
    <span class="gsd-skipped-label">1 tool call skipped — agent redirected</span>`;
  el.replaceWith(skippedEl);
}

function tryStreamingCollapse(el: HTMLElement, segIdx: number): void {
  if (!state.currentTurn) return;
  const turn = state.currentTurn;
  const predecessor = el.previousElementSibling as HTMLElement | null;
  if (!predecessor) return;
  const tc = turn.toolCalls.get(el.dataset.toolId ?? "");
  if (!tc) return;
  if (!shouldCollapseWithPredecessor(tc, predecessor, turn.toolCalls)) return;

  const groupEl = collapseToolIntoGroup(el, predecessor, turn.toolCalls);
  for (const [predSegIdx, predEl] of segmentElements) {
    if (predEl === predecessor) { segmentElements.set(predSegIdx, groupEl); break; }
  }
  segmentElements.set(segIdx, groupEl);
}

export function detectStaleEcho(turn: { toolCalls: Map<string, any>; segments: any[]; timestamp: number }): boolean {
  if (turn.toolCalls.size > 0) return false;
  const textSegments = turn.segments.filter((s: any) => s.type === "text");
  if (textSegments.length === 0) return false;
  if (turn.segments.some((s: any) => s.type === "thinking")) return false;
  const totalText = textSegments.map((s: any) => s.chunks.join("")).join("").trim();
  if (totalText.length > SHORT_TEXT_THRESHOLD) return false;

  let lastAssistantIdx = -1;
  for (let i = state.entries.length - 1; i >= 0; i--) {
    if (state.entries[i].type === "assistant") { lastAssistantIdx = i; break; }
  }
  if (lastAssistantIdx === -1) return false;
  for (let i = lastAssistantIdx + 1; i < state.entries.length; i++) {
    if (state.entries[i].type === "user") return false;
  }
  const prevTimestamp = state.entries[lastAssistantIdx].timestamp;
  if (turn.timestamp - prevTimestamp > TURN_COALESCE_WINDOW_MS) return false;
  return true;
}

function renderTextSegment(segIdx: number): void {
  if (!state.currentTurn) return;
  const seg = state.currentTurn.segments[segIdx];
  if (!seg || seg.type === "tool" || seg.type === "server_tool") return;

  const container = ensureCurrentTurnElement();
  removePendingDotsFromContainer(container);
  let el = segmentElements.get(segIdx);
  const fullText = seg.chunks.join("");

  if (seg.type === "thinking") {
    if (!el) {
      el = document.createElement("details");
      el.className = "gsd-thinking-block";
      el.setAttribute("open", "");
      el.innerHTML = `<summary class="gsd-thinking-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
        <span class="gsd-thinking-label">Thinking</span>
        <span class="gsd-thinking-lines"></span>
      </summary>
      <div class="gsd-thinking-content"></div>`;
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }
    const content = el.querySelector(".gsd-thinking-content");
    if (content) content.textContent = fullText;
    const lineCount = fullText.split("\n").length;
    const linesEl = el.querySelector(".gsd-thinking-lines");
    if (linesEl) linesEl.textContent = `${lineCount} line${lineCount !== 1 ? "s" : ""}`;
  } else {
    if (!el) {
      el = document.createElement("div");
      el.className = "gsd-assistant-text";
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }

    if (!fullText) {
      const trailing = el.querySelector("[data-block-trailing]");
      if (trailing) trailing.innerHTML = "";
      return;
    }
    let incState = incrementalState.get(segIdx);
    if (!incState) {
      incState = { frozenBlockCount: 0, lastLexedText: "", lastTokens: [], textLengthAtLastRaf: 0 };
      incrementalState.set(segIdx, incState);
    }
    let tokens: any[];
    if (incState.lastLexedText === fullText) { tokens = incState.lastTokens; }
    else { tokens = lexMarkdown(fullText); incState.lastLexedText = fullText; incState.lastTokens = tokens; }
    const contentTokens = tokens.filter((t: any) => t.type !== "space");
    if (contentTokens.length === 0) return;
    const lastTokenIdx = contentTokens.length - 1;
    const completedCount = lastTokenIdx;
    if (completedCount > incState.frozenBlockCount) {
      const tokensWithLinks = tokens as any;
      const links = tokensWithLinks.links || {};
      for (let i = incState.frozenBlockCount; i < completedCount; i++) {
        const token = contentTokens[i];
        const singleTokenArr = Object.assign([token], { links });
        const blockHtml = sanitizeAndPostProcess(parseTokens(singleTokenArr));
        const blockDiv = document.createElement("div");
        blockDiv.dataset.blockIdx = String(i);
        blockDiv.innerHTML = blockHtml;
        const trailing = el.querySelector("[data-block-trailing]");
        if (trailing) { el.insertBefore(blockDiv, trailing); } else { el.appendChild(blockDiv); }
      }
      incState.frozenBlockCount = completedCount;
    }

    let trailingEl = el.querySelector("[data-block-trailing]") as HTMLElement | null;
    if (!trailingEl) {
      const existingLiveNode = liveTextNodes.get(segIdx);
      if (existingLiveNode && existingLiveNode.parentNode === el) existingLiveNode.data = "";
      trailingEl = document.createElement("div");
      trailingEl.dataset.blockTrailing = "";
      el.appendChild(trailingEl);
    }
    const trailingToken = contentTokens[lastTokenIdx];
    const tokensWithLinks = tokens as any;
    const links = tokensWithLinks.links || {};
    const trailingArr = Object.assign([trailingToken], { links });
    trailingEl.innerHTML = sanitizeAndPostProcess(parseTokens(trailingArr));
    incState.textLengthAtLastRaf = fullText.length;
    const liveSpan = document.createElement("span");
    liveSpan.dataset.liveText = "";
    const liveNode = document.createTextNode("");
    liveSpan.appendChild(liveNode);
    trailingEl.appendChild(liveSpan);
    liveTextNodes.set(segIdx, liveNode);
  }
}

function insertSegmentElement(container: HTMLElement, segIdx: number, el: HTMLElement): void {
  el.dataset.segIdx = String(segIdx);
  let inserted = false;
  for (const [idx, existingEl] of segmentElements) {
    if (idx > segIdx) { container.insertBefore(el, existingEl); inserted = true; break; }
  }
  if (!inserted) container.appendChild(el);
}

export function initStreaming(deps: { messagesContainer: HTMLElement; welcomeScreen: HTMLElement }): void {
  messagesContainer = deps.messagesContainer;
  welcomeScreen = deps.welcomeScreen;
  registerCleanup("renderer-elapsed", stopElapsedTimer);
}
