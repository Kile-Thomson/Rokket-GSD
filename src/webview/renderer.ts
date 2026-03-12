// ============================================================
// Renderer — entry building, streaming segments, DOM management
// ============================================================

import {
  state,
  type ChatEntry,
  type AssistantTurn,
  type ToolCallState,
} from "./state";

import {
  escapeHtml,
  escapeAttr,
  formatDuration,
  formatTokens,
  getToolCategory,
  getToolIcon,
  getToolKeyArg,
  formatToolResult,
  buildSubagentOutputHtml,
  renderMarkdown,
  scrollToBottom,
} from "./helpers";

// ============================================================
// Dependencies injected via init()
// ============================================================

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;

// ============================================================
// Streaming state
// ============================================================

let currentTurnElement: HTMLElement | null = null;
const segmentElements = new Map<number, HTMLElement>();
let activeSegmentIndex = -1;
let pendingTextRender: number | null = null;

// ============================================================
// Public API — entry rendering
// ============================================================

export function clearMessages(): void {
  const els = messagesContainer.querySelectorAll(".gsd-entry");
  els.forEach((el) => el.remove());
}

export function renderNewEntry(entry: ChatEntry): void {
  const el = createEntryElement(entry);
  messagesContainer.appendChild(el);
}

// ============================================================
// Public API — streaming
// ============================================================

export function ensureCurrentTurnElement(): HTMLElement {
  if (!currentTurnElement) {
    const el = document.createElement("div");
    el.className = "gsd-entry gsd-entry-assistant streaming";
    el.dataset.entryId = state.currentTurn?.id || "stream";
    messagesContainer.appendChild(el);
    currentTurnElement = el;
    welcomeScreen.style.display = "none";
  }
  return currentTurnElement;
}

export function appendToTextSegment(segType: "text" | "thinking", delta: string): void {
  if (!state.currentTurn) return;

  const turn = state.currentTurn;
  const segments = turn.segments;
  let segIdx: number;

  const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
  if (lastSeg && lastSeg.type === segType) {
    segIdx = segments.length - 1;
    lastSeg.chunks.push(delta);
  } else {
    segIdx = segments.length;
    segments.push({ type: segType, chunks: [delta] });
  }
  activeSegmentIndex = segIdx;

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
  const el = document.createElement("div");
  el.className = "gsd-tool-segment";
  el.dataset.segIdx = String(segIdx);
  el.dataset.toolId = tc.id;
  el.innerHTML = buildToolCallHtml(tc);
  insertSegmentElement(container, segIdx, el);
  segmentElements.set(segIdx, el);
}

export function updateToolSegmentElement(toolCallId: string): void {
  if (!state.currentTurn) return;
  const tc = state.currentTurn.toolCalls.get(toolCallId);
  if (!tc) return;

  for (const [, el] of segmentElements) {
    if (el.dataset.toolId === toolCallId) {
      el.innerHTML = buildToolCallHtml(tc);
      return;
    }
  }
}

export function finalizeCurrentTurn(): void {
  if (!state.currentTurn) return;

  if (pendingTextRender !== null) {
    cancelAnimationFrame(pendingTextRender);
    pendingTextRender = null;
  }

  const turn = state.currentTurn;
  turn.isComplete = true;

  for (const [, tc] of turn.toolCalls) {
    tc.isRunning = false;
  }

  state.entries.push({
    id: turn.id,
    type: "assistant",
    turn,
    timestamp: turn.timestamp,
  });

  if (currentTurnElement) {
    currentTurnElement.classList.remove("streaming");
    currentTurnElement.innerHTML = buildTurnHtml(turn);
  }

  state.currentTurn = null;
  currentTurnElement = null;
  segmentElements.clear();
  activeSegmentIndex = -1;
}

/** Reset streaming state — used by new conversation */
export function resetStreamingState(): void {
  currentTurnElement = null;
  segmentElements.clear();
  activeSegmentIndex = -1;
}

// ============================================================
// Internal — HTML builders
// ============================================================

function createEntryElement(entry: ChatEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = `gsd-entry gsd-entry-${entry.type}`;
  el.dataset.entryId = entry.id;

  if (entry.type === "user") {
    el.innerHTML = buildUserHtml(entry);
  } else if (entry.type === "assistant" && entry.turn) {
    el.innerHTML = buildTurnHtml(entry.turn);
  } else if (entry.type === "system") {
    el.innerHTML = buildSystemHtml(entry);
  }

  return el;
}

function buildUserHtml(entry: ChatEntry): string {
  let html = `<div class="gsd-user-bubble">`;
  if (entry.images?.length) {
    html += `<div class="gsd-user-images">${entry.images.map((img) =>
      `<img src="data:${img.mimeType};base64,${img.data}" class="gsd-user-img" alt="Image" />`
    ).join("")}</div>`;
  }
  html += escapeHtml(entry.text || "");
  html += `</div>`;
  return html;
}

