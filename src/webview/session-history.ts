// ============================================================
// Session History — overlay panel for browsing & switching sessions
// ============================================================

import type { SessionListItem } from "../shared/types";
import { escapeHtml } from "./helpers";

// ============================================================
// Module state
// ============================================================

let visible = false;
let sessions: SessionListItem[] = [];
let currentSessionId: string | null = null;
let loading = false;
let searchText = "";
let highlightIndex = -1;
let renamingSessionId: string | null = null;

// ============================================================
// Dependencies injected via init()
// ============================================================

let panelEl: HTMLElement;
let vscode: { postMessage(msg: unknown): void };
let onSessionSwitched: () => void;

// ============================================================
// Public API
// ============================================================

export function isVisible(): boolean {
  return visible;
}

export function toggle(): void {
  if (visible) {
    hide();
  } else {
    show();
  }
}

export function show(): void {
  loading = true;
  visible = true;
  searchText = "";
  highlightIndex = -1;
  renamingSessionId = null;
  render();
  vscode.postMessage({ type: "get_session_list" });
}

export function hide(): void {
  visible = false;
  searchText = "";
  highlightIndex = -1;
  renamingSessionId = null;
  panelEl.style.display = "none";
  panelEl.innerHTML = "";
}

export function setCurrentSessionId(id: string | null): void {
  currentSessionId = id;
}

/**
 * Called when the extension sends a session_list response.
 */
export function updateSessions(items: SessionListItem[]): void {
  sessions = items;
  loading = false;
  if (visible) {
    render();
    focusSearch();
  }
}

/**
 * Called when the session list fails to load.
 */
