import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "../../shared/types";
type Msg<T extends ExtensionToWebviewMessage['type']> = Extract<ExtensionToWebviewMessage, { type: T }>;
import {
  escapeHtml,
  formatMarkdownNotes,
  formatShortDate,
  scrollToBottom,
} from "../helpers";
import {
  TOAST_MEDIUM_DURATION_MS,
  TOAST_LONG_DURATION_MS,
  NOTE_AUTO_DISMISS_MS,
  CSS_ANIMATION_SETTLE_MS,
} from "../../shared/constants";
import { state } from "../state";
import * as renderer from "../renderer";
import * as toasts from "../toasts";
import * as autoProgress from "../auto-progress";
import * as uiDialogs from "../ui-dialogs";
import * as fileHandling from "../file-handling";
import { announceToScreenReader, createFocusTrap, restoreFocus } from "../a11y";
import { setChangelogHandlers, getChangelogTriggerEl, dismissChangelog } from "../keyboard";
import {
  getDeps,
  addSystemEntry,
  removeSteerNotes,
  resetDerivedSessionTracking,
  getActiveBatchToolIds,
  setActiveBatchToolIds,
  getBatchFinalizeTimer,
  setBatchFinalizeTimer,
  setMessageParallelToolIds,
  getLastMessageUsage,
  getGsdApp,
  getSettingsDropdown,
  getWidgetContainer,
} from "./handler-state";
import { flushToolEndQueue } from "./tool-execution-handlers";

export { addSystemEntry };

export function handleAutoCompactionStart(): void {
  state.isCompacting = true;
  const deps = getDeps();
  deps.updateOverlayIndicators();
  deps.updateInputUI();
}

export function handleAutoCompactionEnd(msg: Msg<'auto_compaction_end'>): void {
  state.isCompacting = false;
  const deps = getDeps();
  deps.updateOverlayIndicators();
  deps.updateInputUI();
  if (!msg.aborted) {
    toasts.show("Context compacted successfully");
  }
}

export function handleAutoRetryStart(msg: Msg<'auto_retry_start'>): void {
  state.isRetrying = true;
  state.retryInfo = {
    attempt: msg.attempt,
    maxAttempts: msg.maxAttempts,
    errorMessage: msg.errorMessage || "",
  };
  getDeps().updateOverlayIndicators();
}

export function handleAutoRetryEnd(msg: Msg<'auto_retry_end'>): void {
  state.isRetrying = false;
  state.retryInfo = undefined;
  getDeps().updateOverlayIndicators();
  if (!msg.success && msg.finalError) {
    addSystemEntry(msg.finalError, "error");
  }
}

export function handleFallbackProviderSwitch(msg: Msg<'fallback_provider_switch'>): void {
  const deps = getDeps();
  const from = msg.from || "unknown";
  const to = msg.to || "unknown";
  const reason = msg.reason || "rate limit";
  toasts.show(`⚠ Model switched: ${from} → ${to} (${reason})`, TOAST_LONG_DURATION_MS);
  const parts = to.split("/");
  if (parts.length >= 2) {
    state.model = {
      id: parts.slice(1).join("/"),
      name: parts.slice(1).join("/"),
      provider: parts[0],
      contextWindow: state.model?.contextWindow,
    };
    deps.updateHeaderUI();
  }
  addSystemEntry(`Provider fallback: ${from} → ${to} (${reason})`, "warning");
}

export function handleFallbackProviderRestored(msg: Msg<'fallback_provider_restored'>): void {
  const deps = getDeps();
  const model = msg.model;
  if (model) {
    toasts.show(`✓ Original provider restored: ${model.provider}/${model.id}`, TOAST_MEDIUM_DURATION_MS);
    state.model = {
      id: model.id,
      name: model.name || model.id,
      provider: model.provider,
      contextWindow: model.contextWindow,
    };
    deps.updateHeaderUI();
  } else {
    toasts.show("✓ Original provider restored", TOAST_MEDIUM_DURATION_MS);
  }
}

