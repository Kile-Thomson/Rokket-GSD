// ============================================================
// Slash Menu — command palette triggered by typing /
// ============================================================

import { state } from "./state";
import { escapeHtml } from "./helpers";

// ============================================================
// Types
// ============================================================

interface SlashMenuItem {
  name: string;
  description: string;
  insertText: string;
  source?: string;
  /** When true, selecting this item sends it as a prompt immediately */
  sendOnSelect?: boolean;
}

// ============================================================
// Module state
// ============================================================

let slashMenuVisible = false;
let slashMenuIndex = 0;
let filteredItems: SlashMenuItem[] = [];

// ============================================================
// Dependencies injected via init()
// ============================================================

let slashMenuEl: HTMLElement;
let promptInput: HTMLTextAreaElement;
let vscode: { postMessage(msg: unknown): void };

/** Callbacks back into the main module */
let onAutoResize: () => void;
let onShowModelPicker: () => void;
let onNewConversation: () => void;
let onSendMessage: () => void;
let onShowHistory: (() => void) | undefined;
let onCopyLast: (() => void) | undefined;
let onToggleAutoCompact: (() => void) | undefined;
let onToggleAutoRetry: (() => void) | undefined;

// ============================================================
// Public API
// ============================================================

export function isVisible(): boolean {
  return slashMenuVisible;
}

export function getIndex(): number {
  return slashMenuIndex;
}

export function getFilteredItems(): SlashMenuItem[] {
  return filteredItems;
}

let _triggerEl: HTMLElement | null = null;

