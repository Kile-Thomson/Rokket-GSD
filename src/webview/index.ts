// ============================================================
// GSD Webview — Full-featured Chat UI
// Vanilla DOM for minimal bundle size. Uses marked for markdown.
// ============================================================

import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  GsdState,
  ProcessStatus,
} from "../shared/types";
import "./styles.css";

import {
  state,
  nextId,
  type ChatEntry,
  type ToolCallState,
} from "./state";

import {
  escapeHtml,
  formatCost,
  formatTokens,
  formatContextUsage,
  scrollToBottom,
  sanitizeUrl,
} from "./helpers";

import * as slashMenu from "./slash-menu";
import * as modelPicker from "./model-picker";
import * as sessionHistory from "./session-history";
import * as uiDialogs from "./ui-dialogs";
import * as renderer from "./renderer";

// VS Code API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ============================================================
// DOM Setup
// ============================================================

const root = document.getElementById("root")!;
root.innerHTML = `
  <div class="gsd-app">
    <header class="gsd-header">
      <div class="gsd-header-brand">
        <span class="gsd-logo">🚀</span>
        <span class="gsd-title">Rokket GSD</span>
      </div>
      <div class="gsd-header-info">
        <span class="gsd-model-badge" id="modelBadge" title="Model"></span>
        <span class="gsd-thinking-badge" id="thinkingBadge" title="Thinking level"></span>
        <span class="gsd-cost-badge" id="costBadge" title="Session cost"></span>
        <span class="gsd-context-badge" id="contextBadge" title="Context usage"></span>
      </div>
      <div class="gsd-header-actions">
        <button class="gsd-action-btn" id="compactBtn" title="Compact context — reduce token usage">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H8L7 3v3h1V3h6v5h-4l-1 1v2H8v1h2l3-3h1l1-1V3l-1-1zM9 7H3L2 8v5l1 1h6l1-1V8L9 7zm0 6H3V8h6v5z"/></svg>
          <span>Compact</span>
        </button>
        <button class="gsd-action-btn" id="exportBtn" title="Export conversation as HTML">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13 1H5L4 2v3h1V2h8v12H5v-3H4v3l1 1h8l1-1V2l-1-1zM1 8l3-3v2h5v2H4v2L1 8z"/></svg>
          <span>Export</span>
        </button>
        <button class="gsd-action-btn" id="historyBtn" title="Browse previous sessions">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.507 12.324a7 7 0 0 0 .065-8.56A7 7 0 0 0 2 4.393V2H1v3.5l.5.5H5V5H2.811a6.008 6.008 0 1 1-.135 5.77l-.887.462a7 7 0 0 0 11.718 1.092zM8 4h1v4.495L11.255 10l-.51.858L7.5 9.166V4H8z"/></svg>
          <span>History</span>
        </button>
        <button class="gsd-action-btn" id="modelPickerBtn" title="Change AI model">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm0-9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM4.5 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm7 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/></svg>
          <span>Model</span>
        </button>
        <button class="gsd-action-btn primary" id="newConvoBtn" title="Start a new conversation">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.5.5 0 01.5.5V7H14a.5.5 0 010 1H8.5v5.5a.5.5 0 01-1 0V8H2a.5.5 0 010-1h5.5V1.5A.5.5 0 018 1z"/></svg>
          <span>New</span>
        </button>
      </div>
    </header>

    <div class="gsd-overlay-indicators" id="overlayIndicators"></div>

    <main class="gsd-messages" id="messagesContainer">
      <div class="gsd-welcome" id="welcomeScreen">
        <div class="gsd-welcome-logo">
          <pre class="gsd-welcome-ascii">
 ██████╗ ███████╗██████╗
██╔════╝ ██╔════╝██╔══██╗
██║  ███╗███████╗██║  ██║
██║   ██║╚════██║██║  ██║
╚██████╔╝███████║██████╔╝
 ╚═════╝ ╚══════╝╚═════╝</pre>
        </div>
        <div class="gsd-welcome-title">Get Shit Done <span class="gsd-welcome-version" id="welcomeVersion"></span></div>
        <div class="gsd-welcome-sub" id="welcomeProcess">Initializing...</div>
        <div class="gsd-welcome-model" id="welcomeModel"></div>
        <div class="gsd-welcome-hints" id="welcomeHints"></div>
        <div class="gsd-welcome-attribution">
          <span class="gsd-rokketek-mark">▲ ROKKETEK</span>
        </div>
      </div>
    </main>

    <div class="gsd-slash-menu" id="slashMenu"></div>
    <div class="gsd-model-picker" id="modelPicker"></div>
    <div class="gsd-session-history" id="sessionHistory"></div>

    <div class="gsd-input-area">
      <div class="gsd-image-preview" id="imagePreview"></div>
      <div class="gsd-input-row">
        <div class="gsd-input-wrapper">
          <textarea id="promptInput" class="gsd-input" placeholder="Message GSD..." rows="1"></textarea>
        </div>
        <button class="gsd-send-btn" id="sendBtn" title="Send">
          <span id="sendIcon">↑</span>
        </button>
      </div>
      <div class="gsd-input-hint" id="inputHint"></div>
    </div>

    <footer class="gsd-footer" id="footer">
      <div class="gsd-footer-line" id="footerLine1">
        <span class="gsd-footer-cwd" id="footerCwd" title="Working directory"></span>
        <span class="gsd-footer-brand">▲ ROKKETEK</span>
      </div>
      <div class="gsd-footer-line" id="footerLine2">
        <span class="gsd-footer-stats" id="footerStats"></span>
        <span class="gsd-footer-right" id="footerRight"></span>
      </div>
    </footer>
  </div>
`;

