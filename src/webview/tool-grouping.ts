// ============================================================
// Tool Grouping — collapse consecutive read-only tool calls
// ============================================================

import type { TurnSegment, ToolCallState } from "./state";
import { escapeHtml } from "./helpers";

// ============================================================
// Types
// ============================================================

export type GroupedSegment =
  | { type: "single"; segment: TurnSegment }
  | { type: "group"; segments: TurnSegment[]; toolNames: string[] };

// ============================================================
// Groupable tool classification
// ============================================================

/** Tools that are read-only and safe to collapse into a group */
const GROUPABLE_TOOLS = new Set([
  "read",
  "search-the-web",
  "search_and_read",
  "fetch_page",
  "google_search",
  "resolve_library",
  "get_library_docs",
  "browser_find",
  "browser_screenshot",
  "mac_find",
  "mac_get_tree",
  "mac_read",
  "mac_screenshot",
  "discover_configs",
]);

/** Prefixes for families of read-only tools */
const GROUPABLE_PREFIXES = ["browser_get_", "mac_list_"];

/** GitHub tools that are read-only only for specific actions */
const GITHUB_READ_ACTIONS = new Set(["list", "view", "diff", "files", "checks"]);

/**
 * Returns true if a tool is read-only and eligible for grouping.
 * Uses Set lookup + prefix matching for O(1)-ish performance.
 */
export function isGroupableTool(name: string, args?: Record<string, unknown>): boolean {
  const n = name.toLowerCase();

  if (GROUPABLE_TOOLS.has(n)) return true;

  for (const prefix of GROUPABLE_PREFIXES) {
    if (n.startsWith(prefix)) return true;
  }

  // github_issues/github_prs are read-only only for list/view/diff/files/checks
  if (n === "github_issues" || n === "github_prs") {
    const action = args?.action;
    return typeof action === "string" && GITHUB_READ_ACTIONS.has(action);
  }

  return false;
}

// ============================================================
// Consecutive grouping
// ============================================================

/**
 * Walk segments linearly, accumulating runs of consecutive completed
 * non-error groupable tool segments. Flush into a group when the run
 * breaks or ends. Only emit `type: 'group'` for 2+ consecutive tools.
 */
export function groupConsecutiveTools(
  segments: TurnSegment[],
  toolCalls: Map<string, ToolCallState>,
): GroupedSegment[] {
  const result: GroupedSegment[] = [];
  let run: { segments: TurnSegment[]; toolNames: string[] } | null = null;

  const flushRun = () => {
    if (!run) return;
    if (run.segments.length >= 2) {
      result.push({ type: "group", segments: run.segments, toolNames: run.toolNames });
    } else {
      // Single tool — emit as single, no wrapper
      for (const seg of run.segments) {
        result.push({ type: "single", segment: seg });
      }
    }
    run = null;
  };

  for (const seg of segments) {
    if (seg.type === "tool") {
      const tc = toolCalls.get(seg.toolCallId);
      if (tc && !tc.isRunning && !tc.isError && isGroupableTool(tc.name, tc.args)) {
        // Accumulate into current run
        if (!run) {
          run = { segments: [], toolNames: [] };
        }
        run.segments.push(seg);
        run.toolNames.push(tc.name);
        continue;
      }
    }
    // Non-groupable segment — flush any pending run, then emit as single
    flushRun();
    result.push({ type: "single", segment: seg });
  }

  flushRun();
  return result;
}

// ============================================================
// Streaming DOM collapsing
// ============================================================

/**
 * Check if a completed tool should collapse with its DOM predecessor.
 * Both must be complete, non-error, and groupable.
 */
export function shouldCollapseWithPredecessor(
  currentTc: ToolCallState,
  predecessorEl: HTMLElement,
  toolCalls: Map<string, ToolCallState>,
): boolean {
  // Current tool must be complete, non-error, groupable
  if (currentTc.isRunning || currentTc.isError || !isGroupableTool(currentTc.name, currentTc.args)) {
    return false;
  }

  // Predecessor is an existing group — all tools in it are already validated
  if (predecessorEl.classList.contains("gsd-tool-group")) {
    return true;
  }

  // Predecessor is a standalone tool segment
  if (predecessorEl.classList.contains("gsd-tool-segment")) {
    const predToolId = predecessorEl.dataset.toolId
      ?? predecessorEl.querySelector<HTMLElement>("[data-tool-id]")?.dataset.toolId;
    if (!predToolId) return false;
    const predTc = toolCalls.get(predToolId);
    if (!predTc) return false;
    return !predTc.isRunning && !predTc.isError && isGroupableTool(predTc.name, predTc.args);
  }

  return false;
}

/**
 * Collapse a completed tool element into its predecessor — either creating
 * a new group or expanding an existing one. Returns the group element.
 *
 * IMPORTANT: caller must update segmentElements map references after this.
 */
