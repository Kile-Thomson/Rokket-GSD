import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "../../shared/types";
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

export function handleAutoCompactionEnd(msg: ExtensionToWebviewMessage): void {
  state.isCompacting = false;
  const deps = getDeps();
  deps.updateOverlayIndicators();
  deps.updateInputUI();
  if (!(msg as any).aborted) {
    toasts.show("Context compacted successfully");
  }
}

export function handleAutoRetryStart(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  state.isRetrying = true;
  state.retryInfo = {
    attempt: data.attempt,
    maxAttempts: data.maxAttempts,
    errorMessage: data.errorMessage || "",
  };
  getDeps().updateOverlayIndicators();
}

export function handleAutoRetryEnd(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  state.isRetrying = false;
  state.retryInfo = undefined;
  getDeps().updateOverlayIndicators();
  if (!data.success && data.finalError) {
    addSystemEntry(data.finalError, "error");
  }
}

export function handleFallbackProviderSwitch(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  const from = data.from || "unknown";
  const to = data.to || "unknown";
  const reason = data.reason || "rate limit";
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

export function handleFallbackProviderRestored(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  const model = data.model;
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

export function handleFallbackChainExhausted(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  const lastError = data.lastError || "All providers failed";
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

export function handleExtensionError(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  const extError = data.error as string || "unknown error";
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

export function handleExtensionUiRequest(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  if (data.method === "notify" && data.message) {
    const notifyType = data.notifyType as string || "info";
    const kind = notifyType === "error" ? "error" : notifyType === "warning" ? "warning" : "info";
    addSystemEntry(data.message as string, kind);
  } else if (data.method === "setStatus" && data.statusText) {
    // Status text — could update footer
  } else if (data.method === "setWidget") {
    renderWidget(data.widgetKey as string, data.widgetLines as string[] | undefined, data.widgetPlacement as string | undefined);
  } else if (data.method === "set_editor_text" && data.text) {
    deps.promptInput.value = data.text;
    deps.autoResize();
  } else if (data.method === "select" || data.method === "confirm" || data.method === "input") {
    uiDialogs.handleRequest(data);
  }
}

export function handleBashResult(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  const result = data.result;
  if (result) {
    const output = result.stdout || result.stderr || result.output || JSON.stringify(result);
    const isError = result.exitCode !== 0 || result.error;
    addSystemEntry(typeof output === "string" ? output : JSON.stringify(output, null, 2), isError ? "error" : "info");
  }
}

export function handleError(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  removeSteerNotes();
  addSystemEntry(data.message, "error");
  announceToScreenReader(`Error: ${data.message}`);
}

export function handleProcessExit(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
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

  const detail = data.detail as string | undefined;
  state.lastExitDetail = detail || null;
  state.lastExitCode = typeof data.code === "number" ? data.code : null;
  let message: string;
  if (detail) {
    message = detail;
  } else if (data.code === 0) {
    message = "GSD process exited.";
  } else {
    message = `GSD process exited (code: ${data.code}).`;
  }
  addSystemEntry(message, data.code === 0 ? "info" : "error");
}

export function handleProcessHealth(msg: ExtensionToWebviewMessage): void {
  const deps = getDeps();
  const data = msg as any;
  state.processHealth = data.status;
  if (data.status === "unresponsive") {
    deps.updateOverlayIndicators();
  } else if (data.status === "recovered") {
    deps.updateOverlayIndicators();
    addSystemEntry("GSD process recovered", "info");
  }
}

export function handleFileAccessResult(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  const denied = data.results.filter((r: { path: string; readable: boolean }) => !r.readable);
  if (denied.length > 0) {
    const names = denied.map((r: { path: string }) => {
      const parts = r.path.replace(/\\/g, "/").split("/");
      return parts[parts.length - 1] || r.path;
    });
    toasts.show(`⚠ No read access: ${names.join(", ")}`, TOAST_MEDIUM_DURATION_MS);
  }
}

export function handleTempFileSaved(msg: ExtensionToWebviewMessage): void {
  fileHandling.addFileAttachments([(msg as any).path], true);
}

export function handleFilesAttached(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  if (data.paths.length > 0) {
    fileHandling.addFileAttachments(data.paths, true);
  }
}

export function handleUpdateAvailable(msg: ExtensionToWebviewMessage): void {
  const data = msg as any;
  showUpdateCard(data.version, data.currentVersion, data.releaseNotes, data.downloadUrl);
}

export function handleWhatsNew(msg: ExtensionToWebviewMessage): void {
  showWhatsNew((msg as any).version, (msg as any).notes);
}

export function handleChangelog(msg: ExtensionToWebviewMessage): void {
  showChangelog((msg as any).entries);
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