export function handleFallbackChainExhausted(msg: Msg<'fallback_chain_exhausted'>): void {
  const lastError = msg.lastError || "All providers failed";
  addSystemEntry(`All fallback providers exhausted: ${lastError}. Check your API keys or try again later.`, "error");
  toasts.show("⚠ All model providers failed", TOAST_LONG_DURATION_MS);
}

export function handleSessionShutdown(): void {
  const deps = getDeps();
  state.isStreaming = false;
  state.isCompacting = false;
  state.processStatus = "stopped";
  flushToolEndQueue();
  const timer = getBatchFinalizeTimer();
  if (timer) { clearTimeout(timer); setBatchFinalizeTimer(null); }
  const batchIds = getActiveBatchToolIds();
  if (batchIds) { renderer.finalizeParallelBatch(getLastMessageUsage()); }
  setActiveBatchToolIds(null);
  setMessageParallelToolIds(null);
  renderer.clearActiveBatch();
  if (state.currentTurn) {
    renderer.finalizeCurrentTurn();
  }
  addSystemEntry("Session ended", "info");
  deps.updateInputUI();
  deps.updateOverlayIndicators();
}

export function handleExtensionError(msg: Msg<'extension_error'>): void {
  const extError = msg.error || "unknown error";
  addSystemEntry(`Command error: ${extError}`, "error");
  announceToScreenReader(`Error: ${extError}`);
}

export function handleSteerPersisted(): void {
  const note = document.querySelector(".gsd-steer-note");
  if (note) {
    note.textContent = "⚡ Override saved — applies to current and future tasks";
    setTimeout(() => note.isConnected && note.remove(), NOTE_AUTO_DISMISS_MS);
  }
}

export function handleExtensionUiRequest(msg: Msg<'extension_ui_request'>): void {
  const deps = getDeps();
  if (msg.method === "notify" && msg.message) {
    const notifyType = msg.notifyType || "info";
    const kind = notifyType === "error" ? "error" : notifyType === "warning" ? "warning" : "info";
    addSystemEntry(msg.message, kind);
  } else if (msg.method === "setStatus" && msg.statusText) {
    // Status text — could update footer
  } else if (msg.method === "setWidget") {
    renderWidget(msg.widgetKey as string, msg.widgetLines, msg.widgetPlacement as string | undefined);
  } else if (msg.method === "set_editor_text" && msg.text) {
    deps.promptInput.value = msg.text;
    deps.autoResize();
  } else if (msg.method === "select" || msg.method === "confirm" || msg.method === "input") {
    uiDialogs.handleRequest(msg as Record<string, unknown>);
  }
}

export function handleBashResult(msg: Msg<'bash_result'>): void {
  const result = msg.result;
  if (result) {
    const output = result.stdout || result.stderr || result.output || JSON.stringify(result);
    const isError = result.exitCode !== 0 || result.error;
    addSystemEntry(typeof output === "string" ? output : JSON.stringify(output, null, 2), isError ? "error" : "info");
  }
}

export function handleError(msg: Msg<'error'>): void {
  removeSteerNotes();
  addSystemEntry(msg.message, "error");
  announceToScreenReader(`Error: ${msg.message}`);
}

export function handleProcessExit(msg: Msg<'process_exit'>): void {
  const deps = getDeps();
  state.isStreaming = false;
  state.isCompacting = false;
  state.isRetrying = false;
  state.processHealth = "responsive";
  state.currentTurn = null;
  removeSteerNotes();
  autoProgress.update(null);
  if (uiDialogs.hasPending()) {
    uiDialogs.expireAllPending("Process exited");
  }
  state.commandsLoaded = false;
  state.commands = [];
  renderer.resetStreamingState();
  resetDerivedSessionTracking();
  deps.updateInputUI();
  deps.updateOverlayIndicators();

  const detail = msg.detail;
  state.lastExitDetail = detail || null;
  state.lastExitCode = typeof msg.code === "number" ? msg.code : null;
  let message: string;
  if (detail) {
    message = detail;
  } else if (msg.code === 0) {
    message = "GSD process exited.";
  } else {
    message = `GSD process exited (code: ${msg.code}).`;
  }
  addSystemEntry(message, msg.code === 0 ? "info" : "error");
}