// Element refs
const messagesContainer = document.getElementById("messagesContainer")!;
const welcomeScreen = document.getElementById("welcomeScreen")!;
const welcomeProcess = document.getElementById("welcomeProcess")!;
const welcomeVersion = document.getElementById("welcomeVersion")!;
const welcomeModel = document.getElementById("welcomeModel")!;
const welcomeHints = document.getElementById("welcomeHints")!;
const promptInput = document.getElementById("promptInput") as HTMLTextAreaElement;
const sendBtn = document.getElementById("sendBtn")!;
const sendIcon = document.getElementById("sendIcon")!;
const newConvoBtn = document.getElementById("newConvoBtn")!;
const historyBtn = document.getElementById("historyBtn")!;
const modelPickerBtn = document.getElementById("modelPickerBtn")!;
const compactBtn = document.getElementById("compactBtn")!;
const exportBtn = document.getElementById("exportBtn")!;
const imagePreview = document.getElementById("imagePreview")!;
const inputHint = document.getElementById("inputHint")!;
const slashMenuEl = document.getElementById("slashMenu")!;
const modelPickerEl = document.getElementById("modelPicker")!;
const sessionHistoryEl = document.getElementById("sessionHistory")!;
const overlayIndicators = document.getElementById("overlayIndicators")!;

// Header badges
const modelBadge = document.getElementById("modelBadge")!;
const thinkingBadge = document.getElementById("thinkingBadge")!;
const costBadge = document.getElementById("costBadge")!;
const contextBadge = document.getElementById("contextBadge")!;

// Footer
const footerCwd = document.getElementById("footerCwd")!;
const footerStats = document.getElementById("footerStats")!;
const footerRight = document.getElementById("footerRight")!;

// ============================================================
// Auto-resize textarea
// ============================================================

function autoResize(): void {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + "px";
}
promptInput.addEventListener("input", autoResize);

// ============================================================
// Image paste & drop
// ============================================================

function handleFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      state.images.push({ type: "image", data: base64, mimeType: file.type });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  }
}

document.addEventListener("paste", (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  let hasImage = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      hasImage = true;
      const file = items[i].getAsFile();
      if (file) handleFiles([file]);
    }
  }
  if (hasImage) e.preventDefault();
});

const inputArea = root.querySelector(".gsd-input-area")!;
inputArea.addEventListener("dragover", (e: Event) => {
  e.preventDefault();
  (e as DragEvent).dataTransfer!.dropEffect = "copy";
  inputArea.classList.add("drag-over");
});
inputArea.addEventListener("dragleave", () => inputArea.classList.remove("drag-over"));
inputArea.addEventListener("drop", (e: Event) => {
  e.preventDefault();
  inputArea.classList.remove("drag-over");
  const dt = (e as DragEvent).dataTransfer;
  if (dt?.files.length) handleFiles(dt.files);
});

function renderImagePreviews(): void {
  if (state.images.length === 0) {
    imagePreview.style.display = "none";
    imagePreview.innerHTML = "";
    return;
  }
  imagePreview.style.display = "flex";
  imagePreview.innerHTML = state.images.map((img, i) => `
    <div class="gsd-image-thumb">
      <img src="data:${img.mimeType};base64,${img.data}" alt="Attached" />
      <button class="gsd-image-remove" data-idx="${i}">×</button>
    </div>
  `).join("");

  imagePreview.querySelectorAll(".gsd-image-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx!);
      state.images.splice(idx, 1);
      renderImagePreviews();
    });
  });
}