export function showError(message: string): void {
  loading = false;
  if (visible) {
    panelEl.style.display = "block";
    panelEl.innerHTML = `
      <div class="gsd-session-history-header">
        <span class="gsd-session-history-title">Session History</span>
        <button class="gsd-session-history-close" id="sessionHistoryClose">✕</button>
      </div>
      <div class="gsd-session-history-empty">
        <span class="gsd-session-history-empty-icon">⚠</span>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
    panelEl.querySelector("#sessionHistoryClose")?.addEventListener("click", hide);
  }
}

/**
 * Handle keyboard events when the panel is visible.
 * Returns true if the event was consumed.
 */
export function handleKeyDown(e: KeyboardEvent): boolean {
  if (!visible) return false;

  const filtered = getFilteredSessions();

  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
      renderList();
      scrollHighlightIntoView();
      return true;

    case "ArrowUp":
      e.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      renderList();
      scrollHighlightIntoView();
      return true;

    case "Enter":
      if (highlightIndex >= 0 && highlightIndex < filtered.length) {
        e.preventDefault();
        const s = filtered[highlightIndex];
        if (s.id === currentSessionId) {
          hide();
        } else {
          selectSession(s.path, s.id);
        }
        return true;
      }
      return false;

    case "Escape":
      e.preventDefault();
      hide();
      return true;

    default:
      return false;
  }
}

// ============================================================
// Filtering
// ============================================================

function getFilteredSessions(): SessionListItem[] {
  if (!searchText) return sessions;
  const q = searchText.toLowerCase();
  return sessions.filter((s) => {
    const name = (s.name || "").toLowerCase();
    const preview = s.firstMessage.toLowerCase();
    return name.includes(q) || preview.includes(q);
  });
}

// ============================================================
// Actions
// ============================================================

function selectSession(sessionPath: string, sessionId: string): void {
  // Mark switching state
  const item = panelEl.querySelector(`[data-session-id="${escapeAttr(sessionId)}"]`);
  item?.classList.add("switching");
  vscode.postMessage({ type: "switch_session", path: sessionPath });
}

function startRename(sessionId: string): void {
  renamingSessionId = sessionId;
  renderList();
  // Focus the rename input
  const input = panelEl.querySelector(".gsd-session-rename-input") as HTMLInputElement | null;
  input?.focus();
  input?.select();
}

function confirmRename(name: string): void {
  if (name.trim()) {
    vscode.postMessage({ type: "rename_session", name: name.trim() });
  }
  renamingSessionId = null;
  // Refresh list to show updated name
  vscode.postMessage({ type: "get_session_list" });
}

function cancelRename(): void {
  renamingSessionId = null;
  renderList();
}

function deleteSession(sessionPath: string, displayName: string): void {
  // Simple confirm dialog
  const confirmed = confirm(`Delete session "${displayName}"?\n\nThis cannot be undone.`);
  if (confirmed) {
    vscode.postMessage({ type: "delete_session", path: sessionPath });
  }
}

// ============================================================
// Rendering
// ============================================================

function render(): void {
  if (!visible) return;

  if (loading) {
    panelEl.style.display = "block";
    panelEl.innerHTML = `
      <div class="gsd-session-history-header">
        <span class="gsd-session-history-title">Session History</span>
        <button class="gsd-session-history-close" id="sessionHistoryClose">✕</button>
      </div>
      <div class="gsd-session-history-loading">
        <span class="gsd-tool-spinner"></span> Loading sessions…
      </div>
    `;
    panelEl.querySelector("#sessionHistoryClose")?.addEventListener("click", hide);
    return;
  }

  panelEl.style.display = "block";

  let html = `
    <div class="gsd-session-history-header">
      <span class="gsd-session-history-title">Session History</span>
      <button class="gsd-session-history-close" id="sessionHistoryClose">✕</button>
    </div>
  `;

  // Search input (show even when list is empty — user might be filtering)
  if (sessions.length > 0) {
    html += `
      <div class="gsd-session-history-search">
        <input type="text" class="gsd-session-search-input" id="sessionSearchInput"
               placeholder="Search sessions…" value="${escapeAttr(searchText)}" />
      </div>
    `;
  }

  html += `<div class="gsd-session-history-list" id="sessionHistoryList"></div>`;

  panelEl.innerHTML = html;

  // Wire close button
  panelEl.querySelector("#sessionHistoryClose")?.addEventListener("click", hide);

  // Wire search input
  const searchInput = panelEl.querySelector("#sessionSearchInput") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchText = searchInput.value;
      highlightIndex = 0;
      renderList();
    });

    // Keyboard navigation from search input
    searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (handleKeyDown(e)) {
        // Event was consumed — don't propagate
        return;
      }
    });
  }

  renderList();
}

function renderList(): void {
  const listEl = panelEl.querySelector("#sessionHistoryList");
  if (!listEl) return;

  const filtered = getFilteredSessions();

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="gsd-session-history-empty">
        <span class="gsd-session-history-empty-icon">${searchText ? "🔍" : "💬"}</span>
        <span>${searchText ? "No matching sessions" : "No previous sessions"}</span>
      </div>
    `;
    return;
  }

  let html = "";

  for (let i = 0; i < filtered.length; i++) {
    const s = filtered[i];
    const isCurrent = s.id === currentSessionId;
    const isHighlighted = i === highlightIndex;
    const isRenaming = s.id === renamingSessionId;
    const displayName = s.name || truncatePreview(s.firstMessage, 80);
    const timeAgo = formatRelativeTime(s.modified);
    const msgCount = s.messageCount;

    const classes = [
      "gsd-session-history-item",
      isCurrent ? "current" : "",
      isHighlighted ? "highlighted" : "",
    ].filter(Boolean).join(" ");

    html += `<div class="${classes}"
                 data-session-path="${escapeAttr(s.path)}"
                 data-session-id="${escapeAttr(s.id)}"
                 data-index="${i}">`;

    html += `<div class="gsd-session-history-item-main">`;
    if (isCurrent) html += '<span class="gsd-session-current-dot">●</span>';

    if (isRenaming) {
      const currentName = s.name || "";
      html += `<input type="text" class="gsd-session-rename-input" value="${escapeAttr(currentName)}"
                      placeholder="Session name…" />`;
    } else {
      html += `<span class="gsd-session-history-preview">${escapeHtml(displayName)}</span>`;
    }
    html += `</div>`;

    html += `<div class="gsd-session-history-item-meta">`;
    html += `<span class="gsd-session-history-time">${escapeHtml(timeAgo)}</span>`;
    html += `<span class="gsd-session-history-count">${msgCount} msg${msgCount !== 1 ? "s" : ""}</span>`;

    // Action buttons (show on hover via CSS)
    if (isCurrent && !isRenaming) {
      html += `<button class="gsd-session-action-btn rename-btn" title="Rename session" data-action="rename" data-session-id="${escapeAttr(s.id)}">✎</button>`;
    }
    if (!isCurrent) {
      html += `<button class="gsd-session-action-btn delete-btn" title="Delete session" data-action="delete"
                       data-session-path="${escapeAttr(s.path)}" data-display-name="${escapeAttr(displayName)}">🗑</button>`;
    }

    html += `</div></div>`;
  }

  listEl.innerHTML = html;

  // Wire event handlers
  listEl.querySelectorAll(".gsd-session-history-item").forEach((el) => {
    el.addEventListener("click", (e: Event) => {
      const target = e.target as HTMLElement;
      // Don't trigger switch when clicking action buttons or rename input
      if (target.closest(".gsd-session-action-btn") || target.closest(".gsd-session-rename-input")) return;

      const sessionPath = (el as HTMLElement).dataset.sessionPath!;
      const sessionId = (el as HTMLElement).dataset.sessionId!;

      if (sessionId === currentSessionId) {
        hide();
        return;
      }

      selectSession(sessionPath, sessionId);
    });
  });

  // Wire rename buttons
  listEl.querySelectorAll('[data-action="rename"]').forEach((btn) => {
    btn.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      const sessionId = (btn as HTMLElement).dataset.sessionId!;
      startRename(sessionId);
    });
  });

  // Wire rename input
  const renameInput = listEl.querySelector(".gsd-session-rename-input") as HTMLInputElement | null;
  if (renameInput) {
    renameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        confirmRename(renameInput.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    });
    renameInput.addEventListener("click", (e: Event) => {
      e.stopPropagation();
    });
  }

  // Wire delete buttons
  listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      const sessionPath = (btn as HTMLElement).dataset.sessionPath!;
      const displayName = (btn as HTMLElement).dataset.displayName!;
      deleteSession(sessionPath, displayName);
    });
  });
}