export function handleProcessHealth(msg: Msg<'process_health'>): void {
  const deps = getDeps();
  state.processHealth = msg.status;
  if (msg.status === "unresponsive") {
    deps.updateOverlayIndicators();
  } else if (msg.status === "recovered") {
    deps.updateOverlayIndicators();
    addSystemEntry("GSD process recovered", "info");
  }
}

export function handleFileAccessResult(msg: Msg<'file_access_result'>): void {
  const denied = msg.results.filter(r => !r.readable);
  if (denied.length > 0) {
    const names = denied.map((r) => {
      const parts = r.path.replace(/\\/g, "/").split("/");
      return parts[parts.length - 1] || r.path;
    });
    toasts.show(`⚠ No read access: ${names.join(", ")}`, TOAST_MEDIUM_DURATION_MS);
  }
}

export function handleTempFileSaved(msg: Msg<'temp_file_saved'>): void {
  fileHandling.addFileAttachments([msg.path], true);
}

export function handleFilesAttached(msg: Msg<'files_attached'>): void {
  if (msg.paths.length > 0) {
    fileHandling.addFileAttachments(msg.paths, true);
  }
}

export function handleUpdateAvailable(msg: Msg<'update_available'>): void {
  showUpdateCard(msg.version, msg.currentVersion, msg.releaseNotes, msg.downloadUrl);
}

export function handleWhatsNew(msg: Msg<'whats_new'>): void {
  showWhatsNew(msg.version, msg.notes);
}

export function handleChangelog(msg: Msg<'changelog'>): void {
  showChangelog(msg.entries);
}

// ============================================================
// Theme
// ============================================================

export function applyTheme(theme: string): void {
  const app = getGsdApp();
  if (app) {
    app.setAttribute("data-theme", theme);
  }
  const dropdown = getSettingsDropdown();
  if (dropdown) {
    dropdown.querySelectorAll(".gsd-settings-option").forEach(el => {
      const isActive = (el as HTMLElement).dataset.theme === theme;
      el.classList.toggle("active", isActive);
      el.setAttribute("aria-checked", String(isActive));
    });
  }
}

// ============================================================
// UI card helpers
// ============================================================