// ============================================================
// Slash command menu — input listener
// ============================================================

promptInput.addEventListener("input", () => {
  const val = promptInput.value;
  if (val.startsWith("/") && !val.includes("\n")) {
    const filter = val.slice(1).trim();
    slashMenu.show(filter);
  } else {
    slashMenu.hide();
  }
});



// ============================================================
// Send message
// ============================================================

function sendMessage(): void {
  slashMenu.hide();
  modelPicker.hide();
  const text = promptInput.value.trim();
  if (!text && state.images.length === 0) return;

  // Handle ! bash shortcut
  if (text.startsWith("!") && !text.startsWith("!!") && text.length > 1 && !state.isStreaming) {
    const bashCmd = text.slice(1).trim();
    state.entries.push({
      id: nextId(),
      type: "user",
      text: `! ${bashCmd}`,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer);

    vscode.postMessage({ type: "run_bash", command: bashCmd });
    promptInput.value = "";
    autoResize();
    return;
  }

  // If streaming — steer
  if (state.isStreaming) {
    state.entries.push({
      id: nextId(),
      type: "user",
      text,
      images: state.images.length > 0 ? [...state.images] : undefined,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer);

    vscode.postMessage({
      type: "steer",
      message: text,
      images: state.images.length > 0 ? [...state.images] : undefined,
    } as WebviewToExtensionMessage);

    promptInput.value = "";
    state.images = [];
    renderImagePreviews();
    autoResize();
    return;
  }

  // Normal send
  if (text || state.images.length > 0) {
    state.entries.push({
      id: nextId(),
      type: "user",
      text,
      images: state.images.length > 0 ? [...state.images] : undefined,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer);
  }

  const msg: WebviewToExtensionMessage = {
    type: "prompt",
    message: text,
    images: state.images.length > 0 ? [...state.images] : undefined,
  };
  vscode.postMessage(msg);

  promptInput.value = "";
  state.images = [];
  renderImagePreviews();
  autoResize();
}

// ============================================================
// Keyboard handling
// ============================================================

promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (sessionHistory.isVisible()) {
    if (sessionHistory.handleKeyDown(e)) return;
  }
  if (slashMenu.isVisible()) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashMenu.navigateDown();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      slashMenu.navigateUp();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      slashMenu.selectCurrent();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      slashMenu.hide();
      return;
    }
  }

  if (state.useCtrlEnterToSend) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  } else {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
  if (e.key === "Escape" && state.isStreaming) {
    vscode.postMessage({ type: "interrupt" });
  }
});

// Global keyboard handler for overlay panels
document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (sessionHistory.isVisible()) {
    if (sessionHistory.handleKeyDown(e)) return;
  }
  if (e.key === "Escape") {
    if (modelPicker.isVisible()) {
      modelPicker.hide();
      return;
    }
  }
});

sendBtn.addEventListener("click", () => {
  if (state.isStreaming) {
    vscode.postMessage({ type: "interrupt" });
  } else {
    sendMessage();
  }
});

function handleNewConversation(): void {
  vscode.postMessage({ type: "new_conversation" });
  state.entries = [];
  state.currentTurn = null;
  renderer.resetStreamingState();
  state.sessionStats = {};
  renderer.clearMessages();
  welcomeScreen.style.display = "flex";
  sessionHistory.hide();
  modelPicker.hide();
  updateAllUI();
}

newConvoBtn.addEventListener("click", handleNewConversation);

compactBtn.addEventListener("click", () => {
  if (!state.isStreaming) {
    vscode.postMessage({ type: "compact_context" });
  }
});

exportBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "export_html" });
});

thinkingBadge.addEventListener("click", () => {
  vscode.postMessage({ type: "cycle_thinking_level" });
});
thinkingBadge.style.cursor = "pointer";

// ============================================================
// Global click handlers (copy, file links, url links, tool toggles)
// ============================================================

