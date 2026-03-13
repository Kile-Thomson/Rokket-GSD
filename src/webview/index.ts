// ============================================================
// GSD Webview — Full-featured Chat UI
// Vanilla DOM for minimal bundle size. Uses marked for markdown.
// ============================================================

import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  ProcessStatus,
  WorkflowState,
  DashboardData,
  DashboardSlice,
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
  formatRelativeTime,
  scrollToBottom,
  sanitizeUrl,
} from "./helpers";

import * as slashMenu from "./slash-menu";
import * as modelPicker from "./model-picker";
import * as thinkingPicker from "./thinking-picker";
import * as sessionHistory from "./session-history";
import * as uiDialogs from "./ui-dialogs";
import * as toasts from "./toasts";
import * as renderer from "./renderer";

// VS Code API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ============================================================
// Tool Watchdog — Client-side timeout for stuck tools
// ============================================================

/** Default watchdog timeout: 3 minutes (180s). GSD's bash-safety is 120s,
 *  so this catches anything that slips through or isn't covered by bash-safety. */
const TOOL_WATCHDOG_TIMEOUT_MS = 180_000;

/** Map of toolCallId → timer handle for active watchdog timers */
const toolWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

function startToolWatchdog(toolCallId: string): void {
  clearToolWatchdog(toolCallId);
  const timer = setTimeout(() => {
    toolWatchdogTimers.delete(toolCallId);
    handleToolWatchdogTimeout(toolCallId);
  }, TOOL_WATCHDOG_TIMEOUT_MS);
  toolWatchdogTimers.set(toolCallId, timer);
}

function clearToolWatchdog(toolCallId: string): void {
  const timer = toolWatchdogTimers.get(toolCallId);
  if (timer) {
    clearTimeout(timer);
    toolWatchdogTimers.delete(toolCallId);
  }
}

