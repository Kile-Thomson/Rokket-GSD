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
  slashMenuEl.style.display = "none";
  slashMenuEl.innerHTML = "";
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

function buildItems(): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];

  const gsdSubcommands: Array<{ name: string; desc: string; sendOnSelect?: boolean }> = [
    { name: "gsd", desc: "Contextual wizard — pick the next action", sendOnSelect: true },
    { name: "gsd next", desc: "Execute the next task", sendOnSelect: true },
    { name: "gsd auto", desc: "Auto-execute tasks (fresh context per task)", sendOnSelect: true },
    { name: "gsd stop", desc: "Stop auto-mode", sendOnSelect: true },

    { name: "gsd status", desc: "Project dashboard — milestones, slices, tasks", sendOnSelect: true },
    { name: "gsd queue", desc: "Queue future milestones", sendOnSelect: true },
    { name: "gsd discuss", desc: "Discuss without executing", sendOnSelect: true },
    { name: "gsd prefs", desc: "View or set preferences" },
    { name: "gsd doctor", desc: "Diagnose and fix issues" },
    { name: "gsd migrate", desc: "Migrate project artifacts" },
    { name: "gsd remote", desc: "Remote question channels (Slack, Discord)" },
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
    { name: "export", description: "Export conversation as HTML", insertText: "", source: "webview" },
    { name: "model", description: "Change AI model", insertText: "", source: "webview" },
    { name: "thinking", description: "Cycle thinking level", insertText: "", source: "webview" },
    { name: "new", description: "Start a new conversation", insertText: "", source: "webview" },
    { name: "history", description: "Browse and switch sessions", insertText: "", source: "webview" },
    { name: "copy", description: "Copy last assistant message to clipboard", insertText: "", source: "webview" },
    { name: "resume", description: "Resume last session", insertText: "", source: "webview" },
    { name: "auto-compact", description: "Toggle auto-compaction on/off", insertText: "", source: "webview" },
  );

  return items;
}

function render(): void {
  slashMenuEl.style.display = "block";
  slashMenuEl.setAttribute("role", "listbox");
  slashMenuEl.setAttribute("aria-label", "Slash commands");
  slashMenuEl.innerHTML = filteredItems.map((item, i) => `
    <div class="gsd-slash-item ${i === slashMenuIndex ? "active" : ""}" role="option" aria-selected="${i === slashMenuIndex}" data-idx="${i}">
      <span class="gsd-slash-name">/${escapeHtml(item.name)}</span>
      <span class="gsd-slash-desc">${escapeHtml(item.description)}</span>
    </div>
  `).join("");

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
      case "thinking":
        vscode.postMessage({ type: "cycle_thinking_level" });
        promptInput.value = "";
        onAutoResize();
        break;
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
    }
    promptInput.focus();
    return;
  }

  if (item.sendOnSelect) {
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
}