document.addEventListener("click", (e: Event) => {
  const target = e.target as HTMLElement;

  const copyBtn = target.closest(".gsd-copy-btn") as HTMLElement | null;
  if (copyBtn) {
    const codeBlock = copyBtn.closest(".gsd-code-block");
    const code = codeBlock?.querySelector("code")?.textContent || "";
    vscode.postMessage({ type: "copy_text", text: code });
    copyBtn.textContent = "✓ Copied";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    return;
  }

  if (target.classList.contains("gsd-file-link")) {
    const path = target.dataset.path;
    if (path) vscode.postMessage({ type: "open_file", path });
    return;
  }

  if (target.tagName === "A" && target.getAttribute("href")) {
    e.preventDefault();
    const href = target.getAttribute("href")!;
    const safeUrl = sanitizeUrl(href);
    if (safeUrl) {
      vscode.postMessage({ type: "open_url", url: safeUrl });
    }
    return;
  }

  const toolHeader = target.closest(".gsd-tool-header") as HTMLElement | null;
  if (toolHeader) {
    const block = toolHeader.closest(".gsd-tool-block") as HTMLElement | null;
    if (block) {
      block.classList.toggle("collapsed");
    }
    return;
  }

  if (target.closest("#restartBtn")) {
    vscode.postMessage({ type: "launch_gsd" });
    return;
  }
});

document.addEventListener("copy", (e: ClipboardEvent) => {
  const selection = window.getSelection()?.toString();
  if (selection) vscode.postMessage({ type: "copy_text", text: selection });
});



// ============================================================
// UI Updates
// ============================================================

function updateAllUI(): void {
  updateHeaderUI();
  updateFooterUI();
  updateInputUI();
  updateOverlayIndicators();
  updateWelcomeScreen();
}

function updateHeaderUI(): void {
  if (state.model) {
    modelBadge.textContent = state.model.name || state.model.id;
    modelBadge.title = `${state.model.provider} / ${state.model.id}`;
    modelBadge.style.display = "inline-flex";
  } else {
    modelBadge.style.display = "none";
  }

  const thinkingLabel = state.thinkingLevel && state.thinkingLevel !== "off" ? state.thinkingLevel : "off";
  thinkingBadge.textContent = `🧠 ${thinkingLabel}`;
  thinkingBadge.title = "Click to cycle thinking level";
  thinkingBadge.style.display = "inline-flex";

  const stats = state.sessionStats;
  const hasCost = stats.cost != null && stats.cost > 0;
  if (hasCost) {
    costBadge.textContent = formatCost(stats.cost);
    costBadge.style.display = "inline-flex";
  } else {
    costBadge.style.display = "none";
  }

  const ctx = formatContextUsage(stats, state.model);
  if (ctx) {
    contextBadge.textContent = `◐ ${ctx}`;
    contextBadge.style.display = "inline-flex";
    const pct = stats.contextPercent ?? 0;
    contextBadge.classList.remove("warn", "crit");
    if (pct > 90) contextBadge.classList.add("crit");
    else if (pct > 70) contextBadge.classList.add("warn");
  } else {
    contextBadge.style.display = "none";
  }
}

function updateFooterUI(): void {
  footerCwd.textContent = state.cwd || "";
  footerCwd.title = state.cwd;

  const stats = state.sessionStats;
  const tokens = stats.tokens;
  const parts: string[] = [];

  if (tokens) {
    if (tokens.input) parts.push(`↑${formatTokens(tokens.input)}`);
    if (tokens.output) parts.push(`↓${formatTokens(tokens.output)}`);
    if (tokens.cacheRead) parts.push(`R${formatTokens(tokens.cacheRead)}`);
    if (tokens.cacheWrite) parts.push(`W${formatTokens(tokens.cacheWrite)}`);
  }

  parts.push(formatCost(stats.cost));

  const ctx = formatContextUsage(stats, state.model);
  if (ctx) parts.push(ctx);

  footerStats.textContent = parts.join(" ");

  let right = "";
  if (state.model) {
    right = state.model.id || state.model.name || "";
    if (state.thinkingLevel && state.thinkingLevel !== "off") {
      right += ` • ${state.thinkingLevel}`;
    } else {
      right += " • thinking off";
    }
  }
  footerRight.textContent = right;
}

function updateInputUI(): void {
  if (state.isStreaming) {
    sendIcon.textContent = "■";
    sendBtn.classList.add("gsd-stop-btn");
    sendBtn.title = "Stop (Esc)";
    promptInput.placeholder = "Interrupt or steer GSD...";
  } else {
    sendIcon.textContent = "↑";
    sendBtn.classList.remove("gsd-stop-btn");
    sendBtn.title = "Send";
    promptInput.placeholder = "Message GSD...";
  }

  const sendKey = state.useCtrlEnterToSend ? "Ctrl+Enter" : "Enter";
  if (state.isStreaming) {
    inputHint.textContent = `${sendKey} to steer • Esc to stop`;
  } else {
    inputHint.textContent = `${sendKey} to send • !cmd for bash • / for commands`;
  }
}

