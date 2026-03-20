// ============================================================
// Renderer — entry building, streaming segments, DOM management
// ============================================================

import {
  state,
  type ChatEntry,
  type AssistantTurn,
  type ToolCallState,
  type TurnSegment,
} from "./state";

import {
  escapeHtml,
  escapeAttr,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  getToolCategory,
  getToolIcon,
  getToolKeyArg,
  formatToolResult,
  buildSubagentOutputHtml,
  renderMarkdown,
  scrollToBottom,
  resetAutoScroll,
} from "./helpers";

import {
  groupConsecutiveTools,
  buildGroupSummaryLabel,
  shouldCollapseWithPredecessor,
  collapseToolIntoGroup,
} from "./tool-grouping";

// ============================================================
// Dependencies injected via init()
// ============================================================

let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;

// ============================================================
// Streaming state
// ============================================================

let currentTurnElement: HTMLElement | null = null;
/** Prior streaming elements from the same turn, created when user messages split the stream */
let priorTurnElements: HTMLElement[] = [];
/** Segment indices <= this value belong to a prior (split) streaming element — don't append to them */
let _splitSegmentBarrier = -1;
const segmentElements = new Map<number, HTMLElement>();
let _activeSegmentIndex = -1;
let pendingTextRender: number | null = null;

/**
 * Live elapsed timer — refreshes running tool cards every second so the
 * elapsed duration stays current. This gives the user a visible heartbeat
 * that proves the extension is alive even when tools emit no partial updates.
 */
let elapsedTimerHandle: ReturnType<typeof setInterval> | null = null;

function startElapsedTimer(): void {
  if (elapsedTimerHandle) return;
  elapsedTimerHandle = setInterval(() => {
    if (!state.currentTurn) {
      stopElapsedTimer();
      return;
    }
    let anyRunning = false;
    for (const [, tc] of state.currentTurn.toolCalls) {
      if (tc.isRunning) {
        anyRunning = true;
        updateToolSegmentElement(tc.id);
      }
    }
    if (!anyRunning) stopElapsedTimer();
  }, 1000);
}

function stopElapsedTimer(): void {
  if (elapsedTimerHandle) {
    clearInterval(elapsedTimerHandle);
    elapsedTimerHandle = null;
  }
}

// ============================================================
// Public API — entry rendering
// ============================================================

export function clearMessages(): void {
  const els = messagesContainer.querySelectorAll(".gsd-entry");
  els.forEach((el) => el.remove());
  // Also clean up steer notes that live outside entries
  messagesContainer.querySelectorAll(".gsd-steer-note").forEach((el) => el.remove());
  resetAutoScroll();
}

export function renderNewEntry(entry: ChatEntry): void {
  const el = createEntryElement(entry);
  // If streaming, insert the user message AFTER the current streaming content
  // (not before it) so it appears inline at the correct chronological position.
  // Then create a new streaming element below the user message for continuation.
  if (currentTurnElement && currentTurnElement.parentNode === messagesContainer) {
    // Insert user bubble after the current streaming element
    currentTurnElement.after(el);
    // Split the stream: create a new continuation element below the user message
    const continuation = document.createElement("div");
    continuation.className = "gsd-entry gsd-entry-assistant streaming";
    continuation.dataset.entryId = state.currentTurn?.id || "stream";
    el.after(continuation);
    // Transfer segment tracking to the new element — new segments will render here
    currentTurnElement.classList.remove("streaming");
    priorTurnElements.push(currentTurnElement);
    currentTurnElement = continuation;
    // Clear segment element map so new segments create fresh DOM in the continuation
    segmentElements.clear();
    _activeSegmentIndex = -1;
    // Set barrier so text appending creates new segments instead of appending to pre-split ones
    _splitSegmentBarrier = state.currentTurn ? state.currentTurn.segments.length - 1 : -1;
  } else {
    messagesContainer.appendChild(el);
  }
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
    welcomeScreen.classList.add("gsd-hidden");
  }
  return currentTurnElement;
}

