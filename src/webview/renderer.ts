// ============================================================
// Renderer — entry building, streaming segments, DOM management
// ============================================================

import {
  state,
  type ChatEntry,
  type AssistantTurn,
  type ToolCallState,
  type TurnSegment,
  pruneOldEntries,
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
  buildUsagePills,
  renderMarkdown,
  sanitizeAndPostProcess,
  lexMarkdown,
  parseTokens,
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
  // If streaming, insert the user message AFTER the current streaming element
  // without splitting the assistant turn. The assistant continues rendering
  // in the same element — the user message just appears below the in-progress response.
  if (currentTurnElement && currentTurnElement.parentNode === messagesContainer) {
    currentTurnElement.after(el);
  } else {
    messagesContainer.appendChild(el);
  }
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
      // If trailing entries are steer/interrupt messages, insert the new
      // assistant turn before them so auto-mode continuation content doesn't
      // appear below the user's interrupt.
      let firstSteer: HTMLElement | null = null;
      const children = messagesContainer.children;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i] as HTMLElement;
        if (child.dataset.steer === "true") {
          firstSteer = child;
        } else {
          break;
        }
      }
      if (firstSteer) {
        messagesContainer.insertBefore(el, firstSteer);
        // Clear steer marks — only one auto-mode turn should be inserted
        // before the steer. Subsequent turns go after (they're the response).
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i] as HTMLElement;
          if (child.dataset.steer === "true") {
            delete child.dataset.steer;
          } else {
            break;
          }
        }
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

// ============================================================
// Internal — HTML builders
// ============================================================

