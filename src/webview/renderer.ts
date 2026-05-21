// ============================================================
// Renderer — entry building, streaming segments, DOM management
// ============================================================

import {
  state,
  type ChatEntry,
  type AssistantTurn,
  type ToolCallState,
  pruneOldEntries,
} from "./state";

import {
  escapeHtml,
  escapeAttr,
  formatDuration,
  formatTokens,
  getToolKeyArg,
  formatToolResult,
  renderMarkdown,
  sanitizeAndPostProcess,
  lexMarkdown,
  parseTokens,
  scrollToBottom,
  resetAutoScroll,
} from "./helpers";

import {
  shouldCollapseWithPredecessor,
  collapseToolIntoGroup,
} from "./tool-grouping";

import { initStreaming as initStreamingModule } from "./render/streaming";
import {
  createEntryElement,
  buildTimestampHtml,
  buildStaleEchoHtml,
  buildToolCallHtml,
  patchToolBlockElement,
} from "./render/html-builders";

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
 * Per-segment incremental rendering state.
 * Tracks how many block-level tokens have been "frozen" (fully rendered and
 * inserted into the DOM as immutable divs) for each text segment.
 * Also caches the last lexed token list so we don't re-lex unchanged text.
 */
const incrementalState = new Map<number, {
  frozenBlockCount: number;
  lastLexedText: string;
  lastTokens: any[];
  textLengthAtLastRaf: number;
}>();

/**
 * Live text nodes for in-progress trailing content.
 * Keyed by segment index. Updated directly on every delta so text appears
 * token-by-token without waiting for the next rAF cycle. The rAF pass
 * replaces this with fully-parsed markdown and resets the node reference.
 */
const liveTextNodes = new Map<number, Text>();

/**
 * Live elapsed timer — refreshes running tool cards every second so the
 * elapsed duration stays current. This gives the user a visible heartbeat
 * that proves the extension is alive even when tools emit no partial updates.
 */
let elapsedTimerHandle: ReturnType<typeof setInterval> | null = null;

/** Start the live elapsed timer that ticks running tool cards every second. */
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

/** Stop the live elapsed timer. */
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
  // Remove pruned-entries indicator
  messagesContainer.querySelector(".gsd-pruned-indicator")?.remove();
  resetAutoScroll();
}

export function renderNewEntry(entry: ChatEntry): void {
  const el = createEntryElement(entry);
  messagesContainer.appendChild(el);
}

// ============================================================
// Public API — streaming
// ============================================================

/**
 * Return the current turn element if one exists, without creating it.
 * Used by ui-dialogs to insert dialog wrappers inline with the turn
 * that triggered them.
 */
export function getCurrentTurnElement(): HTMLElement | null {
  return currentTurnElement;
}

/**
 * Show the thinking dots spinner in the current (or newly created) turn element.
 * Called optimistically on user send — before agent_start fires — so the user
 * sees immediate feedback with no dead time. Sets currentTurnElement so
 * resetStreamingState can clean it up if the dots are still showing when
 * agent_start arrives.
 */
export function showPendingDots(): void {
  const container = ensureCurrentTurnElement();
  if (!container.querySelector(".gsd-thinking-dots")) {
    const dots = document.createElement("div");
    dots.className = "gsd-thinking-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";
    container.appendChild(dots);
  }
}

/** Remove pending thinking dots from a container — called when real content arrives. */
function removePendingDotsFromContainer(container: HTMLElement): void {
  container.querySelector(".gsd-thinking-dots")?.remove();
}

/**
 * Split the current streaming turn at the user message boundary.
 * Called when the user sends a steer while the LLM is streaming —
 * preserves existing content in place and creates a fresh continuation
 * element so subsequent streamed content appears after the user message.
 */
export function splitTurnForUserMessage(): void {
  if (!currentTurnElement || !state.currentTurn) return;

  priorTurnElements.push(currentTurnElement);
  _splitSegmentBarrier = state.currentTurn.segments.length - 1;

  const el = document.createElement("div");
  el.className = "gsd-entry gsd-entry-assistant streaming";
  el.dataset.entryId = state.currentTurn.id;
  messagesContainer.appendChild(el);

  currentTurnElement = el;
}