function updateOverlayIndicators(): void {
  const parts: string[] = [];

  if (state.isCompacting) {
    parts.push(`<div class="gsd-overlay-indicator compacting">
      <span class="gsd-overlay-spinner"></span>Compacting context…
    </div>`);
  }

  if (state.isRetrying && state.retryInfo) {
    parts.push(`<div class="gsd-overlay-indicator retrying">
      <span class="gsd-overlay-spinner"></span>Retrying (${state.retryInfo.attempt}/${state.retryInfo.maxAttempts})…
      <span class="gsd-overlay-detail">${escapeHtml(state.retryInfo.errorMessage)}</span>
    </div>`);
  }

  if (state.processStatus === "starting") {
    parts.push(`<div class="gsd-overlay-indicator starting">
      <span class="gsd-overlay-spinner"></span>Starting GSD…
    </div>`);
  }

  if (state.processStatus === "restarting") {
    parts.push(`<div class="gsd-overlay-indicator restarting">
      <span class="gsd-overlay-spinner"></span>Restarting GSD…
    </div>`);
  }

  if (state.processStatus === "crashed") {
    parts.push(`<div class="gsd-overlay-indicator crashed">
      ⚠ GSD process crashed
      <button id="restartBtn" class="gsd-overlay-btn">Restart</button>
    </div>`);
  }

  overlayIndicators.innerHTML = parts.join("");
  overlayIndicators.style.display = parts.length > 0 ? "flex" : "none";
}

function updateWelcomeScreen(): void {
  if (state.entries.length > 0 || state.currentTurn) {
    welcomeScreen.style.display = "none";
    return;
  }
  welcomeScreen.style.display = "flex";

  welcomeVersion.textContent = state.version ? `v${state.version}` : "";

  switch (state.processStatus) {
    case "starting":
      welcomeProcess.textContent = "Starting GSD…";
      break;
    case "running":
      welcomeProcess.textContent = "Type a message to start";
      break;
    case "crashed":
      welcomeProcess.textContent = "GSD process crashed — click Restart or send a message";
      break;
    case "restarting":
      welcomeProcess.textContent = "Restarting…";
      break;
    default:
      welcomeProcess.textContent = "Initializing…";
  }

  if (state.model && state.processStatus === "running") {
    let modelStr = state.model.id || state.model.name || "";
    if (state.model.provider) modelStr = `${state.model.provider}/${modelStr}`;
    if (state.thinkingLevel && state.thinkingLevel !== "off") {
      modelStr += ` • 🧠 ${state.thinkingLevel}`;
    }
    welcomeModel.textContent = modelStr;
    welcomeModel.style.display = "block";
  } else {
    welcomeModel.style.display = "none";
  }

  if (state.processStatus === "running") {
    const sendKey = state.useCtrlEnterToSend ? "Ctrl+Enter" : "Enter";
    welcomeHints.innerHTML = [
      `<span>${sendKey} to send</span>`,
      `<span>Shift+Enter for newline</span>`,
      `<span>Esc to interrupt</span>`,
      `<span>/ for commands</span>`,
    ].join('<span class="gsd-hint-sep">•</span>');
    welcomeHints.style.display = "flex";
  } else {
    welcomeHints.style.display = "none";
  }
}



// ============================================================
// Handle messages FROM extension
// ============================================================