export function show(filter: string): void {
  if (!slashMenuVisible) {
    _triggerEl = document.activeElement as HTMLElement | null;
  }
  if (!state.commandsLoaded) {
    vscode.postMessage({ type: "get_commands" });
  }
  const q = filter.toLowerCase();
  const allItems = buildItems();
  filteredItems = allItems.filter(
    (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
  );
  if (filteredItems.length === 0) {
    hide();
    return;
  }
  slashMenuIndex = 0;
  slashMenuVisible = true;
  render();
}

export function hide(): void {
  slashMenuVisible = false;
  slashMenuEl.classList.add("gsd-hidden");
  slashMenuEl.innerHTML = "";
  promptInput?.removeAttribute("aria-activedescendant");
  // Restore focus to prompt input (slash menu is always triggered from input)
  promptInput?.focus();
  _triggerEl = null;
}

export function navigateDown(): void {
  slashMenuIndex = Math.min(slashMenuIndex + 1, filteredItems.length - 1);
  render();
}

export function navigateUp(): void {
  slashMenuIndex = Math.max(slashMenuIndex - 1, 0);
  render();
}

export function selectCurrent(): void {
  selectCommand(slashMenuIndex);
}

// ============================================================
// Internal
// ============================================================

/** @internal — exported for testing */
export function buildItems(): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];

  const gsdSubcommands: Array<{ name: string; desc: string; sendOnSelect?: boolean }> = [
    // ── Core workflow ─────────────────────────────────────────────────
    { name: "gsd", desc: "Contextual wizard — pick the next action", sendOnSelect: true },
    { name: "gsd next", desc: "Execute the next task", sendOnSelect: true },
    { name: "gsd auto", desc: "Auto-execute tasks (fresh context per task)", sendOnSelect: true },
    { name: "gsd stop", desc: "Stop auto-mode", sendOnSelect: true },
    { name: "gsd pause", desc: "Pause auto-mode (preserves state, /gsd auto to resume)", sendOnSelect: true },
    { name: "gsd quick", desc: "Execute ad-hoc task with GSD guarantees" },
    { name: "gsd discuss", desc: "Discuss without executing", sendOnSelect: true },

    // ── Visibility ────────────────────────────────────────────────────
    { name: "gsd status", desc: "Project dashboard — milestones, slices, tasks", sendOnSelect: true },
    { name: "gsd visualize", desc: "Open workflow visualizer overlay", sendOnSelect: true },
    { name: "gsd help", desc: "Categorized command reference", sendOnSelect: true },
    { name: "gsd changelog", desc: "Show categorized release notes", sendOnSelect: true },

    // ── Steering & capture ────────────────────────────────────────────
    { name: "gsd capture", desc: "Capture a thought during auto-mode" },
    { name: "gsd steer", desc: "Redirect auto-mode priorities" },
    { name: "gsd triage", desc: "Manually trigger triage of pending captures", sendOnSelect: true },
    { name: "gsd knowledge", desc: "View or add to project knowledge base", sendOnSelect: true },

    // ── Queue & milestones ────────────────────────────────────────────
    { name: "gsd queue", desc: "Queue and reorder future milestones", sendOnSelect: true },
    { name: "gsd new-milestone", desc: "Create a milestone from a specification document", sendOnSelect: true },
    { name: "gsd park", desc: "Park a milestone — skip without deleting" },
    { name: "gsd unpark", desc: "Reactivate a parked milestone" },

    // ── Dispatch & history ────────────────────────────────────────────
    { name: "gsd dispatch", desc: "Dispatch a specific phase directly" },
    { name: "gsd history", desc: "View execution history", sendOnSelect: true },
    { name: "gsd undo", desc: "Revert last completed unit" },
    { name: "gsd skip", desc: "Prevent a unit from auto-mode dispatch" },

    // ── Workflow templates ────────────────────────────────────────────
    { name: "gsd start", desc: "Start a workflow template (bugfix, spike, feature, etc.)" },
    { name: "gsd templates", desc: "List available workflow templates", sendOnSelect: true },

    // ── Export & cleanup ──────────────────────────────────────────────
    { name: "gsd export", desc: "Export milestone report as HTML (via gsd-pi)" },
    { name: "gsd cleanup", desc: "Remove merged branches or snapshots" },

    // ── Configuration ─────────────────────────────────────────────────
    { name: "gsd config", desc: "View or modify GSD configuration", sendOnSelect: true },
    { name: "gsd prefs", desc: "View or set preferences" },
    { name: "gsd mode", desc: "Switch workflow mode (solo/team)" },
    { name: "gsd keys", desc: "Manage API keys", sendOnSelect: true },
    { name: "gsd hooks", desc: "Show configured post-unit and pre-dispatch hooks", sendOnSelect: true },
    { name: "gsd run-hook", desc: "Manually trigger a specific hook" },
    { name: "gsd extensions", desc: "Manage extensions (list, enable, disable, info)", sendOnSelect: true },

    // ── Diagnostics ───────────────────────────────────────────────────
    { name: "gsd doctor", desc: "Diagnose and fix issues", sendOnSelect: true },
    { name: "gsd forensics", desc: "Post-mortem analysis of auto-mode failures", sendOnSelect: true },
    { name: "gsd logs", desc: "Browse activity, debug, and metrics logs", sendOnSelect: true },
    { name: "gsd inspect", desc: "Show SQLite DB diagnostics", sendOnSelect: true },
    { name: "gsd skill-health", desc: "Skill lifecycle dashboard", sendOnSelect: true },
    { name: "gsd rate", desc: "Token usage rates and profile defaults", sendOnSelect: true },

    // ── Setup & maintenance ───────────────────────────────────────────
    { name: "gsd init", desc: "Project init wizard — detect, configure, bootstrap .gsd/" },
    { name: "gsd setup", desc: "Global setup status and configuration", sendOnSelect: true },
    { name: "gsd migrate", desc: "Migrate a v1 .planning directory to .gsd format" },
    { name: "gsd update", desc: "Update GSD to the latest version", sendOnSelect: true },

    // ── Advanced ──────────────────────────────────────────────────────
    { name: "gsd remote", desc: "Remote question channels (Slack, Discord, Telegram)" },
    { name: "gsd parallel", desc: "Parallel auto-mode orchestration" },
  ];

  for (const sub of gsdSubcommands) {
    items.push({
      name: sub.name,
      description: sub.desc,
      insertText: `/${sub.name} `,
      source: "gsd",
      sendOnSelect: sub.sendOnSelect,
    });
  }

  for (const cmd of state.commands) {
    if (cmd.name === "gsd") continue;
    items.push({
      name: cmd.name,
      description: cmd.description || "",
      insertText: `/${cmd.name} `,
      source: cmd.source,
    });
  }

  items.push(
    { name: "compact", description: "Compact context to reduce token usage", insertText: "", source: "webview" },
    { name: "export", description: "Export current conversation as HTML file", insertText: "", source: "webview" },
    { name: "model", description: "Change AI model", insertText: "", source: "webview" },
    { name: "thinking", description: "Cycle thinking level", insertText: "", source: "webview" },
    { name: "new", description: "Start a new conversation", insertText: "", source: "webview" },
    { name: "history", description: "Browse and switch sessions", insertText: "", source: "webview" },
    { name: "copy", description: "Copy last assistant message to clipboard", insertText: "", source: "webview" },
    { name: "resume", description: "Resume last session", insertText: "", source: "webview" },
    { name: "auto-compact", description: "Toggle auto-compaction on/off", insertText: "", source: "webview" },
    { name: "auto-retry", description: "Toggle auto-retry on transient errors", insertText: "", source: "webview" },
  );

  return items;
}