function scrollHighlightIntoView(): void {
  const highlighted = panelEl.querySelector(".gsd-session-history-item.highlighted");
  if (highlighted) {
    highlighted.scrollIntoView({ block: "nearest" });
  }
}

function focusSearch(): void {
  const input = panelEl.querySelector("#sessionSearchInput") as HTMLInputElement | null;
  if (input) {
    input.focus();
  }
}

// ============================================================
// Helpers
// ============================================================

function truncatePreview(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  }

  const month = date.toLocaleString("default", { month: "short" });
  const day = date.getDate();
  const year = date.getFullYear();
  const currentYear = new Date().getFullYear();
  if (year === currentYear) return `${month} ${day}`;
  return `${month} ${day}, ${year}`;
}

// ============================================================
// Init
// ============================================================

export interface SessionHistoryDeps {
  panelEl: HTMLElement;
  historyBtn: HTMLElement;
  vscode: { postMessage(msg: unknown): void };
  onSessionSwitched: () => void;
}

export function init(deps: SessionHistoryDeps): void {
  panelEl = deps.panelEl;
  vscode = deps.vscode;
  onSessionSwitched = deps.onSessionSwitched;

  // Wire up click handler
  deps.historyBtn.addEventListener("click", toggle);

  // Click-outside to close
  document.addEventListener("click", (e: Event) => {
    if (visible) {
      const target = e.target as HTMLElement;
      if (
        !panelEl.contains(target) &&
        target !== deps.historyBtn &&
        !deps.historyBtn.contains(target)
      ) {
        hide();
      }
    }
  });
}