window.addEventListener("message", (event) => {
  const raw = event.data as Record<string, unknown>;
  if (!raw || !raw.type) return;
  const msg = raw as ExtensionToWebviewMessage;

  switch (msg.type) {
    case "config": {
      const data = msg;
      state.useCtrlEnterToSend = data.useCtrlEnterToSend ?? false;
      if (data.cwd) state.cwd = data.cwd;
      if (data.version) state.version = data.version;
      updateAllUI();
      break;
    }

    case "state": {
      const data = msg.data;
      if (data) {
        state.model = data.model || null;
        state.thinkingLevel = data.thinkingLevel || "off";
        state.isStreaming = data.isStreaming || false;
        state.isCompacting = data.isCompacting || false;
        if (data.cwd) state.cwd = data.cwd;
        if (data.autoCompactionEnabled != null) {
          state.sessionStats.autoCompactionEnabled = data.autoCompactionEnabled;
        }
        if (data.model?.contextWindow) {
          state.sessionStats.contextWindow = data.model.contextWindow;
        }
        if (data.sessionId) {
          sessionHistory.setCurrentSessionId(data.sessionId);
        }
        if (state.processStatus !== "crashed") state.processStatus = "running";
        updateAllUI();
      }
      break;
    }

    case "session_stats": {
      const data = msg.data;
      if (data) {
        state.sessionStats = {
          ...state.sessionStats,
          ...data,
        };
        updateHeaderUI();
        updateFooterUI();
      }
      break;
    }

    case "process_status": {
      const data = msg;
      state.processStatus = data.status as ProcessStatus;
      updateOverlayIndicators();
      updateWelcomeScreen();
      break;
    }

    case "agent_start": {
      state.isStreaming = true;
      state.currentTurn = {
        id: nextId(),
        segments: [],
        toolCalls: new Map(),
        isComplete: false,
        timestamp: Date.now(),
      };
      renderer.resetStreamingState();
      updateInputUI();
      renderer.ensureCurrentTurnElement();
      break;
    }

    case "agent_end": {
      state.isStreaming = false;
      renderer.finalizeCurrentTurn();
      updateInputUI();
      updateOverlayIndicators();
      vscode.postMessage({ type: "get_session_stats" });
      break;
    }

    case "turn_start": {
      if (!state.currentTurn) {
        state.currentTurn = {
          id: nextId(),
          segments: [],
          toolCalls: new Map(),
          isComplete: false,
          timestamp: Date.now(),
        };
        renderer.resetStreamingState();
      }
      break;
    }

    case "turn_end": {
      break;
    }

    case "message_start": {
      break;
    }

    case "message_update": {
      if (!state.currentTurn) break;
      const data = msg;
      const delta = data.assistantMessageEvent || data.delta;

      if (delta) {
        if (delta.type === "text_delta" && delta.delta) {
          renderer.appendToTextSegment("text", delta.delta);
        } else if (delta.type === "thinking_delta" && delta.delta) {
          renderer.appendToTextSegment("thinking", delta.delta);
        }
      }
      break;
    }

    case "message_end": {
      const endData = msg;
      const endMsg = endData.message;
      if (endMsg?.role === "assistant" && endMsg.usage) {
        const u = endMsg.usage;
        if (!state.sessionStats.tokens) {
          state.sessionStats.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        }
        const t = state.sessionStats.tokens;
        t.input += u.input || 0;
        t.output += u.output || 0;
        t.cacheRead += u.cacheRead || 0;
        t.cacheWrite += u.cacheWrite || 0;
        t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
        if (u.cost?.total) {
          state.sessionStats.cost = (state.sessionStats.cost || 0) + u.cost.total;
        }
        const contextTokens = (u.input || 0) + (u.cacheRead || 0);
        const contextWindow = state.model?.contextWindow || state.sessionStats.contextWindow || 0;
        if (contextWindow > 0 && contextTokens > 0) {
          state.sessionStats.contextTokens = contextTokens;
          state.sessionStats.contextWindow = contextWindow;
          state.sessionStats.contextPercent = (contextTokens / contextWindow) * 100;
        }
        updateHeaderUI();
        updateFooterUI();
      }
      break;
    }

    case "tool_execution_start": {
      if (!state.currentTurn) break;
      const data = msg;
      const tc: ToolCallState = {
        id: data.toolCallId,
        name: data.toolName,
        args: data.args || {},
        resultText: "",
        isError: false,
        isRunning: true,
        startTime: Date.now(),
      };
      state.currentTurn.toolCalls.set(data.toolCallId, tc);
      const segIdx = state.currentTurn.segments.length;
      state.currentTurn.segments.push({ type: "tool", toolCallId: data.toolCallId });
      renderer.appendToolSegmentElement(tc, segIdx);
      scrollToBottom(messagesContainer);
      break;
    }

    case "tool_execution_update": {
      if (!state.currentTurn) break;
      const data = msg;
      const tc = state.currentTurn.toolCalls.get(data.toolCallId);
      if (tc && data.partialResult) {
        const text = data.partialResult.content
          ?.map((c: any) => c.text || "")
          .filter(Boolean)
          .join("\n");
        if (text) tc.resultText = text;
        renderer.updateToolSegmentElement(data.toolCallId);
        scrollToBottom(messagesContainer);
      }
      break;
    }

    case "tool_execution_end": {
      if (!state.currentTurn) break;
      const data = msg;
      const tc = state.currentTurn.toolCalls.get(data.toolCallId);
      if (tc) {
        tc.isRunning = false;
        tc.isError = data.isError;
        tc.endTime = Date.now();
        if (data.durationMs) {
          tc.endTime = tc.startTime + data.durationMs;
        }
        if (data.result) {
          const text = data.result.content
            ?.map((c: any) => c.text || "")
            .filter(Boolean)
            .join("\n");
          if (text) tc.resultText = text;
        }
      }
      renderer.updateToolSegmentElement(data.toolCallId);
      scrollToBottom(messagesContainer);
      break;
    }

    case "auto_compaction_start": {
      state.isCompacting = true;
      updateOverlayIndicators();
      break;
    }

    case "auto_compaction_end": {
      state.isCompacting = false;
      updateOverlayIndicators();
      break;
    }

    case "auto_retry_start": {
      const data = msg;
      state.isRetrying = true;
      state.retryInfo = {
        attempt: data.attempt,
        maxAttempts: data.maxAttempts,
        errorMessage: data.errorMessage || "",
      };
      updateOverlayIndicators();
      break;
    }

    case "auto_retry_end": {
      const data = msg;
      state.isRetrying = false;
      state.retryInfo = undefined;
      updateOverlayIndicators();
      if (!data.success && data.finalError) {
        addSystemEntry(data.finalError, "error");
      }
      break;
    }

    case "extension_ui_request": {
      const data = msg;
      if (data.method === "setStatus" && data.statusText) {
        // Status text — could update footer
      } else if (data.method === "set_editor_text" && data.text) {
        promptInput.value = data.text;
        autoResize();
      } else if (data.method === "select" || data.method === "confirm" || data.method === "input") {
        uiDialogs.handleRequest(data);
      }
      break;
    }

    case "commands": {
      const data = msg;
      state.commands = data.commands || [];
      state.commandsLoaded = true;
      if (slashMenu.isVisible()) {
        const filter = promptInput.value.slice(1).trim();
        slashMenu.show(filter);
      }
      break;
    }

    case "available_models": {
      const data = msg;
      state.availableModels = (data.models || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider,
        reasoning: m.reasoning || false,
        contextWindow: m.contextWindow,
      }));
      state.modelsLoaded = true;
      if (modelPicker.isVisible()) {
        modelPicker.render();
      }
      break;
    }

    case "thinking_level_changed": {
      const data = msg;
      state.thinkingLevel = data.level || "off";
      updateHeaderUI();
      updateFooterUI();
      addSystemEntry(`Thinking level: ${state.thinkingLevel}`, "info");
      break;
    }

    case "bash_result": {
      const data = msg;
      const result = data.result;
      if (result) {
        const output = result.stdout || result.stderr || result.output || JSON.stringify(result);
        const isError = result.exitCode !== 0 || result.error;
        addSystemEntry(typeof output === "string" ? output : JSON.stringify(output, null, 2), isError ? "error" : "info");
      }
      break;
    }

    case "error": {
      const data = msg;
      addSystemEntry(data.message, "error");
      break;
    }

    case "process_exit": {
      const data = msg;
      state.isStreaming = false;
      state.isCompacting = false;
      state.isRetrying = false;
      state.currentTurn = null;
      renderer.resetStreamingState();
      updateInputUI();
      updateOverlayIndicators();

      const message = data.code === 0
        ? "GSD process exited. Send a message to restart."
        : `GSD process exited (code: ${data.code}). Send a message to restart.`;
      addSystemEntry(message, data.code === 0 ? "info" : "warning");
      break;
    }

    case "session_list": {
      const data = msg;
      sessionHistory.updateSessions(data.sessions || []);
      break;
    }

    case "session_list_error": {
      const data = msg;
      sessionHistory.showError(data.message);
      break;
    }

    case "session_switched": {
      const data = msg;

      // Clear current state
      state.entries = [];
      state.currentTurn = null;
      renderer.resetStreamingState();
      renderer.clearMessages();
      state.sessionStats = {};

      // Apply the new state
      if (data.state) {
        state.model = data.state.model || null;
        state.thinkingLevel = data.state.thinkingLevel || "off";
        state.isStreaming = data.state.isStreaming || false;
        state.isCompacting = data.state.isCompacting || false;
        if (state.processStatus !== "crashed") state.processStatus = "running";
      }

      // Render historical messages
      if (data.messages && data.messages.length > 0) {
        renderHistoricalMessages(data.messages);
      }

      // Update session ID for the history panel
      if (data.state?.sessionId) {
        sessionHistory.setCurrentSessionId(data.state.sessionId as string);
      }

      // Hide history panel
      sessionHistory.hide();

      // Update all UI
      updateAllUI();
      scrollToBottom(messagesContainer);
      break;
    }
  }
});