function showUpdateCard(
  version: string,
  currentVersion: string,
  releaseNotes: string,
  downloadUrl: string
): void {
  const deps = getDeps();
  const existing = document.getElementById("gsd-update-card");
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.id = "gsd-update-card";
  card.className = "gsd-update-card";
  card.innerHTML = `
    <div class="gsd-update-card-header">
      <span class="gsd-update-icon">🚀</span>
      <span class="gsd-update-title">Rokket GSD v${escapeHtml(version)} Available</span>
      <span class="gsd-update-current">You have v${escapeHtml(currentVersion)}</span>
    </div>
    <div class="gsd-update-notes">
      ${formatMarkdownNotes(releaseNotes)}
    </div>
    <div class="gsd-update-actions">
      <button class="gsd-update-btn primary" data-action="install">Update Now</button>
      <button class="gsd-update-btn dismiss" data-action="dismiss">Dismiss</button>
    </div>
  `;

  card.querySelector('[data-action="install"]')?.addEventListener("click", () => {
    deps.vscode.postMessage({ type: "update_install", downloadUrl } as WebviewToExtensionMessage);
    card.remove();
  });

  card.querySelector('[data-action="dismiss"]')?.addEventListener("click", () => {
    deps.vscode.postMessage({ type: "update_dismiss", version } as WebviewToExtensionMessage);
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
  });

  deps.messagesContainer.insertBefore(card, deps.messagesContainer.firstChild?.nextSibling || null);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showWhatsNew(version: string, notes: string): void {
  const deps = getDeps();
  const existing = document.getElementById("gsd-whats-new");
  if (existing) existing.remove();

  const card = document.createElement("div");
  card.id = "gsd-whats-new";
  card.className = "gsd-whats-new";
  card.innerHTML = `
    <div class="gsd-whats-new-header">
      <span class="gsd-whats-new-icon">🚀</span>
      <span class="gsd-whats-new-title">What's New in v${escapeHtml(version)}</span>
      <button class="gsd-whats-new-close" title="Dismiss">✕</button>
    </div>
    <div class="gsd-whats-new-notes">
      ${formatMarkdownNotes(notes)}
    </div>
  `;

  card.querySelector(".gsd-whats-new-close")?.addEventListener("click", () => {
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
  });

  deps.messagesContainer.insertBefore(card, deps.messagesContainer.firstChild?.nextSibling || null);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showChangelog(entries: Array<{ version: string; notes: string; date: string }>): void {
  const deps = getDeps();
  dismissChangelog({ silent: true });

  const entriesHtml = entries.length > 0
    ? entries.map((e, i) => `
      <div class="gsd-changelog-entry${i === 0 ? " latest" : ""}">
        <div class="gsd-changelog-entry-header">
          <span class="gsd-changelog-version">v${escapeHtml(e.version)}</span>
          ${i === 0 ? '<span class="gsd-changelog-latest-badge">latest</span>' : ""}
          <span class="gsd-changelog-date">${formatShortDate(e.date)}</span>
        </div>
        <div class="gsd-changelog-entry-notes">${formatMarkdownNotes(e.notes)}</div>
      </div>
    `).join("")
    : '<div class="gsd-changelog-empty">No changelog entries found.</div>';

  const card = document.createElement("div");
  card.id = "gsd-changelog";
  card.className = "gsd-changelog";
  card.setAttribute("tabindex", "-1");
  card.innerHTML = `
    <div class="gsd-changelog-header">
      <span class="gsd-changelog-title">📋 Changelog</span>
      <button class="gsd-changelog-close" aria-label="Close changelog" title="Close">✕</button>
    </div>
    <div class="gsd-changelog-entries">
      ${entriesHtml}
    </div>
  `;

  const trapHandler = createFocusTrap(card);
  card.addEventListener("keydown", trapHandler);

  const navHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      card.removeEventListener("keydown", trapHandler);
      card.removeEventListener("keydown", navHandler);
      setChangelogHandlers(null, null);
      card.classList.add("dismissing");
      setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
      restoreFocus(getChangelogTriggerEl());
    }
  };
  card.addEventListener("keydown", navHandler);

  setChangelogHandlers(trapHandler, navHandler);

  const closeBtn = card.querySelector<HTMLElement>(".gsd-changelog-close");
  closeBtn?.addEventListener("click", () => {
    card.removeEventListener("keydown", trapHandler);
    card.removeEventListener("keydown", navHandler);
    setChangelogHandlers(null, null);
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), CSS_ANIMATION_SETTLE_MS);
    restoreFocus(getChangelogTriggerEl());
  });

  deps.messagesContainer.appendChild(card);
  scrollToBottom(deps.messagesContainer, true);

  if (closeBtn) {
    closeBtn.focus();
  } else {
    card.focus();
  }
}

// ============================================================
// Widget rendering
// ============================================================

const widgetElements = new Map<string, HTMLElement>();

export function renderWidget(key: string, lines: string[] | undefined, _placement?: string): void {
  const container = getWidgetContainer();
  if (!container) return;

  if (!lines || lines.length === 0) {
    state.widgetData.delete(key);
    const existing = widgetElements.get(key);
    if (existing) {
      existing.remove();
      widgetElements.delete(key);
    }
    return;
  }

  state.widgetData.set(key, lines);

  let el = widgetElements.get(key);
  if (!el) {
    el = document.createElement("div");
    el.className = "gsd-widget";
    el.dataset.widgetKey = key;
    container.appendChild(el);
    widgetElements.set(key, el);
  }

  const text = lines.join("\n").trim();
  if (key === "gsd-health" && text.includes("│")) {
    const parts = text.split("│").map(p => p.trim()).filter(Boolean);
    const spans = parts.map(part => {
      let cls = "gsd-widget-segment";
      if (/^[✗✘]/.test(part) || /error/i.test(part)) cls += " error";
      else if (/^⚠/.test(part) || /warning/i.test(part)) cls += " warning";
      else if (/^●/.test(part) && /OK/i.test(part)) cls += " ok";
      return `<span class="${cls}">${escapeHtml(part)}</span>`;
    });
    el.innerHTML = spans.join('<span class="gsd-widget-sep">│</span>');
  } else {
    el.textContent = text;
  }
}