function buildTurnHtml(turn: AssistantTurn): string {
  let html = "";

  for (const seg of turn.segments) {
    if (seg.type === "thinking") {
      const thinkingText = seg.chunks.join("");
      if (thinkingText) {
        html += `<details class="gsd-thinking-block">
          <summary class="gsd-thinking-header">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
            Thinking
          </summary>
          <div class="gsd-thinking-content">${escapeHtml(thinkingText)}</div>
        </details>`;
      }
    } else if (seg.type === "text") {
      const text = seg.chunks.join("");
      if (text) {
        html += `<div class="gsd-assistant-text">${renderMarkdown(text)}</div>`;
      }
    } else if (seg.type === "tool") {
      const tc = turn.toolCalls.get(seg.toolCallId);
      if (tc) {
        try {
          html += `<div class="gsd-tool-segment">${buildToolCallHtml(tc)}</div>`;
        } catch (err) {
          console.error("Error rendering tool call:", tc.name, err);
          html += `<div class="gsd-tool-segment"><div class="gsd-tool-block error collapsed" data-tool-id="${escapeAttr(tc.id)}">
            <div class="gsd-tool-header">
              <span class="gsd-tool-icon error">✗</span>
              <span class="gsd-tool-name">${escapeHtml(tc.name)}</span>
              <span class="gsd-tool-arg">render error</span>
            </div>
          </div></div>`;
        }
      }
    }
  }

  if (!turn.isComplete) {
    const hasAnyContent = turn.segments.length > 0;
    const hasRunningTool = Array.from(turn.toolCalls.values()).some((t) => t.isRunning);
    if (!hasRunningTool && !hasAnyContent) {
      html += `<div class="gsd-thinking-dots"><span></span><span></span><span></span></div>`;
    }
  }

  return html;
}

function buildToolCallHtml(tc: ToolCallState): string {
  const keyArg = getToolKeyArg(tc.name, tc.args);
  const category = getToolCategory(tc.name);
  const toolIcon = getToolIcon(tc.name, category);

  const statusIcon = tc.isRunning ? `<span class="gsd-tool-spinner"></span>` :
    tc.isError ? `<span class="gsd-tool-icon error">✗</span>` :
    `<span class="gsd-tool-icon success">✓</span>`;

  const duration = tc.endTime && tc.startTime ? formatDuration(tc.endTime - tc.startTime) : "";
  const durationHtml = duration ? `<span class="gsd-tool-duration">${duration}</span>` : "";

  const stateClass = tc.isRunning ? "running" : tc.isError ? "error" : "done";
  const isSubagent = tc.name.toLowerCase() === "subagent";

  const lines = tc.resultText ? tc.resultText.split("\n").length : 0;
  const shouldCollapse = !tc.isRunning && !isSubagent && lines > 5;
  const collapsedClass = shouldCollapse ? "collapsed" : "";

  let outputHtml = "";

  if (isSubagent) {
    outputHtml = `<div class="gsd-tool-output gsd-tool-output-rich">${buildSubagentOutputHtml(tc)}</div>`;
  } else if (tc.resultText) {
    const formattedResult = formatToolResult(tc.name, tc.resultText, tc.args);
    const maxOutputLen = 8000;
    let displayText = formattedResult;
    let truncated = false;
    if (displayText.length > maxOutputLen) {
      displayText = displayText.slice(0, maxOutputLen);
      truncated = true;
    }
    outputHtml = `<div class="gsd-tool-output"><pre><code>${escapeHtml(displayText)}</code></pre>`;
    if (truncated) {
      outputHtml += `<div class="gsd-tool-output-truncated">… output truncated (${formatTokens(tc.resultText.length)} chars)</div>`;
    }
    outputHtml += `</div>`;
  } else if (tc.isRunning) {
    outputHtml = `<div class="gsd-tool-output"><span class="gsd-tool-output-pending">Running...</span></div>`;
  }

  return `<div class="gsd-tool-block ${stateClass} ${collapsedClass} cat-${category}" data-tool-id="${escapeAttr(tc.id)}">
    <div class="gsd-tool-header">
      ${statusIcon}
      <span class="gsd-tool-cat-icon">${toolIcon}</span>
      <span class="gsd-tool-name">${escapeHtml(tc.name)}</span>
      ${keyArg ? `<span class="gsd-tool-arg">${escapeHtml(keyArg)}</span>` : ""}
      <span class="gsd-tool-header-right">${durationHtml}<span class="gsd-tool-chevron">▸</span></span>
    </div>
    ${outputHtml}
  </div>`;
}

function buildSystemHtml(entry: ChatEntry): string {
  const kind = entry.systemKind || "info";
  return `<div class="gsd-system-msg ${kind}">${escapeHtml(entry.systemText || "")}</div>`;
}

// ============================================================
// Internal — segment insertion
// ============================================================

function renderTextSegment(segIdx: number): void {
  if (!state.currentTurn) return;
  const seg = state.currentTurn.segments[segIdx];
  if (!seg || seg.type === "tool") return;

  const container = ensureCurrentTurnElement();
  let el = segmentElements.get(segIdx);

  const fullText = seg.chunks.join("");

  if (seg.type === "thinking") {
    if (!el) {
      el = document.createElement("details");
      el.className = "gsd-thinking-block";
      el.innerHTML = `<summary class="gsd-thinking-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
        Thinking
      </summary>
      <div class="gsd-thinking-content"></div>`;
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }
    const content = el.querySelector(".gsd-thinking-content");
    if (content) content.textContent = fullText;
  } else {
    if (!el) {
      el = document.createElement("div");
      el.className = "gsd-assistant-text";
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }
    el.innerHTML = renderMarkdown(fullText);
  }
}

function insertSegmentElement(container: HTMLElement, segIdx: number, el: HTMLElement): void {
  el.dataset.segIdx = String(segIdx);
  let inserted = false;
  for (const [idx, existingEl] of segmentElements) {
    if (idx > segIdx) {
      container.insertBefore(el, existingEl);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    container.appendChild(el);
  }
}

// ============================================================
// Init
// ============================================================

export interface RendererDeps {
  messagesContainer: HTMLElement;
  welcomeScreen: HTMLElement;
}

export function init(deps: RendererDeps): void {
  messagesContainer = deps.messagesContainer;
  welcomeScreen = deps.welcomeScreen;
}