/**
 * Render historical messages from a switched session.
 * Converts the raw AgentMessage array into ChatEntry objects and renders them.
 *
 * Strategy: First pass collects tool results keyed by toolCallId. Second pass
 * builds entries, attaching tool results to their assistant turn's tool calls.
 */
function renderHistoricalMessages(messages: import("../shared/types").AgentMessage[]): void {
  // First pass: index tool results by toolCallId
  const toolResults = new Map<string, { text: string; isError: boolean }>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      const toolCallId = (msg as Record<string, unknown>).toolCallId as string | undefined;
      if (toolCallId) {
        toolResults.set(toolCallId, {
          text: extractMessageText(msg.content),
          isError: !!(msg as Record<string, unknown>).isError,
        });
      }
    }
  }

  // Second pass: render user and assistant messages
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = extractMessageText(msg.content);
      if (!text) continue;
      const entry: ChatEntry = {
        id: nextId(),
        type: "user",
        text,
        timestamp: msg.timestamp || Date.now(),
      };
      state.entries.push(entry);
      renderer.renderNewEntry(entry);
    } else if (msg.role === "assistant") {
      const segments: import("./state").TurnSegment[] = [];
      const turnToolCalls = new Map<string, ToolCallState>();

      // Parse content blocks into segments
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (block.type === "thinking" && block.thinking) {
            segments.push({ type: "thinking", chunks: [block.thinking as string] });
          } else if (block.type === "text" && block.text) {
            const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
            if (lastSeg && lastSeg.type === "text") {
              lastSeg.chunks.push(block.text as string);
            } else {
              segments.push({ type: "text", chunks: [block.text as string] });
            }
          } else if (block.type === "tool_use" && block.name) {
            const toolId = (block.id as string) || nextId();
            const result = toolResults.get(toolId);
            const tc: ToolCallState = {
              id: toolId,
              name: block.name as string,
              args: (block.input as Record<string, unknown>) || {},
              resultText: result?.text || "",
              isError: result?.isError || false,
              isRunning: false,
              startTime: msg.timestamp || Date.now(),
              endTime: msg.timestamp || Date.now(),
            };
            turnToolCalls.set(toolId, tc);
            segments.push({ type: "tool", toolCallId: toolId });
          }
        }
      } else if (typeof msg.content === "string" && msg.content) {
        segments.push({ type: "text", chunks: [msg.content] });
      }

      if (segments.length === 0) continue;

      const turn = {
        id: nextId(),
        segments,
        toolCalls: turnToolCalls,
        isComplete: true,
        timestamp: msg.timestamp || Date.now(),
      };
      const entry: ChatEntry = {
        id: nextId(),
        type: "assistant",
        turn,
        timestamp: msg.timestamp || Date.now(),
      };
      state.entries.push(entry);
      renderer.renderNewEntry(entry);
    }
    // Skip toolResult (already indexed) and bashExecution
  }

  // Show messages area, hide welcome
  if (state.entries.length > 0) {
    welcomeScreen.style.display = "none";
  }
}