function handleToolWatchdogTimeout(toolCallId: string): void {
  // Mark the tool as timed out in state
  const tc = state.currentTurn?.toolCalls.get(toolCallId);
  if (!tc || !tc.isRunning) return;

  tc.isRunning = false;
  tc.isError = true;
  tc.endTime = Date.now();
  tc.resultText = `⏱ Tool timed out after ${TOOL_WATCHDOG_TIMEOUT_MS / 1000}s (client-side watchdog). The tool may still be running on the server.`;

  // Re-render the tool card with timeout state
  renderer.updateToolSegmentElement(toolCallId);

  // Show a system message
  addSystemEntry(
    `Tool "${tc.name}" timed out after ${TOOL_WATCHDOG_TIMEOUT_MS / 1000}s. You can abort the current operation or force-restart GSD.`,
    "warning"
  );
}

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
      <span class="gsd-workflow-badge" id="workflowBadge" title="GSD workflow state"></span>
      <div class="gsd-header-info">
        <span class="gsd-model-badge" id="modelBadge" title="Model"></span>
        <span class="gsd-thinking-badge" id="thinkingBadge" title="Thinking level"></span>
        <span class="gsd-header-sep" id="headerSep1"></span>
        <span class="gsd-cost-badge" id="costBadge" title="Session cost"></span>
        <span class="gsd-context-badge" id="contextBadge" title="Context usage"></span>
      </div>
      <div class="gsd-header-actions">
        <button class="gsd-action-btn" id="compactBtn" title="Compact context — reduce token usage">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H8L7 3v3h1V3h6v5h-4l-1 1v2H8v1h2l3-3h1l1-1V3l-1-1zM9 7H3L2 8v5l1 1h6l1-1V8L9 7zm0 6H3V8h6v5z"/></svg>
          <span>Compact</span>
        </button>
        <button class="gsd-action-btn" id="exportBtn" title="Export conversation as HTML">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M13 1H5L4 2v3h1V2h8v12H5v-3H4v3l1 1h8l1-1V2l-1-1zM1 8l3-3v2h5v2H4v2L1 8z"/></svg>
          <span>Export</span>
        </button>
        <button class="gsd-action-btn" id="historyBtn" title="Browse previous sessions">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M13.507 12.324a7 7 0 0 0 .065-8.56A7 7 0 0 0 2 4.393V2H1v3.5l.5.5H5V5H2.811a6.008 6.008 0 1 1-.135 5.77l-.887.462a7 7 0 0 0 11.718 1.092zM8 4h1v4.495L11.255 10l-.51.858L7.5 9.166V4H8z"/></svg>
          <span>History</span>
        </button>
        <button class="gsd-action-btn" id="modelPickerBtn" title="Change AI model">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm0-9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM4.5 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm7 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/></svg>
          <span>Model</span>
        </button>
        <button class="gsd-action-btn primary" id="newConvoBtn" title="Start a new conversation">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.5.5 0 01.5.5V7H14a.5.5 0 010 1H8.5v5.5a.5.5 0 01-1 0V8H2a.5.5 0 010-1h5.5V1.5A.5.5 0 018 1z"/></svg>
          <span>New</span>
        </button>
      </div>
    </header>

    <div class="gsd-context-bar-container" id="contextBarContainer">
      <div class="gsd-context-bar" id="contextBar"></div>
    </div>

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
        <div class="gsd-welcome-actions" id="welcomeActions">
          <button class="gsd-welcome-chip" data-prompt="/gsd auto">▶ Auto</button>
          <button class="gsd-welcome-chip" data-prompt="/gsd status">📊 Status</button>
          <button class="gsd-welcome-chip" data-prompt="Review this project and tell me what you see.">🔍 Review</button>
        </div>
        <div class="gsd-welcome-attribution">
          <span class="gsd-rokketek-mark">▲ ROKKETEK</span>
        </div>
      </div>
    </main>

    <button class="gsd-scroll-fab" id="scrollFab" title="Scroll to bottom">↓</button>

    <div class="gsd-toast-container" id="toastContainer"></div>
    <div class="gsd-slash-menu" id="slashMenu"></div>
    <div class="gsd-model-picker" id="modelPicker"></div>
    <div class="gsd-thinking-picker" id="thinkingPicker"></div>
    <div class="gsd-session-history" id="sessionHistory"></div>

    <div class="gsd-input-area">
      <div class="gsd-resize-handle" id="resizeHandle" title="Drag to resize"></div>
      <div class="gsd-file-chips" id="fileChips"></div>
      <div class="gsd-image-preview" id="imagePreview"></div>
      <div class="gsd-input-row">
        <button class="gsd-attach-btn" id="attachBtn" title="Attach files">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M10.404 2.318a2.5 2.5 0 0 0-3.536 0L3.343 5.843a4 4 0 1 0 5.657 5.657l3.525-3.525-.707-.707-3.525 3.525a3 3 0 1 1-4.243-4.243l3.525-3.525a1.5 1.5 0 0 1 2.122 2.121L6.172 8.672a.5.5 0 0 1-.708-.708l3.025-3.025-.707-.707-3.025 3.025a1.5 1.5 0 0 0 2.122 2.121l3.525-3.525a2.5 2.5 0 0 0 0-3.535z"/></svg>
        </button>
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
const attachBtn = document.getElementById("attachBtn")!;
const newConvoBtn = document.getElementById("newConvoBtn")!;
const historyBtn = document.getElementById("historyBtn")!;
const modelPickerBtn = document.getElementById("modelPickerBtn")!;
const compactBtn = document.getElementById("compactBtn")!;
const exportBtn = document.getElementById("exportBtn")!;
const imagePreview = document.getElementById("imagePreview")!;
const inputHint = document.getElementById("inputHint")!;
const slashMenuEl = document.getElementById("slashMenu")!;
const modelPickerEl = document.getElementById("modelPicker")!;
const thinkingPickerEl = document.getElementById("thinkingPicker")!;
const sessionHistoryEl = document.getElementById("sessionHistory")!;
const contextBarContainer = document.getElementById("contextBarContainer")!;
const contextBar = document.getElementById("contextBar")!;
const overlayIndicators = document.getElementById("overlayIndicators")!;
const scrollFab = document.getElementById("scrollFab")!;
const welcomeActions = document.getElementById("welcomeActions")!;

// Header badges
const modelBadge = document.getElementById("modelBadge")!;
const thinkingBadge = document.getElementById("thinkingBadge")!;
const headerSep1 = document.getElementById("headerSep1")!;
const costBadge = document.getElementById("costBadge")!;
const contextBadge = document.getElementById("contextBadge")!;

// Footer
const footerCwd = document.getElementById("footerCwd")!;
const footerStats = document.getElementById("footerStats")!;
const footerRight = document.getElementById("footerRight")!;

// ============================================================
// Auto-resize textarea
// ============================================================

let manualMinHeight = 0;

function autoResize(): void {
  // Reset manual min height when input is empty (after send)
  if (!promptInput.value) manualMinHeight = 0;
  promptInput.style.height = "auto";
  const contentHeight = promptInput.scrollHeight;
  const minH = Math.max(manualMinHeight, 36);
  promptInput.style.height = Math.min(Math.max(contentHeight, minH), 400) + "px";
}
promptInput.addEventListener("input", autoResize);

// ============================================================
// Drag-to-resize input
// ============================================================

const resizeHandle = document.getElementById("resizeHandle")!;
let resizeDragging = false;
let resizeStartY = 0;
let resizeStartHeight = 0;

resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
  e.preventDefault();
  resizeDragging = true;
  resizeStartY = e.clientY;
  resizeStartHeight = promptInput.offsetHeight;
  document.body.style.cursor = "ns-resize";
  document.body.style.userSelect = "none";
});