/**
 * Reattach to an existing entry's DOM element for continuation turns.
 */
export function reattachTurnElement(entryId: string): void {
  const el = messagesContainer.querySelector(`[data-entry-id="${entryId}"]`) as HTMLElement | null;
  if (el) {
    currentTurnElement = el;
    el.classList.add("streaming");
  } else {
    ensureCurrentTurnElement();
  }
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
  // Start live elapsed timer so running tools show a ticking duration
  if (tc.isRunning) startElapsedTimer();
}

export function updateToolSegmentElement(toolCallId: string): void {
  if (!state.currentTurn) return;
  const tc = state.currentTurn.toolCalls.get(toolCallId);
  if (!tc) return;

  // Find the element — could be in segmentElements directly or inside a group
  let targetEl: HTMLElement | null = null;
  let targetSegIdx: number | null = null;

  for (const [segIdx, el] of segmentElements) {
    if (el.dataset.toolId === toolCallId) {
      targetEl = el;
      targetSegIdx = segIdx;
      break;
    }
  }

  // Not found in segmentElements — search inside groups (reparented elements)
  if (!targetEl && currentTurnElement) {
    targetEl = currentTurnElement.querySelector<HTMLElement>(
      `[data-tool-id="${toolCallId}"]`,
    )?.closest<HTMLElement>(".gsd-tool-segment") ?? null;
  }

  if (!targetEl) return;

  // Update the tool's HTML
  targetEl.innerHTML = buildToolCallHtml(tc);

  // Attempt streaming collapse if tool just completed
  if (!tc.isRunning && targetSegIdx !== null) {
    if (tc.isSkipped) {
      tryStreamingSkippedCollapse(targetEl, targetSegIdx);
    } else {
      tryStreamingCollapse(targetEl, targetSegIdx);
    }
  }
}

/**
 * Collapse consecutive skipped tools into a single muted summary row.
 */