/**
 * Extract text from a message content field (string or content array).
 */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: Record<string, unknown>) => block.type === "text")
      .map((block: Record<string, unknown>) => block.text as string)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function addSystemEntry(text: string, kind: "info" | "error" | "warning" = "info"): void {
  const entry: ChatEntry = {
    id: nextId(),
    type: "system",
    systemText: text,
    systemKind: kind,
    timestamp: Date.now(),
  };
  state.entries.push(entry);
  renderer.renderNewEntry(entry);
  scrollToBottom(messagesContainer);
}

// ============================================================
// Initialize modules
// ============================================================

slashMenu.init({
  slashMenuEl: slashMenuEl,
  promptInput,
  vscode,
  onAutoResize: autoResize,
  onShowModelPicker: modelPicker.show,
  onNewConversation: handleNewConversation,
});

modelPicker.init({
  pickerEl: modelPickerEl,
  modelPickerBtn,
  modelBadge,
  vscode,
  onUpdateHeaderUI: updateHeaderUI,
  onUpdateFooterUI: updateFooterUI,
});

sessionHistory.init({
  panelEl: sessionHistoryEl,
  historyBtn,
  vscode,
  onSessionSwitched: () => {
    updateAllUI();
  },
});

uiDialogs.init({
  messagesContainer,
  vscode,
});

renderer.init({
  messagesContainer,
  welcomeScreen,
});

// ============================================================
// Initialize
// ============================================================

vscode.postMessage({ type: "ready" });
vscode.postMessage({ type: "launch_gsd" });
promptInput.focus();
updateAllUI();