function render(): void {
  slashMenuEl.classList.remove("gsd-hidden");
  slashMenuEl.setAttribute("role", "listbox");
  slashMenuEl.setAttribute("aria-label", "Slash commands");
  slashMenuEl.innerHTML = filteredItems.map((item, i) => `
    <div class="gsd-slash-item ${i === slashMenuIndex ? "active" : ""}" role="option" aria-selected="${i === slashMenuIndex}" id="gsd-slash-opt-${i}" data-idx="${i}">
      <span class="gsd-slash-name">/${escapeHtml(item.name)}</span>
      <span class="gsd-slash-desc">${escapeHtml(item.description)}</span>
    </div>
  `).join("");

  // Link active option to input for screen reader announcement
  if (filteredItems.length > 0 && slashMenuIndex >= 0) {
    promptInput.setAttribute("aria-activedescendant", `gsd-slash-opt-${slashMenuIndex}`);
  } else {
    promptInput.removeAttribute("aria-activedescendant");
  }

  slashMenuEl.querySelectorAll(".gsd-slash-item").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt((el as HTMLElement).dataset.idx!);
      selectCommand(idx);
    });
  });

  const activeEl = slashMenuEl.querySelector(".gsd-slash-item.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}

function selectCommand(idx: number): void {
  const item = filteredItems[idx];
  if (!item) { hide(); return; }

  if (item.source === "webview") {
    hide();
    switch (item.name) {
      case "compact":
        vscode.postMessage({ type: "compact_context" });
        promptInput.value = "";
        onAutoResize();
        break;
      case "export":
        vscode.postMessage({ type: "export_html" });
        promptInput.value = "";
        onAutoResize();
        break;
      case "model":
        promptInput.value = "";
        onAutoResize();
        onShowModelPicker();
        break;
      case "thinking": {
        // Only cycle if there is a current model, and either:
        // - models are not loaded yet (allow optimistically), or
        // - the loaded model metadata says reasoning is supported.
        const supportsReasoning = state.model
          ? (!state.modelsLoaded ||
              state.availableModels.some(
                (m) => m.id === state.model!.id && m.provider === state.model!.provider && m.reasoning
              ))
          : false;
        if (supportsReasoning) {
          vscode.postMessage({ type: "cycle_thinking_level" });
        }
        promptInput.value = "";
        onAutoResize();
        break;
      }
      case "new":
        promptInput.value = "";
        onAutoResize();
        onNewConversation();
        break;
      case "history":
        promptInput.value = "";
        onAutoResize();
        onShowHistory?.();
        break;
      case "copy":
        promptInput.value = "";
        onAutoResize();
        onCopyLast?.();
        break;
      case "resume":
        promptInput.value = "";
        onAutoResize();
        vscode.postMessage({ type: "resume_last_session" });
        break;
      case "auto-compact":
        promptInput.value = "";
        onAutoResize();
        onToggleAutoCompact?.();
        break;
      case "auto-retry":
        promptInput.value = "";
        onAutoResize();
        onToggleAutoRetry?.();
        break;
    }
    promptInput.focus();
    return;
  }

  if (item.sendOnSelect) {
    // Block sending during compaction
    if (state.isCompacting) { hide(); return; }
    // Execute immediately — set the text and trigger send
    promptInput.value = item.insertText.trimEnd();
    onAutoResize();
    hide();
    onSendMessage();
    promptInput.focus();
  } else {
    // Fill input for further editing (command takes arguments)
    promptInput.value = item.insertText;
    onAutoResize();
    promptInput.focus();
    hide();
  }
}

// ============================================================
// Init — wire up dependencies and input listener
// ============================================================

export interface SlashMenuDeps {
  slashMenuEl: HTMLElement;
  promptInput: HTMLTextAreaElement;
  vscode: { postMessage(msg: unknown): void };
  onAutoResize: () => void;
  onShowModelPicker: () => void;
  onNewConversation: () => void;
  onSendMessage: () => void;
  onShowHistory?: () => void;
  onCopyLast?: () => void;
  onToggleAutoCompact?: () => void;
  onToggleAutoRetry?: () => void;
}

export function init(deps: SlashMenuDeps): void {
  slashMenuEl = deps.slashMenuEl;
  promptInput = deps.promptInput;
  vscode = deps.vscode;
  onAutoResize = deps.onAutoResize;
  onShowModelPicker = deps.onShowModelPicker;
  onNewConversation = deps.onNewConversation;
  onSendMessage = deps.onSendMessage;
  onShowHistory = deps.onShowHistory;
  onCopyLast = deps.onCopyLast;
  onToggleAutoCompact = deps.onToggleAutoCompact;
  onToggleAutoRetry = deps.onToggleAutoRetry;
}