function tryStreamingSkippedCollapse(el: HTMLElement, _segIdx: number): void {
  const predecessor = el.previousElementSibling as HTMLElement | null;
  if (predecessor?.classList.contains("gsd-skipped-group")) {
    const count = parseInt(predecessor.dataset.count || "1", 10) + 1;
    predecessor.dataset.count = String(count);
    const labelEl = predecessor.querySelector(".gsd-skipped-label");
    if (labelEl) {
      labelEl.textContent = `${count} tool calls skipped — agent redirected`;
    }
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

/**
 * After a tool completes, check if it should collapse with its DOM predecessor.
 * Handles both creating new groups and expanding existing ones.
 */
function tryStreamingCollapse(el: HTMLElement, segIdx: number): void {
  if (!state.currentTurn) return;
  const turn = state.currentTurn;

  // Find the preceding visible sibling in the DOM
  const predecessor = el.previousElementSibling as HTMLElement | null;
  if (!predecessor) return;

  // Check if collapse is appropriate
  const tc = turn.toolCalls.get(el.dataset.toolId ?? "");
  if (!tc) return;

  if (!shouldCollapseWithPredecessor(tc, predecessor, turn.toolCalls)) return;

  const groupEl = collapseToolIntoGroup(el, predecessor, turn.toolCalls);

  // Update segmentElements — the element was reparented into the group.
  // For new groups, the predecessor's segIdx entry should now point to the group.
  // Find the predecessor's segIdx and remap it.
  for (const [predSegIdx, predEl] of segmentElements) {
    if (predEl === predecessor) {
      segmentElements.set(predSegIdx, groupEl);
      break;
    }
  }
  // The current element's entry should also point to the group
  segmentElements.set(segIdx, groupEl);
}

/**
 * Detect "stale echo" turns — short, text-only agent responses that occur
 * in rapid succession without user interaction. These happen when async_bash
 * job results are delivered after the agent has already consumed them,
 * triggering redundant model turns that just say "already handled."
 *
 * Conditions (ALL must be true):
 * 1. No tool calls — the model didn't do any work
 * 2. Text-only, short — total text < 200 chars
 * 3. No user entry between this turn and the previous assistant turn
 * 4. Previous assistant turn exists
 * 5. Completed within 30s of the previous assistant turn
 *
 * @internal — exported for testing
 */
export function detectStaleEcho(turn: AssistantTurn): boolean {
  if (turn.toolCalls.size > 0) return false;

  const textSegments = turn.segments.filter(s => s.type === "text");
  if (textSegments.length === 0) return false;
  if (turn.segments.some(s => s.type === "thinking")) return false;

  const totalText = textSegments
    .map(s => s.chunks.join(""))
    .join("")
    .trim();
  if (totalText.length > 200) return false;

  let lastAssistantIdx = -1;
  for (let i = state.entries.length - 1; i >= 0; i--) {
    if (state.entries[i].type === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx === -1) return false;

  for (let i = lastAssistantIdx + 1; i < state.entries.length; i++) {
    if (state.entries[i].type === "user") return false;
  }

  const prevTimestamp = state.entries[lastAssistantIdx].timestamp;
  if (turn.timestamp - prevTimestamp > 30000) return false;

  return true;
}

export function finalizeCurrentTurn(): void {
  if (!state.currentTurn) return;

  stopElapsedTimer();

  if (pendingTextRender !== null) {
    cancelAnimationFrame(pendingTextRender);
    pendingTextRender = null;
  }

  const turn = state.currentTurn;
  turn.isComplete = true;

  for (const [, tc] of turn.toolCalls) {
    tc.isRunning = false;
  }

  const isStaleEcho = detectStaleEcho(turn);
  turn.isStaleEcho = isStaleEcho;

  // Only push a new entry if this turn isn't already in entries (continuation turns reuse the previous entry)
  const existingEntry = state.entries.find(e => e.type === "assistant" && e.turn === turn);
  if (!existingEntry) {
    state.entries.push({
      id: turn.id,
      type: "assistant",
      turn,
      timestamp: turn.timestamp,
    });
  }

  if (currentTurnElement) {
    currentTurnElement.classList.remove("streaming");
    if (priorTurnElements.length > 0) {
      // Turn was split by user messages — prior elements already have rendered
      // content in place. Don't rebuild (that would duplicate). Just finalize
      // the prior partials and the current continuation in-place.
      for (const prior of priorTurnElements) {
        prior.classList.remove("streaming");
      }
      // Remove empty continuation element if nothing was rendered into it
      if (currentTurnElement.innerHTML.trim() === "") {
        currentTurnElement.remove();
      }
      priorTurnElements = [];
    } else if (isStaleEcho) {
      currentTurnElement.classList.add("gsd-stale-echo");
      currentTurnElement.innerHTML = buildStaleEchoHtml(turn);
    } else {
      currentTurnElement.innerHTML = buildTurnHtml(turn);
    }
  }

  state.currentTurn = null;
  currentTurnElement = null;
  priorTurnElements = [];
  _splitSegmentBarrier = -1;
  segmentElements.clear();
  _activeSegmentIndex = -1;
}

/** Reset streaming state — used by new conversation */
export function resetStreamingState(): void {
  currentTurnElement = null;
  priorTurnElements = [];
  _splitSegmentBarrier = -1;
  segmentElements.clear();
  _activeSegmentIndex = -1;
  stopElapsedTimer();
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
    if (entry.turn.isStaleEcho) {
      el.classList.add("gsd-stale-echo");
      el.innerHTML = buildStaleEchoHtml(entry.turn);
    } else {
      el.innerHTML = buildTurnHtml(entry.turn);
    }
  } else if (entry.type === "system") {
    el.innerHTML = buildSystemHtml(entry);
  }

  return el;
}

function buildTimestampHtml(ts: number): string {
  if (!ts) return "";
  const abs = new Date(ts).toLocaleString();
  const rel = formatRelativeTime(ts);
  return `<span class="gsd-timestamp" data-ts="${ts}" title="${escapeAttr(abs)}">${escapeHtml(rel)}</span>`;
}

function getFileIcon(ext: string): string {
  const icons: Record<string, string> = {
    pdf: "📄", doc: "📝", docx: "📝", txt: "📝", md: "📝",
    xls: "📊", xlsx: "📊", csv: "📊",
    ppt: "📽️", pptx: "📽️",
    jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", svg: "🖼️", webp: "🖼️",
    mp4: "🎬", mov: "🎬", avi: "🎬", mkv: "🎬",
    mp3: "🎵", wav: "🎵", flac: "🎵",
    zip: "📦", tar: "📦", gz: "📦", rar: "📦", "7z": "📦",
    js: "⚡", ts: "⚡", jsx: "⚡", tsx: "⚡",
    py: "🐍", rb: "💎", go: "🔷", rs: "🦀",
    html: "🌐", css: "🎨", scss: "🎨",
    json: "📋", yaml: "📋", yml: "📋", toml: "📋", xml: "📋",
    sh: "⚙️", bash: "⚙️", ps1: "⚙️", cmd: "⚙️", bat: "⚙️",
    sql: "🗃️", db: "🗃️",
    env: "🔒", key: "🔒", pem: "🔒",
  };
  return icons[ext] || "📎";
}

function buildUserHtml(entry: ChatEntry): string {
  let html = `<div class="gsd-user-bubble">`;
  if (entry.files?.length) {
    html += `<div class="gsd-user-files">${entry.files.map((f) =>
      `<div class="gsd-file-chip sent" title="${escapeAttr(f.path)}">
        <span class="gsd-file-chip-icon">${getFileIcon(f.extension)}</span>
        <span class="gsd-file-chip-name">${escapeHtml(f.name)}</span>
      </div>`
    ).join("")}</div>`;
  }
  if (entry.images?.length) {
    html += `<div class="gsd-user-images">${entry.images.map((img) =>
      `<img src="data:${img.mimeType};base64,${img.data}" class="gsd-user-img" alt="Image" />`
    ).join("")}</div>`;
  }
  if (entry.text) {
    html += escapeHtml(entry.text);
  }
  html += `</div>`;
  html += buildTimestampHtml(entry.timestamp);
  return html;
}

function buildStaleEchoHtml(turn: AssistantTurn): string {
  const textContent = turn.segments
    .filter(s => s.type === "text")
    .map(s => s.chunks.join(""))
    .join(" ")
    .trim();
  const preview = textContent.length > 80 ? textContent.slice(0, 77) + "…" : textContent;
  const panelId = `stale-echo-${turn.id}`;
  return `<div class="gsd-stale-echo-bar" role="button" tabindex="0" aria-expanded="false" aria-controls="${escapeAttr(panelId)}" aria-label="Expand background notification echo" title="Background job notification — click to expand">
    <span class="gsd-stale-echo-icon">↩</span>
    <span class="gsd-stale-echo-text">${escapeHtml(preview)}</span>
  </div>
  <div class="gsd-stale-echo-full" id="${escapeAttr(panelId)}" hidden>${buildTurnHtml(turn)}</div>`;
}

function buildTurnHtml(turn: AssistantTurn): string {
  let html = "";

  const grouped = groupConsecutiveTools(turn.segments, turn.toolCalls);

  if (grouped.length !== turn.segments.length) {
    const groupCount = grouped.filter(g => g.type === "group").length;
    if (groupCount > 0) {
      console.debug(`[gsd] Tool grouping: ${groupCount} group(s) from ${turn.segments.length} segments`);
    }
  }

  let skippedCount = 0;

  for (const item of grouped) {
    if (item.type === "group") {
      if (skippedCount > 0) {
        html += buildSkippedGroupHtml(skippedCount);
        skippedCount = 0;
      }
      html += buildToolGroupHtml(item.segments, item.toolNames, turn.toolCalls);
    } else {
      // Check if this is a skipped tool — collapse consecutive skipped tools
      const seg = item.segment;
      if (seg.type === "tool") {
        const tc = turn.toolCalls.get(seg.toolCallId);
        if (tc?.isSkipped) {
          skippedCount++;
          continue;
        }
      }
      if (skippedCount > 0) {
        html += buildSkippedGroupHtml(skippedCount);
        skippedCount = 0;
      }
      html += buildSegmentHtml(item.segment, turn.toolCalls);
    }
  }
  if (skippedCount > 0) {
    html += buildSkippedGroupHtml(skippedCount);
  }

  if (!turn.isComplete) {
    const hasAnyContent = turn.segments.length > 0;
    const hasRunningTool = Array.from(turn.toolCalls.values()).some((t) => t.isRunning);
    if (!hasRunningTool && !hasAnyContent) {
      html += `<div class="gsd-thinking-dots"><span></span><span></span><span></span></div>`;
    }
  }

  if (turn.isComplete) {
    // Collect text content for the copy button
    const textContent = turn.segments
      .filter(s => s.type === "text")
      .map(s => s.chunks.join(""))
      .join("\n\n");
    if (textContent) {
      html += `<div class="gsd-turn-actions">`;
      html += `<button class="gsd-copy-response-btn" data-copy-text="${escapeAttr(textContent)}" title="Copy response" aria-label="Copy response">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 4h8v8H4V4zm1 1v6h6V5H5zm-3-3h8v1H3v7H2V2h8z"/></svg>
        Copy
      </button>`;
      if (turn.timestamp) {
        html += buildTimestampHtml(turn.timestamp);
      }
      html += `</div>`;
    } else if (turn.timestamp) {
      html += buildTimestampHtml(turn.timestamp);
    }
  }

  return html;
}

function buildSkippedGroupHtml(count: number): string {
  const label = count === 1
    ? "1 tool call skipped — agent redirected"
    : `${count} tool calls skipped — agent redirected`;
  return `<div class="gsd-skipped-group">
    <span class="gsd-skipped-icon">⏭</span>
    <span class="gsd-skipped-label">${escapeHtml(label)}</span>
  </div>`;
}

function buildSegmentHtml(seg: TurnSegment, toolCalls: Map<string, ToolCallState>): string {
  if (seg.type === "thinking") {
    const thinkingText = seg.chunks.join("");
    if (!thinkingText) return "";
    const lineCount = thinkingText.split("\n").length;
    return `<details class="gsd-thinking-block">
      <summary class="gsd-thinking-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
        <span class="gsd-thinking-label">Thinking</span>
        <span class="gsd-thinking-lines">${lineCount} line${lineCount !== 1 ? "s" : ""}</span>
      </summary>
      <div class="gsd-thinking-content">${escapeHtml(thinkingText)}</div>
    </details>`;
  } else if (seg.type === "text") {
    const text = seg.chunks.join("");
    if (!text) return "";
    return `<div class="gsd-assistant-text">${renderMarkdown(text)}</div>`;
  } else if (seg.type === "tool") {
    const tc = toolCalls.get(seg.toolCallId);
    if (!tc) return "";
    try {
      return `<div class="gsd-tool-segment">${buildToolCallHtml(tc)}</div>`;
    } catch (err) {
      console.error("Error rendering tool call:", tc.name, err);
      return `<div class="gsd-tool-segment"><div class="gsd-tool-block error collapsed" data-tool-id="${escapeAttr(tc.id)}">
        <div class="gsd-tool-header" role="button" tabindex="0" aria-label="Toggle ${escapeAttr(tc.name)} details" aria-expanded="false">
          <span class="gsd-tool-icon error">✗</span>
          <span class="gsd-tool-name">${escapeHtml(tc.name)}</span>
          <span class="gsd-tool-arg">render error</span>
        </div>
      </div></div>`;
    }
  }
  return "";
}

function buildToolGroupHtml(
  segments: TurnSegment[],
  toolNames: string[],
  toolCalls: Map<string, ToolCallState>,
): string {
  const label = buildGroupSummaryLabel(toolNames);
  let inner = "";
  for (const seg of segments) {
    if (seg.type === "tool") {
      const tc = toolCalls.get(seg.toolCallId);
      if (tc) {
        try {
          inner += `<div class="gsd-tool-segment">${buildToolCallHtml(tc)}</div>`;
        } catch (err) {
          console.error("Error rendering grouped tool call:", tc.name, err);
        }
      }
    }
  }

  return `<details class="gsd-tool-group" data-tool-group="${toolNames.length}">
    <summary class="gsd-tool-group-header" role="button" tabindex="0" aria-label="Toggle ${escapeAttr(label)}" aria-expanded="false">
      <span class="gsd-tool-group-icon">
        <span class="gsd-tool-icon success">✓</span>
      </span>
      <span class="gsd-tool-group-label">${escapeHtml(label)}</span>
      <span class="gsd-tool-group-count">${toolNames.length}</span>
      <span class="gsd-tool-chevron">▸</span>
    </summary>
    <div class="gsd-tool-group-content">${inner}</div>
  </details>`;
}

function buildToolCallHtml(tc: ToolCallState): string {
  const keyArg = getToolKeyArg(tc.name, tc.args);
  const category = getToolCategory(tc.name);
  const toolIcon = getToolIcon(tc.name, category);

  const statusIcon = tc.isRunning ? `<span class="gsd-tool-spinner"></span>` :
    tc.isSkipped ? `<span class="gsd-tool-icon skipped">⏭</span>` :
    tc.isError ? `<span class="gsd-tool-icon error">✗</span>` :
    `<span class="gsd-tool-icon success">✓</span>`;

  const duration = tc.endTime && tc.startTime
    ? formatDuration(tc.endTime - tc.startTime)
    : tc.isRunning && tc.startTime
      ? formatDuration(Date.now() - tc.startTime)
      : "";
  const durationHtml = duration
    ? `<span class="gsd-tool-duration${tc.isRunning ? " elapsed-live" : ""}">${duration}</span>`
    : "";

  const stateClass = tc.isRunning ? "running" : tc.isSkipped ? "skipped" : tc.isError ? "error" : "done";
  const parallelClass = tc.isParallel ? " parallel" : "";
  const isSubagent = tc.name.toLowerCase() === "subagent";

  const lines = tc.resultText ? tc.resultText.split("\n").length : 0;
  const shouldCollapse = !tc.isRunning && !isSubagent && (lines > 5 || tc.isSkipped);
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

  const parallelBadge = tc.isParallel ? `<span class="gsd-tool-parallel-badge" title="Running in parallel">⚡</span>` : "";

  const isCollapsed = collapsedClass === "collapsed";
  return `<div class="gsd-tool-block ${stateClass}${parallelClass} ${collapsedClass} cat-${category}" data-tool-id="${escapeAttr(tc.id)}">
    <div class="gsd-tool-header" role="button" tabindex="0" aria-label="Toggle ${escapeAttr(tc.name)} details" aria-expanded="${isCollapsed ? "false" : "true"}">
      ${statusIcon}
      <span class="gsd-tool-cat-icon">${toolIcon}</span>
      <span class="gsd-tool-name">${escapeHtml(tc.name)}</span>
      ${keyArg ? `<span class="gsd-tool-arg">${escapeHtml(keyArg)}</span>` : ""}
      <span class="gsd-tool-header-right">${parallelBadge}${durationHtml}<span class="gsd-tool-chevron">▸</span></span>
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
      el.setAttribute("open", ""); // Open while streaming
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
    // Update line count indicator
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