document.addEventListener("mousemove", (e: MouseEvent) => {
  if (!resizeDragging) return;
  // Dragging up = larger input (startY > clientY = positive delta)
  const delta = resizeStartY - e.clientY;
  const newHeight = Math.max(36, Math.min(resizeStartHeight + delta, 400));
  promptInput.style.height = newHeight + "px";
});

document.addEventListener("mouseup", () => {
  if (!resizeDragging) return;
  resizeDragging = false;
  manualMinHeight = promptInput.offsetHeight;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

// ============================================================
// Scroll-to-bottom FAB
// ============================================================

function isNearBottom(threshold = 100): boolean {
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
  return scrollHeight - scrollTop - clientHeight < threshold;
}

function updateScrollFab(): void {
  const near = isNearBottom(100);
  scrollFab.classList.toggle("visible", !near);
}

messagesContainer.addEventListener("scroll", updateScrollFab, { passive: true });

scrollFab.addEventListener("click", () => {
  messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: "smooth" });
});

// ============================================================
// Timestamps
// ============================================================

function refreshTimestamps(): void {
  const els = messagesContainer.querySelectorAll<HTMLElement>(".gsd-timestamp");
  for (const el of els) {
    const ts = parseInt(el.dataset.ts || "0", 10);
    if (ts) el.textContent = formatRelativeTime(ts);
  }
}

// Refresh timestamps every 30s
setInterval(refreshTimestamps, 30_000);

// ============================================================
// Welcome quick actions
// ============================================================

welcomeActions.addEventListener("click", (e: Event) => {
  const chip = (e.target as HTMLElement).closest(".gsd-welcome-chip") as HTMLElement | null;
  if (!chip) return;
  const prompt = chip.dataset.prompt;
  if (!prompt) return;
  promptInput.value = prompt;
  autoResize();
  sendMessage();
});

// ============================================================
// Image paste & drop
// ============================================================

function handleFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    if (file.type.startsWith("image/")) {
      // Images → inline preview + base64 attachment
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        state.images.push({ type: "image", data: base64, mimeType: file.type });
        renderImagePreviews();
      };
      reader.readAsDataURL(file);
    } else {
      // Non-image files (PDFs, docs, etc.) → save to temp, insert path
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        vscode.postMessage({
          type: "save_temp_file",
          name: file.name,
          data: base64,
          mimeType: file.type,
        });
      };
      reader.readAsDataURL(file);
    }
  }
}

document.addEventListener("paste", (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  let handled = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        handleFiles([file]);
        handled = true;
      }
    }
  }
  if (handled) e.preventDefault();
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
  if (!dt) return;

  // Check for file URIs (VS Code explorer drops, OS file manager drops)
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const paths = parseDroppedUris(uriList);
    if (paths.length > 0) {
      insertDroppedPaths(paths);
      return;
    }
  }

  // Check for plain text paths (some sources use text/plain)
  const plainText = dt.getData("text/plain");
  if (plainText && !dt.files.length) {
    // Heuristic: looks like file path(s) — absolute paths or backslash paths
    const lines = plainText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const looksLikePaths = lines.every(l =>
      /^[A-Z]:\\/.test(l) || l.startsWith("/") || l.startsWith("~")
    );
    if (looksLikePaths) {
      insertDroppedPaths(lines);
      return;
    }
  }

  // Fall through to image handling
  if (dt.files.length) handleFiles(dt.files);
});

/** Parse file:// URIs from a text/uri-list drop payload into local paths */
function parseDroppedUris(uriList: string): string[] {
  const paths: string[] = [];
  for (const line of uriList.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("file://")) {
      try {
        // file:///C:/foo or file:///home/user/foo
        const url = new URL(trimmed);
        let fsPath = decodeURIComponent(url.pathname);
        // On Windows, pathname is /C:/foo — strip leading slash
        if (/^\/[A-Za-z]:\//.test(fsPath)) {
          fsPath = fsPath.slice(1);
        }
        paths.push(fsPath);
      } catch {
        // Malformed URI — skip
      }
    }
  }
  return paths;
}