export function ensureCurrentTurnElement(): HTMLElement {
  if (!currentTurnElement) {
    // Check if there's a pending-dots-only element in the DOM (created
    // optimistically by showPendingDots on user send) — reuse it so the dots
    // remain visible until real content arrives rather than blinking out.
    // Only match elements that contain ONLY the thinking dots — never reuse
    // an element that has real content in it.
    const candidates = messagesContainer.querySelectorAll<HTMLElement>(
      ".gsd-entry-assistant.streaming"
    );
    let existing: HTMLElement | null = null;
    for (const el of Array.from(candidates)) {
      const onlyDots = el.children.length === 1 &&
        el.firstElementChild?.classList.contains("gsd-thinking-dots");
      if (onlyDots) {
        existing = el;
        break;
      }
    }
    if (existing) {
      // Only update entryId if it actually changed — data attribute mutations
      // trigger style recalculation which resets CSS animations on children.
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

      // When multiple user messages are queued at the bottom (sent while the
      // LLM was streaming), insert the new response after the first queued
      // message instead of appending at the very end. This interleaves
      // responses with their triggering messages:
      //   [User B][Response B][User C][Response C]
      // instead of clustering all messages then all responses:
      //   [User B][User C][Response B][Response C]
      const allEntries = messagesContainer.querySelectorAll<HTMLElement>(".gsd-entry");
      let trailingUserCount = 0;
      for (let i = allEntries.length - 1; i >= 0; i--) {
        if (allEntries[i].classList.contains("gsd-entry-user")) {
          trailingUserCount++;
        } else {
          break;
        }
      }
      if (trailingUserCount >= 2) {
        const firstQueued = allEntries[allEntries.length - trailingUserCount];
        firstQueued.after(el);
      } else {
        messagesContainer.appendChild(el);
      }

      currentTurnElement = el;
      welcomeScreen.classList.add("gsd-hidden");
    }
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

  // Fast path: if a live text node exists for this segment's trailing element,
  // update it directly. This fires on every delta — no rAF needed — so the
  // user sees text appear token-by-token even when deltas arrive in OS-level
  // bursts. The rAF pass below still runs to handle frozen block promotion
  // and markdown parsing.
  if (segType === "text") {
    const liveNode = liveTextNodes.get(segIdx);
    if (liveNode) {
      const seg = turn.segments[segIdx];
      if (seg.type === "text") {
        // Only show chars added since the last rAF rendered the trailing element.
        // The trailing element already contains everything up to that point —
        // showing the full text here would duplicate it.
        const incState = incrementalState.get(segIdx);
        const base = incState?.textLengthAtLastRaf ?? 0;
        const fullText = seg.chunks.join("");
        liveNode.data = fullText.slice(base);
      }
    } else if (!segmentElements.has(segIdx)) {
      // First delta for this segment — create the DOM element immediately so
      // the user sees something without waiting for the next rAF cycle.
      // We use a live Text node (not textContent) so the rAF can append
      // the trailing div without leaving a duplicate raw text node behind.
      const container = ensureCurrentTurnElement();
      // Remove dots synchronously here so the first token and dots are never
      // both visible in the same frame.
      removePendingDotsFromContainer(container);
      const el = document.createElement("div");
      el.className = "gsd-assistant-text";
      const seg = turn.segments[segIdx];
      const liveNode = document.createTextNode(
        seg.type === "text" ? seg.chunks.join("") : ""
      );
      el.appendChild(liveNode);
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
      liveTextNodes.set(segIdx, liveNode);
    }
  } else if (segType === "thinking") {
    const el = segmentElements.get(segIdx);
    if (el) {
      const content = el.querySelector(".gsd-thinking-content");
      if (content) {
        const seg = turn.segments[segIdx];
        if (seg.type === "thinking") {
          content.textContent = seg.chunks.join("");
        }
      }
    } else if (!segmentElements.has(segIdx)) {
      // First thinking delta — create block immediately
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
  removePendingDotsFromContainer(container);  const el = document.createElement("div");
  el.className = "gsd-tool-segment";
  el.dataset.segIdx = String(segIdx);
  el.dataset.toolId = tc.id;
  el.innerHTML = buildToolCallHtml(tc);
  insertSegmentElement(container, segIdx, el);
  segmentElements.set(segIdx, el);
  // Start live elapsed timer so running tools show a ticking duration
  if (tc.isRunning) startElapsedTimer();
}

/**
 * Render a server-side tool (e.g. Anthropic's native web search) as a
 * compact inline indicator. These arrive via message_update deltas, not
 * through tool_execution_start/end.
 */
export function appendServerToolSegment(toolId: string, toolName: string, input?: unknown): void {
  if (!state.currentTurn) return;

  const turn = state.currentTurn;
  const segIdx = turn.segments.length;
  turn.segments.push({
    type: "server_tool",
    serverToolId: toolId,
    name: toolName,
    input,
    isComplete: false,
  });

  const container = ensureCurrentTurnElement();
  removePendingDotsFromContainer(container);

  const el = document.createElement("div");
  el.className = "gsd-server-tool-segment";
  el.dataset.segIdx = String(segIdx);
  el.dataset.serverToolId = toolId;

  const displayName = toolName === "web_search" ? "Web Search" : toolName;
  const icon = toolName === "web_search" ? "🔍" : "⚡";
  const inputSummary = input && typeof input === "object" && "query" in (input as Record<string, unknown>)
    ? String((input as Record<string, unknown>).query ?? "")
    : "";

  el.innerHTML = `<div class="gsd-server-tool-card running">` +
    `<span class="gsd-server-tool-icon">${icon}</span>` +
    `<span class="gsd-server-tool-name">${escapeHtml(displayName)}</span>` +
    (inputSummary ? `<span class="gsd-server-tool-query">${escapeHtml(inputSummary)}</span>` : "") +
    `<span class="gsd-tool-spinner"></span>` +
    `</div>`;

  insertSegmentElement(container, segIdx, el);
  segmentElements.set(segIdx, el);
}

/**
 * Complete a server-side tool segment with its results (e.g. web search results).
 */
export function completeServerToolSegment(toolUseId: string, results?: unknown): void {
  if (!state.currentTurn) return;

  // Find the matching segment
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

  // Update the DOM element
  const el = segmentElements.get(segIdx);
  if (!el) return;

  const card = el.querySelector(".gsd-server-tool-card");
  if (card) {
    card.classList.remove("running");
    card.classList.add("done");
    // Replace spinner with check
    const spinner = card.querySelector(".gsd-tool-spinner");
    if (spinner) {
      const check = document.createElement("span");
      check.className = "gsd-server-tool-check";
      check.textContent = "✓";
      spinner.replaceWith(check);
    }

    // If web search results, show or update source count
    if (Array.isArray(results)) {
      const searchResults = results.filter(
        (r: unknown) => r && typeof r === "object" && "type" in (r as Record<string, unknown>) && (r as Record<string, unknown>).type === "web_search_result"
      );
      if (searchResults.length > 0) {
        const countText = `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}`;
        let countEl = card.querySelector(".gsd-server-tool-count") as HTMLElement | null;
        if (countEl) {
          countEl.textContent = countText;
        } else {
          countEl = document.createElement("span");
          countEl.className = "gsd-server-tool-count";
          countEl.textContent = countText;
          card.appendChild(countEl);
        }
      }
    }
  }
}

export function updateToolSegmentElement(toolCallId: string, searchAllEntries: boolean = false): void {
  let tc: ToolCallState | undefined;

  if (state.currentTurn) {
    tc = state.currentTurn.toolCalls.get(toolCallId);
  }

  // If not in current turn (or no current turn), search previous entries
  if (!tc && searchAllEntries) {
    for (let i = state.entries.length - 1; i >= 0; i--) {
      tc = state.entries[i].turn?.toolCalls.get(toolCallId);
      if (tc) break;
    }
  }

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

  // Fallback: search entire messages container (for completed turns / async updates)
  if (!targetEl) {
    const messagesContainer = document.getElementById("messages");
    if (messagesContainer) {
      const found = messagesContainer.querySelector<HTMLElement>(
        `[data-tool-id="${toolCallId}"]`,
      );
      targetEl = found?.closest<HTMLElement>(".gsd-tool-segment") ?? found ?? null;
    }
  }

  if (!targetEl) return;

  // Targeted DOM patch — update only what changed instead of rebuilding innerHTML.
  // This preserves the spinner's animation state, hover/focus state, and avoids
  // screen reader noise from wholesale DOM replacement.
  patchToolBlockElement(targetEl, tc);

  // Attempt streaming collapse if tool just completed.
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

  // Mark any incomplete server_tool segments as done on turn finalize.
  // If the web_search_result delta never arrived (e.g. aborted stream),
  // the segment would otherwise stay stuck as "running" in the finalized HTML.
  for (const seg of turn.segments) {
    if (seg.type === "server_tool" && !seg.isComplete) {
      seg.isComplete = true;
    }
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
    pruneOldEntries(messagesContainer);
  }

  if (currentTurnElement) {
    currentTurnElement.classList.remove("streaming");
    if (priorTurnElements.length > 0) {
      // Turn was split by user messages — finalize all segments in-place
      // (text → final markdown, tool blocks patched) regardless of which
      // split container they live in.
      finalizeStreamingDom(turn, currentTurnElement);
      for (const prior of priorTurnElements) {
        prior.classList.remove("streaming");
        if (prior.innerHTML.trim() === "") prior.remove();
      }
      if (currentTurnElement.innerHTML.trim() === "") {
        currentTurnElement.remove();
      }
      priorTurnElements = [];
    } else if (isStaleEcho) {
      currentTurnElement.classList.add("gsd-stale-echo");
      currentTurnElement.innerHTML = buildStaleEchoHtml(turn);
    } else {
      finalizeStreamingDom(turn, currentTurnElement);
    }
  }

  state.currentTurn = null;
  currentTurnElement = null;
  priorTurnElements = [];
  _splitSegmentBarrier = -1;
  segmentElements.clear();
  incrementalState.clear();
  liveTextNodes.clear();
  _activeSegmentIndex = -1;
}

/**
 * Finalize the streaming DOM in-place instead of rebuilding via innerHTML.
 * Preserves progressively-rendered tool calls, thinking blocks, and text
 * so the user doesn't see a "flash" where all content disappears and
 * reappears in one block at the end.
 */
function finalizeStreamingDom(turn: AssistantTurn, container: HTMLElement): void {
  // 1. Finalize text segments — replace incremental streaming markup with clean markdown
  for (let i = 0; i < turn.segments.length; i++) {
    const seg = turn.segments[i];
    const el = segmentElements.get(i);
    if (!el) continue;

    if (seg.type === "text") {
      const text = seg.chunks.join("");
      if (text) {
        el.innerHTML = renderMarkdown(text);
      }
    } else if (seg.type === "thinking") {
      if (el.tagName === "DETAILS") {
        el.removeAttribute("open");
      }
    } else if (seg.type === "server_tool") {
      const card = el.querySelector<HTMLElement>(".gsd-server-tool-card");
      if (card) {
        card.classList.remove("running");
        card.classList.add("done");
        const spinner = card.querySelector(".gsd-tool-spinner");
        if (spinner) {
          spinner.outerHTML = `<span class="gsd-server-tool-check">✓</span>`;
        }
      }
    }
  }

  // 2. Patch all tool states to final (spinners → check/error icons, collapsed state)
  for (const [, tc] of turn.toolCalls) {
    const toolEl = container.querySelector<HTMLElement>(`[data-tool-id="${tc.id}"]`);
    if (toolEl) {
      const block = toolEl.classList.contains("gsd-tool-block") ? toolEl : toolEl.querySelector<HTMLElement>(".gsd-tool-block");
      if (block) patchToolBlockElement(block, tc);
    }
  }

  // 3. Append copy button + timestamp
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

/** Reset streaming state — used by new conversation */
export function resetStreamingState(): void {
  // If the current turn element only has pending dots (optimistic spinner from
  // user send), keep it in the DOM — agent_start will reuse it via
  // ensureCurrentTurnElement and real content will replace the dots.
  // Only remove it if we're truly resetting with no pending response expected.
  currentTurnElement = null;
  priorTurnElements = [];
  _splitSegmentBarrier = -1;
  segmentElements.clear();
  incrementalState.clear();
  liveTextNodes.clear();
  _activeSegmentIndex = -1;
  stopElapsedTimer();
}

/**
 * Public entry point for targeted tool block patching.
 * Accepts either a `.gsd-tool-segment` wrapper or a `.gsd-tool-block` directly.
 */
export function patchToolBlock(el: HTMLElement, tc: ToolCallState): void {
  patchToolBlockElement(el, tc);
}

// ============================================================
// Internal — segment insertion
// ============================================================

function renderTextSegment(segIdx: number): void {
  if (!state.currentTurn) return;
  const seg = state.currentTurn.segments[segIdx];
  if (!seg || seg.type === "tool" || seg.type === "server_tool") return;

  const container = ensureCurrentTurnElement();
  // Remove pending dots now — content is about to be painted into the container.
  // Doing this here (rAF) rather than on first delta means the dots animate
  // right up until real content is visible, with no gap between the two.
  removePendingDotsFromContainer(container);
  let el = segmentElements.get(segIdx);

  const fullText = seg.chunks.join("");

  if (seg.type === "thinking") {
    // Thinking segments use textContent — no incremental markdown needed
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
    // Text segment — incremental block-level rendering
    if (!el) {
      el = document.createElement("div");
      el.className = "gsd-assistant-text";
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }

    if (!fullText) {
      // Empty text — clear trailing element if any
      const trailing = el.querySelector("[data-block-trailing]");
      if (trailing) trailing.innerHTML = "";
      return;
    }

    // Lex the full text into block tokens — use cached result if text unchanged
    let incState = incrementalState.get(segIdx);
    if (!incState) {
      incState = { frozenBlockCount: 0, lastLexedText: "", lastTokens: [], textLengthAtLastRaf: 0 };
      incrementalState.set(segIdx, incState);
    }
    let tokens: any[];
    if (incState.lastLexedText === fullText) {
      tokens = incState.lastTokens;
    } else {
      tokens = lexMarkdown(fullText);
      incState.lastLexedText = fullText;
      incState.lastTokens = tokens;
    }
    // Filter out space tokens — they're whitespace separators, not content blocks
    const contentTokens = tokens.filter((t: any) => t.type !== "space");

    if (contentTokens.length === 0) return;

    // Determine which tokens are "complete" (frozen) vs in-progress (trailing).
    // The last content token is always considered in-progress during streaming.
    // A token is considered complete when a new token appears after it.
    // Exception: we also check for incomplete fenced code blocks.
    const lastTokenIdx = contentTokens.length - 1;
    const completedCount = lastTokenIdx; // All tokens except the last are complete

    // Freeze newly completed blocks into the DOM
    if (completedCount > incState.frozenBlockCount) {
      // Prepare tokens array with links property for Parser
      const tokensWithLinks = tokens as any;
      const links = tokensWithLinks.links || {};

      for (let i = incState.frozenBlockCount; i < completedCount; i++) {
        const token = contentTokens[i];
        const singleTokenArr = Object.assign([token], { links });
        const blockHtml = sanitizeAndPostProcess(parseTokens(singleTokenArr));
        const blockDiv = document.createElement("div");
        blockDiv.dataset.blockIdx = String(i);
        blockDiv.innerHTML = blockHtml;

        // Insert before the trailing element if it exists, otherwise append
        const trailing = el.querySelector("[data-block-trailing]");
        if (trailing) {
          el.insertBefore(blockDiv, trailing);
        } else {
          el.appendChild(blockDiv);
        }
      }
      incState.frozenBlockCount = completedCount;
    }

    // Render the trailing (in-progress) token
    let trailingEl = el.querySelector("[data-block-trailing]") as HTMLElement | null;
    if (!trailingEl) {
      // Clear any pre-existing live text node seeded by the first-delta fast path
      // before appending the proper trailing element — avoids duplication.
      const existingLiveNode = liveTextNodes.get(segIdx);
      if (existingLiveNode && existingLiveNode.parentNode === el) {
        existingLiveNode.data = "";
      }
      trailingEl = document.createElement("div");
      trailingEl.dataset.blockTrailing = "";
      el.appendChild(trailingEl);
    }

    const trailingToken = contentTokens[lastTokenIdx];
    const tokensWithLinks = tokens as any;
    const links = tokensWithLinks.links || {};
    const trailingArr = Object.assign([trailingToken], { links });
    trailingEl.innerHTML = sanitizeAndPostProcess(parseTokens(trailingArr));

    // Record how much text the trailing element now represents, so the live
    // node fast-path can show only the incremental chars without duplicating.
    incState.textLengthAtLastRaf = fullText.length;

    // (Re)attach a live text node inside an inline span at the end of the
    // trailing element. Using a span (not a bare text node) ensures the
    // incremental chars sit inline with the parsed block content rather than
    // appearing as a block-level sibling (which would break formatting).
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
  // Also init the orphan render/streaming.ts module so its unit tests work
  // and any surviving callers keep functioning.
  initStreamingModule(deps);
}