function createEntryElement(entry: ChatEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = `gsd-entry gsd-entry-${entry.type}`;
  el.dataset.entryId = entry.id;

  if (entry.type === "user") {
    el.innerHTML = buildUserHtml(entry);
    if (entry.isSteer) el.dataset.steer = "true";
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
  } else if (seg.type === "server_tool") {
    const displayName = seg.name === "web_search" ? "Web Search" : seg.name;
    const icon = seg.name === "web_search" ? "🔍" : "⚡";
    const inputSummary = seg.input && typeof seg.input === "object" && "query" in (seg.input as Record<string, unknown>)
      ? String((seg.input as Record<string, unknown>).query ?? "")
      : "";
    const stateClass = seg.isComplete ? "done" : "running";
    const statusHtml = seg.isComplete
      ? `<span class="gsd-server-tool-check">✓</span>`
      : `<span class="gsd-tool-spinner"></span>`;
    // Include result count in finalized HTML when results are available
    let countHtml = "";
    if (seg.isComplete && Array.isArray(seg.results)) {
      const searchResults = (seg.results as unknown[]).filter(
        (r: unknown) => r && typeof r === "object" && "type" in (r as Record<string, unknown>) && (r as Record<string, unknown>).type === "web_search_result"
      );
      if (searchResults.length > 0) {
        countHtml = `<span class="gsd-server-tool-count">${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}</span>`;
      }
    }
    return `<div class="gsd-server-tool-segment"><div class="gsd-server-tool-card ${stateClass}">` +
      `<span class="gsd-server-tool-icon">${icon}</span>` +
      `<span class="gsd-server-tool-name">${escapeHtml(displayName)}</span>` +
      (inputSummary ? `<span class="gsd-server-tool-query">${escapeHtml(inputSummary)}</span>` : "") +
      statusHtml +
      countHtml +
      `</div></div>`;
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

/**
 * Targeted DOM patch for a tool block element.
 * Updates only the parts that can change (status icon, classes, duration,
 * output) without replacing innerHTML, so spinner animations and focus
 * state are preserved across elapsed-timer ticks and progress updates.
 *
 * `el` may be the `.gsd-tool-segment` wrapper or the `.gsd-tool-block` itself.
 */
function patchToolBlockElement(el: HTMLElement, tc: ToolCallState): void {
  const block = el.classList.contains("gsd-tool-block")
    ? el
    : el.querySelector<HTMLElement>(".gsd-tool-block");
  if (!block) {
    // Fallback — element structure unexpected, full rebuild
    el.innerHTML = buildToolCallHtml(tc);
    return;
  }

  const stateClass = tc.isRunning ? "running" : tc.isSkipped ? "skipped" : tc.isError ? "error" : "done";
  const n = tc.name.toLowerCase();
  const isSubagent = n === "subagent" || n === "async_subagent" || n === "await_subagent";
  const lines = tc.resultText ? tc.resultText.split("\n").length : 0;
  const shouldCollapse = !tc.isRunning && !isSubagent && (lines > 5 || tc.isSkipped);

  // Update block-level classes
  block.classList.remove("running", "skipped", "error", "done", "collapsed");
  block.classList.add(stateClass);
  if (shouldCollapse) block.classList.add("collapsed");
  if (tc.isParallel) block.classList.add("parallel");

  // Update aria-expanded on header
  const header = block.querySelector<HTMLElement>(".gsd-tool-header");
  if (header) {
    header.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
  }

  // Update status icon — only replace if state changed to avoid resetting spinner
  const statusIconEl = block.querySelector<HTMLElement>(
    ".gsd-tool-spinner, .gsd-tool-icon"
  );
  if (statusIconEl) {
    const currentlyRunning = statusIconEl.classList.contains("gsd-tool-spinner") ||
      !statusIconEl.classList.contains("gsd-tool-icon");
    if (tc.isRunning && !statusIconEl.classList.contains("gsd-tool-spinner")) {
      // Transition to running — replace with spinner
      const spinner = document.createElement("span");
      spinner.className = "gsd-tool-spinner";
      statusIconEl.replaceWith(spinner);
    } else if (!tc.isRunning && (currentlyRunning || statusIconEl.classList.contains("gsd-tool-spinner"))) {
      // Transition from running — replace spinner with result icon
      const icon = document.createElement("span");
      icon.className = "gsd-tool-icon " + (tc.isSkipped ? "skipped" : tc.isError ? "error" : "success");
      icon.textContent = tc.isSkipped ? "⏭" : tc.isError ? "✗" : "✓";
      statusIconEl.replaceWith(icon);
    } else if (!tc.isRunning) {
      // Already not running — just update class/text in case error state changed
      statusIconEl.className = "gsd-tool-icon " + (tc.isSkipped ? "skipped" : tc.isError ? "error" : "success");
      statusIconEl.textContent = tc.isSkipped ? "⏭" : tc.isError ? "✗" : "✓";
    }
    // If still running — leave spinner element alone (preserves animation)
  }

  // Update duration
  const duration = tc.endTime && tc.startTime
    ? formatDuration(tc.endTime - tc.startTime)
    : tc.isRunning && tc.startTime
      ? formatDuration(Date.now() - tc.startTime)
      : "";
  const durationEl = block.querySelector<HTMLElement>(".gsd-tool-duration");
  if (duration) {
    if (durationEl) {
      durationEl.textContent = duration;
      durationEl.className = `gsd-tool-duration${tc.isRunning ? " elapsed-live" : ""}`;
    } else {
      // Insert duration before chevron
      const right = block.querySelector<HTMLElement>(".gsd-tool-header-right");
      if (right) {
        const span = document.createElement("span");
        span.className = `gsd-tool-duration${tc.isRunning ? " elapsed-live" : ""}`;
        span.textContent = duration;
        const chevron = right.querySelector(".gsd-tool-chevron");
        right.insertBefore(span, chevron ?? null);
      }
    }
  } else if (durationEl) {
    durationEl.remove();
  }

  // Update output
  const outputEl = block.querySelector<HTMLElement>(".gsd-tool-output");
  if (isSubagent) {
    const newOutputHtml = buildSubagentOutputHtml(tc);
    if (outputEl) {
      // Patch subagent panel in place to preserve spinner animation state.
      // If the panel structure already exists, update only what changed.
      const existingPanel = outputEl.querySelector<HTMLElement>(".gsd-subagent-panel");
      if (existingPanel) {
        patchSubagentPanel(existingPanel, tc);
      } else {
        outputEl.className = "gsd-tool-output gsd-tool-output-rich";
        outputEl.innerHTML = newOutputHtml;
      }
    } else {
      const div = document.createElement("div");
      div.className = "gsd-tool-output gsd-tool-output-rich";
      div.innerHTML = newOutputHtml;
      block.appendChild(div);
    }
  } else if (tc.resultText) {
    const formattedResult = formatToolResult(tc.name, tc.resultText, tc.args);
    const maxOutputLen = 8000;
    let displayText = formattedResult;
    let truncated = false;
    if (displayText.length > maxOutputLen) {
      displayText = displayText.slice(0, maxOutputLen);
      truncated = true;
    }
    let newOutputHtml = `<pre><code>${escapeHtml(displayText)}</code></pre>`;
    if (truncated) {
      newOutputHtml += `<div class="gsd-tool-output-truncated">… output truncated (${formatTokens(tc.resultText.length)} chars)</div>`;
    }
    if (outputEl) {
      outputEl.className = "gsd-tool-output";
      outputEl.innerHTML = newOutputHtml;
    } else {
      const div = document.createElement("div");
      div.className = "gsd-tool-output";
      div.innerHTML = newOutputHtml;
      block.appendChild(div);
    }
  } else if (tc.isRunning) {
    if (outputEl) {
      outputEl.className = "gsd-tool-output";
      outputEl.innerHTML = `<span class="gsd-tool-output-pending">Running...</span>`;
    } else {
      const div = document.createElement("div");
      div.className = "gsd-tool-output";
      div.innerHTML = `<span class="gsd-tool-output-pending">Running...</span>`;
      block.appendChild(div);
    }
  } else if (outputEl) {
    outputEl.remove();
  }
}

/**
 * Public entry point for targeted tool block patching.
 * Accepts either a `.gsd-tool-segment` wrapper or a `.gsd-tool-block` directly.
 */
export function patchToolBlock(el: HTMLElement, tc: ToolCallState): void {
  patchToolBlockElement(el, tc);
}

/**
 * Patch a .gsd-subagent-panel in place — update summary counts and each
 * agent card's state without rebuilding the DOM, so spinner animations
 * on running agents survive progress updates.
 */
function patchSubagentPanel(panel: HTMLElement, tc: ToolCallState): void {
  const details = tc.details as { mode?: string; results?: any[] } | undefined;
  const results = details?.results;
  if (!results) return;

  const running = results.filter((r: any) => r.exitCode === -1).length;
  const done = results.filter((r: any) => r.exitCode !== -1 && r.exitCode === 0).length;
  const failed = results.filter((r: any) => r.exitCode > 0 || r.stopReason === "error").length;
  const total = results.length;

  // Update summary counts
  const countsEl = panel.querySelector<HTMLElement>(".gsd-subagent-counts");
  if (countsEl) {
    const parts: string[] = [];
    if (done > 0) parts.push(`<span class="gsd-agent-stat done">${done} done</span>`);
    if (running > 0) parts.push(`<span class="gsd-agent-stat running">${running} running</span>`);
    if (failed > 0) parts.push(`<span class="gsd-agent-stat error">${failed} failed</span>`);
    countsEl.innerHTML = parts.join(`<span class="gsd-agent-sep">·</span>`);
  }
  const totalEl = panel.querySelector<HTMLElement>(".gsd-subagent-total");
  if (totalEl) totalEl.textContent = `${done + failed}/${total}`;

  // Patch each agent card — match by index
  const cardEls = panel.querySelectorAll<HTMLElement>(".gsd-agent-card");
  results.forEach((r: any, i: number) => {
    const card = cardEls[i];
    if (!card) return;

    const isRunning = r.exitCode === -1;
    const isFailed = !isRunning && (r.exitCode !== 0 || r.stopReason === "error");
    const newState = isRunning ? "running" : isFailed ? "error" : "done";

    // Update card state class
    card.classList.remove("running", "error", "done");
    card.classList.add(newState);

    // Update status icon — only swap when state transitions to avoid reset
    const iconEl = card.querySelector<HTMLElement>(".gsd-tool-spinner, .gsd-agent-icon");
    if (iconEl) {
      const currentlySpinner = iconEl.classList.contains("gsd-tool-spinner");
      if (isRunning && !currentlySpinner) {
        const spinner = document.createElement("span");
        spinner.className = "gsd-tool-spinner";
        iconEl.replaceWith(spinner);
      } else if (!isRunning && currentlySpinner) {
        const icon = document.createElement("span");
        icon.className = `gsd-agent-icon ${isFailed ? "error" : "done"}`;
        icon.textContent = isFailed ? "✗" : "✓";
        iconEl.replaceWith(icon);
      } else if (!isRunning) {
        iconEl.className = `gsd-agent-icon ${isFailed ? "error" : "done"}`;
        iconEl.textContent = isFailed ? "✗" : "✓";
      }
      // Still running — leave spinner alone
    }

    // Update usage pills (token counts, cost) — these change on progress
    const headerEl = card.querySelector<HTMLElement>(".gsd-agent-header");
    if (headerEl && r.usage) {
      const existingPills = headerEl.querySelector<HTMLElement>(".gsd-agent-usage");
      const newPillsHtml = buildUsagePills(r.usage, r.model);
      if (existingPills) {
        existingPills.outerHTML = newPillsHtml || "<div class=\"gsd-agent-usage\"></div>";
      } else if (newPillsHtml) {
        headerEl.insertAdjacentHTML("beforeend", newPillsHtml);
      }
    }

    // Update error message if failed
    if (isFailed && r.errorMessage) {
      let errEl = card.querySelector<HTMLElement>(".gsd-agent-error");
      if (!errEl) {
        errEl = document.createElement("div");
        errEl.className = "gsd-agent-error";
        card.appendChild(errEl);
      }
      errEl.textContent = r.errorMessage;
    }
  });

  // Update footer usage pills if completed
  if (!tc.isRunning) {
    const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
    for (const r of results) {
      if (r.usage) {
        totalUsage.input += r.usage.input || 0;
        totalUsage.output += r.usage.output || 0;
        totalUsage.cacheRead += r.usage.cacheRead || 0;
        totalUsage.cacheWrite += r.usage.cacheWrite || 0;
        totalUsage.cost += r.usage.cost || 0;
        totalUsage.turns += r.usage.turns || 0;
      }
    }
    if (totalUsage.turns > 0) {
      let footerEl = panel.querySelector<HTMLElement>(".gsd-subagent-footer");
      if (!footerEl) {
        footerEl = document.createElement("div");
        footerEl.className = "gsd-subagent-footer";
        panel.appendChild(footerEl);
      }
      footerEl.innerHTML = buildUsagePills(totalUsage, undefined);
    }
  }

  // Upsert the final result block — buildSubagentOutputHtml adds
  // .gsd-subagent-result when the tool is complete, so we must mirror that
  // here to avoid dropping the completed subagent's markdown output.
  if (!tc.isRunning && tc.resultText) {
    let resultEl = panel.parentElement?.querySelector<HTMLElement>(".gsd-subagent-result");
    if (!resultEl) {
      resultEl = document.createElement("div");
      resultEl.className = "gsd-subagent-result";
      panel.parentElement?.appendChild(resultEl);
    }
    resultEl.innerHTML = renderMarkdown(tc.resultText);
  }
}

export function buildToolCallHtml(tc: ToolCallState): string {
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
  const n = tc.name.toLowerCase();
  const isSubagent = n === "subagent" || n === "async_subagent" || n === "await_subagent";

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
}