/** Add file paths as file attachment chips */
function addFileAttachments(paths: string[], autoSend = false): void {
  for (const p of paths) {
    const normalized = p.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const name = parts[parts.length - 1] || p;
    const extMatch = name.match(/\.([^.]+)$/);
    const extension = extMatch ? extMatch[1].toLowerCase() : "";
    // Avoid duplicates
    if (!state.files.some(f => f.path === p)) {
      state.files.push({ type: "file", path: p, name, extension });
    }
  }
  renderFileChips();

  // Check read access
  vscode.postMessage({ type: "check_file_access", paths });

  if (autoSend) {
    sendMessage();
  }
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

function renderFileChips(): void {
  const container = document.getElementById("fileChips")!;
  if (state.files.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }
  container.style.display = "flex";
  container.innerHTML = state.files.map((f, i) => `
    <div class="gsd-file-chip" title="${escapeHtml(f.path)}">
      <span class="gsd-file-chip-icon">${getFileIcon(f.extension)}</span>
      <span class="gsd-file-chip-name">${escapeHtml(f.name)}</span>
      <button class="gsd-file-chip-remove" data-idx="${i}">×</button>
    </div>
  `).join("");

  container.querySelectorAll(".gsd-file-chip-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx!);
      state.files.splice(idx, 1);
      renderFileChips();
    });
  });
}

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
  if (!text && state.images.length === 0 && state.files.length === 0) return;

  // Build file paths prefix for the message sent to the agent
  const filePaths = state.files.map(f => f.path);
  const filePrefix = filePaths.length > 0
    ? filePaths.map(p => `[Attached file: \`${p}\`]`).join("\n") + "\n"
    : "";

  // Handle /gsd status — show dashboard inline (no streaming guard — this is local UI only)
  if (text === "/gsd status") {
    state.entries.push({
      id: nextId(),
      type: "user",
      text: "/gsd status",
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer, true);
    promptInput.value = "";
    autoResize();
    vscode.postMessage({ type: "get_dashboard" });
    return;
  }

  // Handle ! bash shortcut
  if (text.startsWith("!") && !text.startsWith("!!") && text.length > 1) {
    const bashCmd = text.slice(1).trim();
    state.entries.push({
      id: nextId(),
      type: "user",
      text: `! ${bashCmd}`,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer, true);

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
    scrollToBottom(messagesContainer, true);

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
  if (text || state.images.length > 0 || state.files.length > 0) {
    state.entries.push({
      id: nextId(),
      type: "user",
      text: text || undefined,
      images: state.images.length > 0 ? [...state.images] : undefined,
      files: state.files.length > 0 ? [...state.files] : undefined,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer, true);
  }

  const fullMessage = filePrefix + text;
  const msg: WebviewToExtensionMessage = {
    type: "prompt",
    message: fullMessage,
    images: state.images.length > 0 ? [...state.images] : undefined,
  };
  vscode.postMessage(msg);

  promptInput.value = "";
  state.images = [];
  state.files = [];
  renderImagePreviews();
  renderFileChips();
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
    if (thinkingPicker.isVisible()) {
      thinkingPicker.hide();
      return;
    }
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
    toasts.show("Compacting context…");
  }
});

exportBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "export_html" });
  toasts.show("Exporting conversation…");
});

attachBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "attach_files" });
});