export function collapseToolIntoGroup(
  completedEl: HTMLElement,
  predecessorEl: HTMLElement,
  toolCalls: Map<string, ToolCallState>,
): HTMLElement {
  if (predecessorEl.classList.contains("gsd-tool-group")) {
    // Expand existing group
    const content = predecessorEl.querySelector(".gsd-tool-group-content");
    if (content) {
      content.appendChild(completedEl);
    }
    // Update label and count
    const toolNames = collectGroupToolNames(predecessorEl, toolCalls);
    updateGroupLabel(predecessorEl, toolNames);
    const count = toolNames.length;
    console.debug(`[gsd] Streaming collapse: expanded group to ${count} tools`);
    return predecessorEl;
  }

  // Create new group from two standalone tools
  const group = document.createElement("details");
  group.className = "gsd-tool-group";

  // Build initial content
  const toolNames = collectToolNames([predecessorEl, completedEl], toolCalls);
  const label = buildGroupSummaryLabel(toolNames);
  const count = toolNames.length;

  group.dataset.toolGroup = String(count);
  group.dataset.toolCount = String(count);
  group.innerHTML = `<summary class="gsd-tool-group-header" role="button" tabindex="0" aria-label="Toggle ${escapeHtml(label)}" aria-expanded="false">
      <span class="gsd-tool-group-icon"><span class="gsd-tool-icon success">✓</span></span>
      <span class="gsd-tool-group-label">${escapeHtml(label)}</span>
      <span class="gsd-tool-group-count">${count}</span>
      <span class="gsd-tool-chevron">▸</span>
    </summary>
    <div class="gsd-tool-group-content"></div>`;

  const content = group.querySelector(".gsd-tool-group-content")!;

  // Insert group at predecessor's position, reparent both elements into it
  predecessorEl.parentNode!.insertBefore(group, predecessorEl);
  content.appendChild(predecessorEl);
  content.appendChild(completedEl);

  console.debug(`[gsd] Streaming collapse: created group with ${count} tools`);
  return group;
}

/** Collect tool names from elements inside a group (or from a list of standalone elements) */
function collectGroupToolNames(
  groupEl: HTMLElement,
  toolCalls: Map<string, ToolCallState>,
): string[] {
  const toolEls = groupEl.querySelectorAll<HTMLElement>(".gsd-tool-segment[data-tool-id]");
  const names: string[] = [];
  for (const el of Array.from(toolEls)) {
    const tc = toolCalls.get(el.dataset.toolId!);
    if (tc) names.push(tc.name);
  }
  return names;
}

function collectToolNames(
  elements: HTMLElement[],
  toolCalls: Map<string, ToolCallState>,
): string[] {
  const names: string[] = [];
  for (const el of elements) {
    const toolId = el.dataset.toolId
      ?? el.querySelector<HTMLElement>("[data-tool-id]")?.dataset.toolId;
    if (toolId) {
      const tc = toolCalls.get(toolId);
      if (tc) names.push(tc.name);
    }
  }
  return names;
}

function updateGroupLabel(groupEl: HTMLElement, toolNames: string[]): void {
  const count = toolNames.length;
  groupEl.dataset.toolGroup = String(count);
  groupEl.dataset.toolCount = String(count);
  const labelEl = groupEl.querySelector(".gsd-tool-group-label");
  if (labelEl) labelEl.textContent = buildGroupSummaryLabel(toolNames);
  const countEl = groupEl.querySelector(".gsd-tool-group-count");
  if (countEl) countEl.textContent = String(count);
}

// ============================================================
// Summary label generation
// ============================================================

/**
 * Build a human-readable summary for a group of tool calls.
 * e.g. "Read 3 files", "5 search queries", "Read 2 files, 1 search"
 */
export function buildGroupSummaryLabel(toolNames: string[]): string {
  const counts = new Map<string, number>();
  for (const name of toolNames) {
    const n = name.toLowerCase();
    counts.set(n, (counts.get(n) || 0) + 1);
  }

  // Single tool type — use friendly labels
  if (counts.size === 1) {
    const [name, count] = [...counts.entries()][0];
    return getFriendlyLabel(name, count);
  }

  // Multiple tool types — enumerate
  const parts: string[] = [];
  for (const [name, count] of counts) {
    parts.push(getFriendlyLabel(name, count));
  }
  return parts.join(", ");
}

function getFriendlyLabel(toolName: string, count: number): string {
  const n = toolName.toLowerCase();
  if (n === "read") return `Read ${count} file${count !== 1 ? "s" : ""}`;
  if (n === "fetch_page") return `${count} page fetch${count !== 1 ? "es" : ""}`;
  if (n === "search-the-web" || n === "search_and_read" || n === "google_search") {
    return `${count} search${count !== 1 ? "es" : ""}`;
  }
  if (n === "resolve_library" || n === "get_library_docs") {
    return `${count} doc lookup${count !== 1 ? "s" : ""}`;
  }
  if (n === "browser_screenshot" || n === "mac_screenshot") {
    return `${count} screenshot${count !== 1 ? "s" : ""}`;
  }
  // Generic
  return `${count} ${toolName} call${count !== 1 ? "s" : ""}`;
}