// Thinking badge click is handled by thinkingPicker.init()
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

  const copyResponseBtn = target.closest(".gsd-copy-response-btn") as HTMLElement | null;
  if (copyResponseBtn) {
    const text = copyResponseBtn.dataset.copyText || "";
    vscode.postMessage({ type: "copy_text", text });
    toasts.show("Response copied");
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

document.addEventListener("copy", (_e: ClipboardEvent) => {
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

  // Thinking badge — model-aware
  const modelSupportsReasoning = state.model
    ? state.availableModels.some(
        (m) => m.id === state.model!.id && m.provider === state.model!.provider && m.reasoning
      )
    : false;

  if (state.model && !modelSupportsReasoning && state.modelsLoaded) {
    // Non-reasoning model — show disabled badge
    thinkingBadge.textContent = "🧠 N/A";
    thinkingBadge.title = "Current model does not support extended thinking";
    thinkingBadge.style.display = "inline-flex";
    thinkingBadge.classList.add("disabled");
  } else {
    const thinkingLabel = state.thinkingLevel && state.thinkingLevel !== "off" ? state.thinkingLevel : "off";
    thinkingBadge.textContent = `🧠 ${thinkingLabel}`;
    thinkingBadge.title = "Click to select thinking level";
    thinkingBadge.style.display = "inline-flex";
    thinkingBadge.classList.remove("disabled");
  }

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

  // Show separator between model/thinking and cost/context groups
  const hasLeftBadges = modelBadge.style.display !== "none" || thinkingBadge.style.display !== "none";
  const hasRightBadges = costBadge.style.display !== "none" || contextBadge.style.display !== "none";
  headerSep1.style.display = hasLeftBadges && hasRightBadges ? "block" : "none";

  // Context usage bar
  updateContextBar();
}

function updateContextBar(): void {
  const pct = state.sessionStats.contextPercent ?? 0;
  if (pct <= 0) {
    contextBarContainer.style.display = "none";
    return;
  }

  contextBarContainer.style.display = "block";
  contextBar.style.width = `${Math.min(pct, 100)}%`;

  contextBar.classList.remove("ok", "warn", "crit");
  if (pct > 90) {
    contextBar.classList.add("crit");
  } else if (pct > 70) {
    contextBar.classList.add("warn");
  } else {
    contextBar.classList.add("ok");
  }
}

function updateFooterUI(): void {
  footerCwd.textContent = state.cwd || "";
  footerCwd.title = state.cwd;

  const stats = state.sessionStats;
  const tokens = stats.tokens;
  const parts: string[] = [];

  if (tokens) {
    const tokenParts: string[] = [];
    if (tokens.input) tokenParts.push(`in:${formatTokens(tokens.input)}`);
    if (tokens.output) tokenParts.push(`out:${formatTokens(tokens.output)}`);
    if (tokens.cacheRead) tokenParts.push(`cache:${formatTokens(tokens.cacheRead)}`);
    if (tokenParts.length > 0) parts.push(tokenParts.join(" "));
  }

  if (stats.cost != null && stats.cost > 0) {
    parts.push(formatCost(stats.cost));
  }

  const ctx = formatContextUsage(stats, state.model);
  if (ctx) parts.push(ctx);

  footerStats.textContent = parts.join(" · ");

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
      ⚠ GSD process not running
      <button id="restartBtn" class="gsd-overlay-btn">Restart</button>
    </div>`);
  }

  if (state.processHealth === "unresponsive") {
    parts.push(`<div class="gsd-overlay-indicator unresponsive">
      ⚠ GSD is unresponsive
      <button id="forceRestartBtn" class="gsd-overlay-btn danger">Force Restart</button>
      <button id="forceKillBtn" class="gsd-overlay-btn">Kill Process</button>
    </div>`);
  }

  overlayIndicators.innerHTML = parts.join("");
  overlayIndicators.style.display = parts.length > 0 ? "flex" : "none";

  // Wire up force buttons (if rendered)
  const forceRestartBtn = document.getElementById("forceRestartBtn");
  if (forceRestartBtn) {
    forceRestartBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "force_restart" });
      state.processHealth = "responsive";
      state.processStatus = "restarting";
      updateOverlayIndicators();
    });
  }
  const forceKillBtn = document.getElementById("forceKillBtn");
  if (forceKillBtn) {
    forceKillBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "force_kill" });
      state.processHealth = "responsive";
      updateOverlayIndicators();
    });
  }
}

function updateWorkflowBadge(wf: WorkflowState | null): void {
  const badge = document.getElementById("workflowBadge");
  if (!badge) return;

  if (!wf) {
    badge.textContent = "Self-directed";
    badge.className = "gsd-workflow-badge";
    badge.style.display = "inline-flex";
    return;
  }

  const parts: string[] = [];

  // Build breadcrumb: M004 › S02 › T03
  if (wf.milestone) parts.push(wf.milestone.id);
  if (wf.slice) parts.push(wf.slice.id);
  if (wf.task) parts.push(wf.task.id);

  // Phase label
  const phaseLabels: Record<string, string> = {
    "pre-planning": "Pre-planning",
    "discussing": "Discussing",
    "researching": "Researching",
    "planning": "Planning",
    "executing": "Executing",
    "verifying": "Verifying",
    "summarizing": "Summarizing",
    "advancing": "Advancing",
    "completing-milestone": "Completing",
    "replanning-slice": "Replanning",
    "complete": "Complete",
    "paused": "Paused",
    "blocked": "Blocked",
    "unknown": "",
  };
  const phaseText = phaseLabels[wf.phase] || wf.phase;

  // Build display text
  let text: string;
  if (parts.length > 0) {
    text = parts.join(" › ");
    if (phaseText && phaseText !== "Complete") {
      text += ` · ${phaseText}`;
    } else if (phaseText === "Complete") {
      text += " ✓";
    }
  } else if (phaseText) {
    text = phaseText;
  } else {
    text = "Self-directed";
  }

  // Auto-mode prefix
  if (wf.autoMode === "auto") {
    text = `⚡ ${text}`;
  } else if (wf.autoMode === "next") {
    text = `▸ ${text}`;
  } else if (wf.autoMode === "paused") {
    text = `⏸ ${text}`;
  }

  badge.textContent = text;

  // Phase-based styling
  let extraClass = "";
  if (wf.phase === "blocked") extraClass = " blocked";
  else if (wf.phase === "paused") extraClass = " paused";
  else if (wf.phase === "complete") extraClass = " complete";
  else if (wf.autoMode) extraClass = " auto";

  badge.className = `gsd-workflow-badge${extraClass}`;
  badge.style.display = "inline-flex";
}

// ============================================================
// Dashboard Panel
// ============================================================

function renderDashboard(data: DashboardData | null): void {
  welcomeScreen.style.display = "none";

  // Remove any existing dashboard
  const existing = document.querySelector(".gsd-dashboard");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.className = "gsd-dashboard";

  if (!data || !data.hasMilestone) {
    el.innerHTML = `
      <div class="gsd-dashboard-empty">
        <div class="gsd-dashboard-empty-icon">📊</div>
        <div class="gsd-dashboard-empty-text">No active GSD project</div>
        <div class="gsd-dashboard-empty-hint">Run <code>/gsd</code> to start a project in this workspace</div>
      </div>
    `;
    messagesContainer.appendChild(el);
    scrollToBottom(messagesContainer, true);
    return;
  }

  const phaseLabels: Record<string, string> = {
    "pre-planning": "Pre-planning",
    "discussing": "Discussing",
    "researching": "Researching",
    "planning": "Planning",
    "executing": "Executing",
    "verifying": "Verifying",
    "summarizing": "Summarizing",
    "advancing": "Advancing",
    "completing-milestone": "Completing",
    "replanning-slice": "Replanning",
    "complete": "Complete",
    "paused": "Paused",
    "blocked": "Blocked",
    "unknown": "",
  };

  const phaseText = phaseLabels[data.phase] || data.phase;
  const phaseClass = data.phase === "complete" ? "complete" : data.phase === "blocked" ? "blocked" : "";

  // Build current action breadcrumb
  const breadcrumb: string[] = [];
  if (data.milestone) breadcrumb.push(data.milestone.id);
  if (data.slice) breadcrumb.push(data.slice.id);
  if (data.task) breadcrumb.push(data.task.id);

  // Progress bars
  function progressBar(done: number, total: number, label: string): string {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const fillPct = total > 0 ? (done / total) * 100 : 0;
    return `
      <div class="gsd-dash-progress-row">
        <span class="gsd-dash-progress-label">${escapeHtml(label)}</span>
        <div class="gsd-dash-progress-track">
          <div class="gsd-dash-progress-fill" style="width: ${fillPct}%"></div>
        </div>
        <span class="gsd-dash-progress-pct">${pct}%</span>
        <span class="gsd-dash-progress-ratio">${done}/${total}</span>
      </div>
    `;
  }

  // Slice list
  function sliceList(slices: DashboardSlice[]): string {
    return slices.map(s => {
      const icon = s.done ? "✓" : s.active ? "▸" : "○";
      const cls = s.done ? "done" : s.active ? "active" : "pending";
      const riskCls = `risk-${s.risk}`;

      let tasksHtml = "";
      if (s.active && s.tasks.length > 0) {
        tasksHtml = `<div class="gsd-dash-tasks">` +
          s.tasks.map(t => {
            const tIcon = t.done ? "✓" : t.active ? "▸" : "·";
            const tCls = t.done ? "done" : t.active ? "active" : "pending";
            return `<div class="gsd-dash-task ${tCls}"><span class="gsd-dash-icon">${tIcon}</span> ${escapeHtml(t.id)}: ${escapeHtml(t.title)}</div>`;
          }).join("") +
          `</div>`;
      }

      return `
        <div class="gsd-dash-slice ${cls}">
          <div class="gsd-dash-slice-row">
            <span class="gsd-dash-icon">${icon}</span>
            <span class="gsd-dash-slice-title">${escapeHtml(s.id)}: ${escapeHtml(s.title)}</span>
            <span class="gsd-dash-risk ${riskCls}">${escapeHtml(s.risk)}</span>
          </div>
          ${tasksHtml}
        </div>
      `;
    }).join("");
  }

  el.innerHTML = `
    <div class="gsd-dashboard-header">
      <div class="gsd-dashboard-title">📊 GSD Dashboard</div>
      <span class="gsd-dashboard-phase ${phaseClass}">${escapeHtml(phaseText)}</span>
    </div>

    ${data.task ? `
    <div class="gsd-dash-current">
      <span class="gsd-dash-current-label">Now:</span>
      <span class="gsd-dash-current-action">${escapeHtml(phaseText)} ${escapeHtml(breadcrumb.join(" › "))}</span>
    </div>
    ` : ""}

    <div class="gsd-dash-milestone-title">${escapeHtml(data.milestone?.id || "")}:  ${escapeHtml(data.milestone?.title || "")}</div>

    <div class="gsd-dash-progress">
      ${data.progress.tasks.total > 0 ? progressBar(data.progress.tasks.done, data.progress.tasks.total, "Tasks") : ""}
      ${progressBar(data.progress.slices.done, data.progress.slices.total, "Slices")}
    </div>

    <div class="gsd-dash-slices">
      ${sliceList(data.slices)}
    </div>

    <div class="gsd-dashboard-footer">
      <span class="gsd-dash-hint">Run <code>/gsd auto</code> to start executing</span>
    </div>
  `;

  messagesContainer.appendChild(el);
  scrollToBottom(messagesContainer, true);
}

function updateWelcomeScreen(): void {
  // Only hide welcome for real conversation entries (user messages, assistant turns)
  // System info/warning entries alone shouldn't dismiss it
  const hasConversation = state.currentTurn || state.entries.some(
    e => e.type === "user" || e.type === "assistant"
  );
  if (hasConversation) {
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
      welcomeProcess.textContent = "GSD failed to start — check the error below";
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

  try {

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
        // Eagerly fetch available models if not loaded yet (debounce)
        if (!state.modelsLoaded && !state.modelsRequested) {
          state.modelsRequested = true;
          vscode.postMessage({ type: "get_available_models" });
        }
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
      const prevStatus = state.processStatus;
      state.processStatus = data.status as ProcessStatus;

      // When the process becomes "running" (fresh start or after crash/restart),
      // reset command cache so the slash menu re-fetches from the new process.
      if (data.status === "running" && prevStatus !== "running") {
        // Reset streaming state — if we're freshly running, we can't be streaming
        state.isStreaming = false;
        state.isCompacting = false;
        state.commandsLoaded = false;
        state.commands = [];
        // Eagerly fetch commands so they're ready when the user types /
        vscode.postMessage({ type: "get_commands" });
      }

      updateOverlayIndicators();
      updateWelcomeScreen();
      break;
    }

    case "workflow_state": {
      updateWorkflowBadge(msg.state);
      break;
    }

    case "dashboard_data": {
      renderDashboard(msg.data);
      break;
    }

    case "agent_start": {
      // Expire any pending UI dialogs from a previous turn — the backend's
      // abort signal has already auto-resolved them, so user interaction
      // would go nowhere.
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("New turn started");
      }
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
      state.processHealth = "responsive";
      // Clear all tool watchdog timers
      for (const [, timer] of toolWatchdogTimers) {
        clearTimeout(timer);
      }
      toolWatchdogTimers.clear();
      // Expire any pending UI dialogs — the backend's abort signal fires
      // on agent_end, auto-resolving all pending dialogs to defaults.
      // Mark them so the user sees they're no longer interactive.
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("Agent finished");
      }
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
      // Start watchdog timer for this tool
      startToolWatchdog(data.toolCallId);
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
      // Clear watchdog — tool completed normally
      clearToolWatchdog(data.toolCallId);
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

    case "extension_error": {
      const data = msg;
      const extError = (data as any).error as string || "unknown error";
      addSystemEntry(`Command error: ${extError}`, "error");
      break;
    }

    case "extension_ui_request": {
      const data = msg;
      if (data.method === "notify" && data.message) {
        const notifyType = (data as any).notifyType as string || "info";
        const kind = notifyType === "error" ? "error" : notifyType === "warning" ? "warning" : "info";
        addSystemEntry(data.message as string, kind);
      } else if (data.method === "setStatus" && data.statusText) {
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
      state.modelsRequested = false;
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
      thinkingPicker.refresh();
      toasts.show(`Thinking: ${state.thinkingLevel}`);
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
      state.processHealth = "responsive";
      state.currentTurn = null;
      // Clear all tool watchdog timers
      for (const [, timer] of toolWatchdogTimers) {
        clearTimeout(timer);
      }
      toolWatchdogTimers.clear();
      // Expire any pending dialogs — the process is gone
      if (uiDialogs.hasPending()) {
        uiDialogs.expireAllPending("Process exited");
      }
      // Reset command cache — the process that provided them is dead
      state.commandsLoaded = false;
      state.commands = [];
      renderer.resetStreamingState();
      updateInputUI();
      updateOverlayIndicators();

      // Build an informative error message including stderr detail
      const detail = (data as any).detail as string | undefined;
      let message: string;
      if (detail) {
        message = detail;
      } else if (data.code === 0) {
        message = "GSD process exited.";
      } else {
        message = `GSD process exited (code: ${data.code}).`;
      }
      addSystemEntry(message, data.code === 0 ? "info" : "error");
      break;
    }

    case "process_health": {
      const data = msg;
      state.processHealth = data.status;
      if (data.status === "unresponsive") {
        updateOverlayIndicators();
      } else if (data.status === "recovered") {
        updateOverlayIndicators();
        addSystemEntry("GSD process recovered", "info");
      }
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

    case "file_access_result": {
      const data = msg;
      const denied = data.results.filter((r: { path: string; readable: boolean }) => !r.readable);
      if (denied.length > 0) {
        const names = denied.map((r: { path: string }) => {
          const parts = r.path.replace(/\\/g, "/").split("/");
          return parts[parts.length - 1] || r.path;
        });
        toasts.show(`⚠ No read access: ${names.join(", ")}`, 4000);
      }
      break;
    }

    case "temp_file_saved": {
      const data = msg;
      addFileAttachments([data.path], true);
      break;
    }

    case "files_attached": {
      const data = msg;
      if (data.paths.length > 0) {
        addFileAttachments(data.paths, true);
      }
      break;
    }

    case "update_available": {
      const data = msg;
      showUpdateCard(data.version, data.currentVersion, data.releaseNotes, data.downloadUrl, data.htmlUrl);
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
      scrollToBottom(messagesContainer, true);
      break;
    }
  }

  } catch (err: any) {
    // Global error boundary — surface crashes visibly instead of silent failure
    const errorId = `GSD-ERR-${Date.now().toString(36).toUpperCase()}`;
    console.error(`[${errorId}] Message handler error for "${msg.type}":`, err);
    addSystemEntry(
      `Internal error processing "${msg.type}" (${errorId}). Check browser console for details. Please report this error code.`,
      "error"
    );
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

/**
 * Show an inline update card in the chat with release notes and action buttons.
 */
function showUpdateCard(
  version: string,
  currentVersion: string,
  releaseNotes: string,
  downloadUrl: string,
  htmlUrl: string
): void {
  // Remove any existing update card
  const existing = document.getElementById("gsd-update-card");
  if (existing) existing.remove();

  // Simple markdown-to-HTML for release notes (handles headers, lists, bold, links, code)
  const formatReleaseNotes = (md: string): string => {
    if (!md.trim()) return "<p>No release notes available.</p>";
    return escapeHtml(md)
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^\* (.+)$/gm, '<li>$1</li>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
      .replace(/\n{2,}/g, '<br>')
      .replace(/\n/g, ' ');
  };

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
      ${formatReleaseNotes(releaseNotes)}
    </div>
    <div class="gsd-update-actions">
      <button class="gsd-update-btn primary" data-action="install">Update Now</button>
      <button class="gsd-update-btn" data-action="release">View on GitHub</button>
      <button class="gsd-update-btn dismiss" data-action="dismiss">Dismiss</button>
    </div>
  `;

  // Wire up button handlers
  card.querySelector('[data-action="install"]')?.addEventListener("click", () => {
    vscode.postMessage({ type: "update_install", downloadUrl } as WebviewToExtensionMessage);
    card.remove();
  });

  card.querySelector('[data-action="release"]')?.addEventListener("click", () => {
    vscode.postMessage({ type: "update_view_release", htmlUrl } as WebviewToExtensionMessage);
  });

  card.querySelector('[data-action="dismiss"]')?.addEventListener("click", () => {
    vscode.postMessage({ type: "update_dismiss", version } as WebviewToExtensionMessage);
    card.classList.add("dismissing");
    setTimeout(() => card.remove(), 300);
  });

  // Insert at the top of the messages area, after any welcome screen
  messagesContainer.insertBefore(card, messagesContainer.firstChild?.nextSibling || null);
  scrollToBottom(messagesContainer);
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
  onSendMessage: sendMessage,
  onShowHistory: () => {
    vscode.postMessage({ type: "get_session_list" });
    sessionHistory.show();
  },
  onCopyLast: () => {
    // Find the last assistant entry and copy its text
    for (let i = state.entries.length - 1; i >= 0; i--) {
      const entry = state.entries[i];
      if (entry.type === "assistant" && entry.turn) {
        const textChunks: string[] = [];
        for (const seg of entry.turn.segments) {
          if (seg.type === "text") textChunks.push(seg.chunks.join(""));
        }
        const text = textChunks.join("\n");
        if (text) {
          vscode.postMessage({ type: "copy_text", text });
          addSystemEntry("Last assistant message copied to clipboard.", "info");
          return;
        }
      }
    }
    addSystemEntry("No assistant message to copy.", "warning");
  },
  onToggleAutoCompact: () => {
    const current = state.sessionStats.autoCompactionEnabled;
    const newValue = !current;
    vscode.postMessage({ type: "set_auto_compaction", enabled: newValue });
    state.sessionStats.autoCompactionEnabled = newValue;
    addSystemEntry(`Auto-compaction ${newValue ? "enabled" : "disabled"}.`, "info");
  },
});

modelPicker.init({
  pickerEl: modelPickerEl,
  modelPickerBtn,
  modelBadge,
  vscode,
  onUpdateHeaderUI: updateHeaderUI,
  onUpdateFooterUI: updateFooterUI,
});

thinkingPicker.init({
  pickerEl: thinkingPickerEl,
  thinkingBadge,
  vscode,
  onThinkingChanged: () => {
    updateHeaderUI();
    updateFooterUI();
  },
});

sessionHistory.init({
  panelEl: sessionHistoryEl,
  historyBtn,
  vscode,
  onSessionSwitched: () => {
    updateAllUI();
  },
  onNewConversation: handleNewConversation,
});

uiDialogs.init({
  messagesContainer,
  vscode,
});

toasts.init(document.getElementById("toastContainer")!);

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
