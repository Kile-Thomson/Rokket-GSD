// ============================================================
// GSD Webview — Full-featured Chat UI
// Vanilla DOM for minimal bundle size. Uses marked for markdown.
// ============================================================

import type {
  WebviewToExtensionMessage,
} from "../shared/types";
import { throttleRAF, debounce } from "./perf-utils";
// CSS modules — import order replicates the original cascade
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/entries.css";
import "./styles/tools.css";
import "./styles/dashboard.css";
import "./styles/input.css";
import "./styles/footer.css";
import "./styles/overlays.css";
import "./styles/toasts.css";
import "./styles/misc.css";
import "./styles/auto-progress.css";
import "./styles/parallel.css";
import "./styles/themes/phosphor.css";
import "./styles/themes/clarity.css";
import "./styles/themes/forge.css";

import {
  state,
  nextId,
  pruneOldEntries,
} from "./state";

import {
  formatRelativeTime,
  scrollToBottom,
  initAutoScroll,
  isAutoScrollSuppressed,
} from "./helpers";

import { registerInterval, disposeAll } from "./dispose";
import { shouldDebounce } from "./send-debounce";
import { initPersistAttachments, rehydrateAttachments, persistAttachments } from "./persist-attachments";

import * as slashMenu from "./slash-menu";
import * as modelPicker from "./model-picker";
import * as thinkingPicker from "./thinking-picker";
import * as sessionHistory from "./session-history";
import * as uiDialogs from "./ui-dialogs";
import * as toasts from "./toasts";
import * as renderer from "./renderer";
import * as dashboard from "./dashboard";
import * as autoProgressWidget from "./auto-progress";
import * as visualizer from "./visualizer";
import * as fileHandling from "./file-handling";
import * as messageHandler from "./message-handler";
import * as keyboard from "./keyboard";
import * as uiUpdates from "./ui-updates";

// VS Code API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

initPersistAttachments(vscode);

// ============================================================
// DOM Setup
// ============================================================

const root = document.getElementById("root")!;
root.innerHTML = `
  <div class="gsd-app">
    <header class="gsd-header" role="banner">
      <div class="gsd-header-brand">
        <span class="gsd-logo" aria-hidden="true">🚀</span>
        <span class="gsd-title">Rokket GSD</span>
        <span class="gsd-header-version" id="headerVersion" title="View changelog" role="button" tabindex="0" aria-label="View changelog"></span>
      </div>
      <span class="gsd-workflow-badge gsd-hidden" id="workflowBadge" title="GSD workflow state" role="status" aria-label="Workflow state"></span>
      <div class="gsd-header-info" role="status" aria-label="Session info">
        <span class="gsd-model-badge gsd-hidden" id="modelBadge" title="Model" aria-label="Current model"></span>
        <span class="gsd-thinking-badge gsd-hidden" id="thinkingBadge" title="Thinking level" aria-label="Thinking level"></span>
        <span class="gsd-header-sep gsd-hidden" id="headerSep1" aria-hidden="true"></span>
        <span class="gsd-cost-badge gsd-hidden" id="costBadge" title="Session cost" aria-label="Session cost"></span>
        <span class="gsd-context-badge gsd-hidden" id="contextBadge" title="Context usage" aria-label="Context usage"></span>
      </div>
      <div class="gsd-header-actions" role="toolbar" aria-label="Actions">
        <button class="gsd-action-btn" id="historyBtn" title="Browse previous sessions" aria-label="Session history">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.507 12.324a7 7 0 0 0 .065-8.56A7 7 0 0 0 2 4.393V2H1v3.5l.5.5H5V5H2.811a6.008 6.008 0 1 1-.135 5.77l-.887.462a7 7 0 0 0 11.718 1.092zM8 4h1v4.495L11.255 10l-.51.858L7.5 9.166V4H8z"/></svg>
          <span>History</span>
        </button>
        <button class="gsd-action-btn" id="telegramSyncBtn" title="Toggle Telegram sync for this conversation" aria-label="Telegram sync">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14.3 1.3L1.5 6.8c-.9.3-.9.9-.1 1.1l3.3 1 1.2 3.9c.2.4.3.5.6.5.3 0 .5-.1.6-.3l1.5-1.5 3.1 2.3c.6.3 1 .2 1.1-.5L14.9 2c.2-.8-.3-1.2-1-.7zM6.3 9.6l-.7 2.1-.8-2.7 7.4-4.6L6.3 9.6z"/></svg>
          <span>Sync</span>
        </button>
        <button class="gsd-action-btn" id="modelPickerBtn" title="Change AI model" aria-label="Change model">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm0-9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM4.5 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm7 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/></svg>
          <span>Model</span>
        </button>
        <button class="gsd-action-btn primary" id="newConvoBtn" title="Start a new conversation" aria-label="New conversation">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1a.5.5 0 01.5.5V7H14a.5.5 0 010 1H8.5v5.5a.5.5 0 01-1 0V8H2a.5.5 0 010-1h5.5V1.5A.5.5 0 018 1z"/></svg>
          <span>New</span>
        </button>
        <div class="gsd-settings-wrapper" id="settingsWrapper">
          <button class="gsd-icon-btn" id="settingsBtn" title="Settings" aria-label="Settings" aria-haspopup="true" aria-expanded="false">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.3.7L2 7.4v1.2l2.4.5.3.7-1.3 2 .8.8 2-1.3.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.8-.8-1.3-2 .3-.7 2.4-.5V7.4l-2.4-.5-.3-.7 1.3-2-.8-.8-2 1.3-.7-.3zM8 10a2 2 0 110-4 2 2 0 010 4z"/></svg>
          </button>
          <div class="gsd-settings-dropdown" id="settingsDropdown" role="menu" aria-label="Settings">
            <div class="gsd-settings-section">
              <span class="gsd-settings-label">Actions</span>
              <div class="gsd-settings-actions">
                <button class="gsd-settings-action-btn" id="compactBtn" role="menuitem" title="Compact context — reduce token usage">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M14 2H8L7 3v3h1V3h6v5h-4l-1 1v2H8v1h2l3-3h1l1-1V3l-1-1zM9 7H3L2 8v5l1 1h6l1-1V8L9 7zm0 6H3V8h6v5z"/></svg>
                  <span>Compact context</span>
                </button>
                <button class="gsd-settings-action-btn" id="exportBtn" role="menuitem" title="Export conversation as HTML">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13 1H5L4 2v3h1V2h8v12H5v-3H4v3l1 1h8l1-1V2l-1-1zM1 8l3-3v2h5v2H4v2L1 8z"/></svg>
                  <span>Export conversation</span>
                </button>
              </div>
            </div>
            <div class="gsd-settings-divider"></div>
            <div class="gsd-settings-section">
              <span class="gsd-settings-label">Theme</span>
              <div class="gsd-settings-options" id="themeOptions">
                <button class="gsd-settings-option active" data-theme="classic" role="menuitemradio" aria-checked="true">
                  <span class="gsd-settings-option-dot"></span>
                  <span>Classic</span>
                </button>
                <button class="gsd-settings-option" data-theme="phosphor" role="menuitemradio" aria-checked="false">
                  <span class="gsd-settings-option-dot"></span>
                  <span>Phosphor</span>
                  <span class="gsd-settings-theme-tag phosphor">MATRIX</span>
                </button>
                <button class="gsd-settings-option" data-theme="clarity" role="menuitemradio" aria-checked="false">
                  <span class="gsd-settings-option-dot"></span>
                  <span>Clarity</span>
                  <span class="gsd-settings-theme-tag clarity">CLEAN</span>
                </button>
                <button class="gsd-settings-option" data-theme="forge" role="menuitemradio" aria-checked="false">
                  <span class="gsd-settings-option-dot"></span>
                  <span>Forge</span>
                  <span class="gsd-settings-theme-tag forge">METAL</span>
                </button>
              </div>
            </div>
            <div class="gsd-settings-divider"></div>
            <div class="gsd-settings-section">
              <span class="gsd-settings-label">Voice Transcription</span>
              <div class="gsd-settings-voice-providers" id="voiceProviders">
                <button class="gsd-settings-option active" data-provider="openai" role="menuitemradio" aria-checked="true">
                  <span class="gsd-settings-option-dot"></span>
                  <span>OpenAI Whisper</span>
                </button>
                <button class="gsd-settings-option" data-provider="xai" role="menuitemradio" aria-checked="false">
                  <span class="gsd-settings-option-dot"></span>
                  <span>xAI / Grok</span>
                </button>
                <button class="gsd-settings-option" data-provider="azure" role="menuitemradio" aria-checked="false">
                  <span class="gsd-settings-option-dot"></span>
                  <span>Azure Speech</span>
                </button>
              </div>
              <div class="gsd-settings-voice-key">
                <div class="gsd-settings-voice-key-row">
                  <input type="password" class="gsd-settings-voice-key-input" id="voiceKeyInput" placeholder="Paste API key..." autocomplete="off" />
                  <button class="gsd-settings-voice-key-save" id="voiceKeySave">Save</button>
                </div>
                <span class="gsd-settings-voice-key-status" id="voiceKeyStatus"></span>
              </div>
              <div class="gsd-settings-voice-azure gsd-hidden" id="voiceAzureRegion">
                <label class="gsd-settings-voice-label" for="voiceAzureRegionInput" title="The Azure datacenter region where your Speech Services resource is deployed. Find it in Azure Portal → your Speech resource → Keys and Endpoint.">Region</label>
                <input type="text" class="gsd-settings-voice-key-input" id="voiceAzureRegionInput" placeholder="e.g. eastus, australiaeast" title="The Azure datacenter region where your Speech Services resource is deployed. Find it in Azure Portal → your Speech resource → Keys and Endpoint." autocomplete="off" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="gsd-context-bar-container gsd-hidden" id="contextBarContainer">
      <div class="gsd-context-bar" id="contextBar"></div>
    </div>

    <div class="gsd-overlay-indicators gsd-hidden" id="overlayIndicators"></div>

    <main class="gsd-messages" id="messagesContainer" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions">
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
        <div class="gsd-welcome-title">Get Shit Done</div>
        <div class="gsd-welcome-sub" id="welcomeProcess">Initializing...</div>
        <div class="gsd-welcome-model" id="welcomeModel"></div>
        <div class="gsd-welcome-hints gsd-hidden" id="welcomeHints"></div>
        <div class="gsd-welcome-actions" id="welcomeActions">
          <button class="gsd-welcome-chip" data-prompt="/gsd auto">▶ Auto</button>
          <button class="gsd-welcome-chip" data-prompt="/gsd status">📊 Status</button>
          <button class="gsd-welcome-chip" data-prompt="Review this project and tell me what you see.">🔍 Review</button>
          <button class="gsd-welcome-chip gsd-resume-chip gsd-hidden" data-action="resume_last">↩ Resume</button>
        </div>
        <div class="gsd-welcome-attribution">
          <span class="gsd-rokketek-mark">▲ ROKKETEK</span>
        </div>
      </div>
    </main>

    <div id="srAnnouncer" role="status" aria-live="polite" class="sr-only"></div>
    <button class="gsd-scroll-fab" id="scrollFab" title="Scroll to bottom" aria-label="Scroll to bottom">↓</button>

    <div class="gsd-toast-container" id="toastContainer" role="status" aria-live="polite"></div>
    <div class="gsd-slash-menu gsd-hidden" id="slashMenu"></div>
    <div class="gsd-model-picker gsd-hidden" id="modelPicker"></div>
    <div class="gsd-thinking-picker gsd-hidden" id="thinkingPicker"></div>
    <div class="gsd-session-history gsd-hidden" id="sessionHistory"></div>

    <div class="gsd-voice-recording gsd-hidden" id="voiceRecording">
      <div class="gsd-voice-pulse"></div>
      <span class="gsd-voice-recording-text">Recording...</span>
      <span class="gsd-voice-recording-time" id="voiceRecordingTime">0:00</span>
      <button class="gsd-voice-cancel" id="voiceCancelBtn" title="Cancel recording" aria-label="Cancel recording">&times;</button>
    </div>

    <div class="gsd-input-area">
      <div class="gsd-resize-handle" id="resizeHandle" title="Drag to resize"></div>
      <div class="gsd-file-chips gsd-hidden" id="fileChips"></div>
      <div class="gsd-image-preview gsd-hidden" id="imagePreview"></div>
      <div class="gsd-input-row">
        <button class="gsd-attach-btn" id="attachBtn" title="Attach files">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M10.404 2.318a2.5 2.5 0 0 0-3.536 0L3.343 5.843a4 4 0 1 0 5.657 5.657l3.525-3.525-.707-.707-3.525 3.525a3 3 0 1 1-4.243-4.243l3.525-3.525a1.5 1.5 0 0 1 2.122 2.121L6.172 8.672a.5.5 0 0 1-.708-.708l3.025-3.025-.707-.707-3.025 3.025a1.5 1.5 0 0 0 2.122 2.121l3.525-3.525a2.5 2.5 0 0 0 0-3.535z"/></svg>
        </button>
        <button class="gsd-voice-btn" id="voiceBtn" title="Record voice message" aria-label="Record voice message">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" id="voiceIcon" aria-hidden="true"><path d="M8 1a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0v-4A2.5 2.5 0 0 0 8 1zM6.5 3.5a1.5 1.5 0 1 1 3 0v4a1.5 1.5 0 0 1-3 0v-4zM4 7a.5.5 0 0 0-1 0 5 5 0 0 0 4.5 4.975V13.5H6a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1H8.5v-1.525A5 5 0 0 0 13 7a.5.5 0 0 0-1 0 4 4 0 0 1-8 0z"/></svg>
        </button>
        <div class="gsd-input-wrapper">
          <textarea id="promptInput" class="gsd-input" placeholder="Message GSD..." rows="1" aria-label="Chat message input"></textarea>
        </div>
        <button class="gsd-send-btn" id="sendBtn" title="Send">
          <span id="sendIcon">↑</span>
        </button>
      </div>
      <div class="gsd-input-hint" id="inputHint"></div>
    </div>

    <footer class="gsd-footer" id="footer">
      <div class="gsd-widgets" id="widgetContainer"></div>
      <div class="gsd-footer-line" id="footerLine1">
        <span class="gsd-footer-cwd" id="footerCwd" title="Working directory"></span>
        <span class="gsd-footer-skills" id="footerStats"></span>
      </div>
    </footer>
  </div>
`;

// Element refs
const messagesContainer = document.getElementById("messagesContainer")!;
const welcomeScreen = document.getElementById("welcomeScreen")!;
const welcomeProcess = document.getElementById("welcomeProcess")!;
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
const telegramSyncBtn = document.getElementById("telegramSyncBtn")!;
const imagePreview = document.getElementById("imagePreview")!;
const inputHint = document.getElementById("inputHint")!;
const slashMenuEl = document.getElementById("slashMenu")!;
const modelPickerEl = document.getElementById("modelPicker")!;
const thinkingPickerEl = document.getElementById("thinkingPicker")!;
const sessionHistoryEl = document.getElementById("sessionHistory")!;
const voiceBtn = document.getElementById("voiceBtn")!;
const voiceProviders = document.getElementById("voiceProviders")!;
const voiceKeyInput = document.getElementById("voiceKeyInput") as HTMLInputElement;
const voiceKeySave = document.getElementById("voiceKeySave")!;
const voiceKeyStatus = document.getElementById("voiceKeyStatus")!;
const voiceAzureRegionEl = document.getElementById("voiceAzureRegion")!;
const voiceAzureRegionInput = document.getElementById("voiceAzureRegionInput") as HTMLInputElement;
const voiceRecordingEl = document.getElementById("voiceRecording")!;
const voiceRecordingTime = document.getElementById("voiceRecordingTime")!;
const voiceCancelBtn = document.getElementById("voiceCancelBtn")!;
const contextBarContainer = document.getElementById("contextBarContainer")!;
const contextBar = document.getElementById("contextBar")!;
const overlayIndicators = document.getElementById("overlayIndicators")!;
const scrollFab = document.getElementById("scrollFab")!;
const welcomeActions = document.getElementById("welcomeActions")!;

// Header badges
const headerVersion = document.getElementById("headerVersion")!;
const modelBadge = document.getElementById("modelBadge")!;
const thinkingBadge = document.getElementById("thinkingBadge")!;
const headerSep1 = document.getElementById("headerSep1")!;
const costBadge = document.getElementById("costBadge")!;
const contextBadge = document.getElementById("contextBadge")!;

// Footer
const footerCwd = document.getElementById("footerCwd")!;

// ============================================================
// Header toolbar — roving tabindex (WAI-ARIA toolbar pattern)
// ============================================================

{
  const toolbar = document.querySelector('.gsd-header-actions[role="toolbar"]');
  if (toolbar) {
    const buttons = () => Array.from(toolbar.querySelectorAll<HTMLElement>(".gsd-action-btn"));
    // Initialize: first button tabindex=0, rest -1
    const allBtns = buttons();
    allBtns.forEach((btn, i) => btn.setAttribute("tabindex", i === 0 ? "0" : "-1"));

    toolbar.addEventListener("keydown", (e: Event) => {
      const ke = e as KeyboardEvent;
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(ke.key)) return;
      ke.preventDefault();
      const btns = buttons();
      const current = btns.indexOf(ke.target as HTMLElement);
      if (current === -1) return;
      let next = current;
      if (ke.key === "ArrowRight") next = (current + 1) % btns.length;
      else if (ke.key === "ArrowLeft") next = (current - 1 + btns.length) % btns.length;
      else if (ke.key === "Home") next = 0;
      else if (ke.key === "End") next = btns.length - 1;
      btns[current].setAttribute("tabindex", "-1");
      btns[next].setAttribute("tabindex", "0");
      btns[next].focus();
    });
  }
}

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
promptInput.addEventListener("input", throttleRAF(autoResize));

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
  // Show FAB when auto-scroll is suppressed (user scrolled up) or not near bottom
  const showFab = isAutoScrollSuppressed() || !isNearBottom(100);
  scrollFab.classList.toggle("visible", showFab);
}

// Initialize intent-based auto-scroll tracking
initAutoScroll(messagesContainer);
messagesContainer.addEventListener("scroll", updateScrollFab, { passive: true });

scrollFab.addEventListener("click", () => {
  scrollToBottom(messagesContainer, true);
});

// ============================================================
// Timestamps
// ============================================================

function refreshTimestamps(): void {
  const els = messagesContainer.querySelectorAll<HTMLElement>(".gsd-timestamp");
  for (const el of Array.from(els)) {
    const ts = parseInt(el.dataset.ts || "0", 10);
    if (ts) el.textContent = formatRelativeTime(ts);
  }
}

// Refresh timestamps every 30s
registerInterval("timestamp-refresh", setInterval(refreshTimestamps, 30_000));

// ============================================================
// Welcome quick actions
// ============================================================

welcomeActions.addEventListener("click", (e: Event) => {
  const chip = (e.target as HTMLElement).closest(".gsd-welcome-chip") as HTMLElement | null;
  if (!chip) return;

  // Special action buttons (not prompts)
  const action = chip.dataset.action;
  if (action === "resume_last") {
    vscode.postMessage({ type: "resume_last_session" });
    return;
  }

  const prompt = chip.dataset.prompt;
  if (!prompt) return;
  promptInput.value = prompt;
  autoResize();
  sendMessage();
});

// File & image handling is in file-handling.ts

// ============================================================
// Ollama interactive actions (Load / Unload / Remove buttons)
// ============================================================

messagesContainer.addEventListener("click", (e: Event) => {
  const btn = (e.target as HTMLElement).closest(".gsd-ollama-btn") as HTMLElement | null;
  if (!btn) return;

  const rawAction = btn.dataset.action;
  const model = btn.dataset.model;
  if (!rawAction?.startsWith("ollama_") || !model) return;

  const action = rawAction.replace("ollama_", "") as "load" | "unload" | "pull" | "remove";

  // Disable button to prevent double-clicks
  btn.setAttribute("disabled", "true");
  btn.textContent = action === "remove" ? "Removing\u2026" : action === "unload" ? "Unloading\u2026" : action === "pull" ? "Pulling\u2026" : "Loading\u2026";

  vscode.postMessage({ type: "ollama_action", action, model } as WebviewToExtensionMessage);
});

// ============================================================
// Telegram sync toggle
// ============================================================

telegramSyncBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "telegram_sync_toggle" } as WebviewToExtensionMessage);
});

// ============================================================
// Voice recording
// ============================================================

let voiceIsRecording = false;
let voiceTimerInterval: ReturnType<typeof setInterval> | null = null;
let voiceStartTime = 0;

function startVoiceTimer(): void {
  voiceStartTime = Date.now();
  voiceTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    voiceRecordingTime.textContent = `${m}:${s.toString().padStart(2, "0")}`;
  }, 250);
}

function stopVoiceTimer(): void {
  if (voiceTimerInterval) {
    clearInterval(voiceTimerInterval);
    voiceTimerInterval = null;
  }
}

function showVoiceRecording(show: boolean): void {
  voiceRecordingEl.classList.toggle("gsd-hidden", !show);
  voiceBtn.classList.toggle("gsd-voice-active", show);
}

function startRecording(): void {
  vscode.postMessage({ type: "voice_start_recording" } as WebviewToExtensionMessage);
  showVoiceRecording(true);
  startVoiceTimer();
  voiceIsRecording = true;
}

function stopRecording(): void {
  if (!voiceIsRecording) return;
  voiceIsRecording = false;
  stopVoiceTimer();
  showVoiceRecording(false);
  voiceBtn.classList.add("gsd-voice-transcribing");
  voiceBtn.title = "Transcribing...";

  // Show transcribing placeholder in chat
  const placeholder = document.createElement("div");
  placeholder.id = "voiceTranscribingPlaceholder";
  placeholder.className = "gsd-voice-transcribing-placeholder";
  placeholder.innerHTML = `
    <div class="gsd-voice-transcribing-wave">
      <span></span><span></span><span></span><span></span><span></span>
    </div>
    <span class="gsd-voice-transcribing-label">Transcribing...</span>
  `;
  messagesContainer.appendChild(placeholder);
  scrollToBottom(messagesContainer, true);

  vscode.postMessage({ type: "voice_stop_recording" } as WebviewToExtensionMessage);
}

function cancelRecording(): void {
  if (!voiceIsRecording) return;
  voiceIsRecording = false;
  stopVoiceTimer();
  showVoiceRecording(false);
  vscode.postMessage({ type: "voice_cancel_recording" } as WebviewToExtensionMessage);
}

voiceBtn.addEventListener("click", () => {
  if (voiceIsRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

voiceCancelBtn.addEventListener("click", () => cancelRecording());

voiceProviders.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("[data-provider]") as HTMLElement | null;
  if (!btn) return;
  e.stopPropagation();
  const provider = btn.dataset.provider!;
  state.voiceProvider = provider;
  voiceProviders.querySelectorAll("[data-provider]").forEach((el) => {
    const isActive = (el as HTMLElement).dataset.provider === provider;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-checked", String(isActive));
  });
  voiceAzureRegionEl.classList.toggle("gsd-hidden", provider !== "azure");
  voiceKeyInput.placeholder = "Paste API key...";
  vscode.postMessage({ type: "set_voice_provider", provider } as WebviewToExtensionMessage);
});

voiceKeySave.addEventListener("click", (e) => {
  e.stopPropagation();
  const key = voiceKeyInput.value.trim();
  if (!key) return;
  vscode.postMessage({ type: "set_voice_api_key", provider: state.voiceProvider, key } as WebviewToExtensionMessage);
  voiceKeyInput.value = "";
  voiceKeyStatus.textContent = "Saved!";
  setTimeout(() => { voiceKeyStatus.textContent = ""; }, 2000);
});

voiceKeyInput.addEventListener("click", (e) => e.stopPropagation());
voiceAzureRegionInput.addEventListener("click", (e) => e.stopPropagation());
voiceAzureRegionInput.addEventListener("change", () => {
  const val = voiceAzureRegionInput.value.trim();
  if (val) vscode.postMessage({ type: "set_voice_region", regionType: "azure", value: val } as WebviewToExtensionMessage);
});

// ============================================================
// Slash command menu — input listener
// ============================================================

promptInput.addEventListener("input", debounce(() => {
  const val = promptInput.value;
  if (val.startsWith("/") && !val.includes("\n")) {
    const filter = val.slice(1).trim();
    slashMenu.show(filter);
  } else {
    slashMenu.hide();
  }
}, 100));



// ============================================================
// Send message
// ============================================================

function sendMessage(): void {
  slashMenu.hide();
  modelPicker.hide();

  // Debounce rapid double-clicks (skip guard during streaming — steer path must stay responsive)
  if (!state.isStreaming && shouldDebounce()) return;

  // Block sending during compaction
  if (state.isCompacting) return;

  const text = promptInput.value.trim();
  if (!text && state.images.length === 0 && state.files.length === 0) return;

  // Build file paths prefix for the message sent to the agent
  const filePaths = state.files.map(f => f.path);
  const filePrefix = filePaths.length > 0
    ? filePaths.map(p => `[Attached file: \`${p}\`]`).join("\n") + "\n"
    : "";

  // Handle /gsd status — show dashboard inline (no streaming guard — this is local UI only)
  if (text.toLowerCase() === "/gsd status") {
    state.entries.push({
      id: nextId(),
      type: "user",
      text: "/gsd status",
      timestamp: Date.now(),
    });
    pruneOldEntries(messagesContainer);
    welcomeScreen.classList.add('gsd-hidden');
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer, true);
    promptInput.value = "";
    autoResize();
    // Show loading spinner while fetching dashboard
    const loader = document.createElement("div");
    loader.className = "gsd-dashboard";
    loader.innerHTML = `<div class="gsd-loading-spinner"><div class="gsd-spinner"></div> Loading dashboard...</div>`;
    messagesContainer.appendChild(loader);
    scrollToBottom(messagesContainer, true);
    vscode.postMessage({ type: "get_dashboard" });
    return;
  }

  // Handle /gsd visualize — open workflow visualizer overlay
  if (text.toLowerCase() === "/gsd visualize" || text.toLowerCase() === "/gsd visualise") {
    promptInput.value = "";
    autoResize();
    visualizer.show();
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
    pruneOldEntries(messagesContainer);
    welcomeScreen.classList.add('gsd-hidden');
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer, true);

    vscode.postMessage({ type: "run_bash", command: bashCmd });
    promptInput.value = "";
    autoResize();
    return;
  }

  // If streaming — steer (but slash commands always go as prompt so
  // the extension host can abort-and-resend reliably)
  const isSlashCommand = text.startsWith("/");
  if (state.isStreaming && !isSlashCommand) {
    state.entries.push({
      id: nextId(),
      type: "user",
      text,
      images: state.images.length > 0 ? [...state.images] : undefined,
      isSteer: true,
      timestamp: Date.now(),
    });
    pruneOldEntries(messagesContainer);
    welcomeScreen.classList.add('gsd-hidden');
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer, true);

    // Show steer note (only one at a time)
    const existingNote = messagesContainer.querySelector(".gsd-steer-note");
    if (!existingNote) {
      const steerNote = document.createElement("div");
      steerNote.className = "gsd-steer-note";
      steerNote.textContent = "⚡ Redirecting agent...";
      messagesContainer.appendChild(steerNote);
    }
    scrollToBottom(messagesContainer, true);

    vscode.postMessage({
      type: "steer",
      message: text,
      images: state.images.length > 0 ? [...state.images] : undefined,
    } as WebviewToExtensionMessage);

    promptInput.value = "";
    state.images = [];
    persistAttachments();
    fileHandling.renderImagePreviews();
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
    pruneOldEntries(messagesContainer);
    welcomeScreen.classList.add('gsd-hidden');
    renderer.renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom(messagesContainer, true);
    // Show thinking dots immediately so the user sees feedback on send.
    // isPending shows dots + logo glow but keeps the send button as-is.
    // The button only flips to stop when the backend confirms activity
    // (agent_start, streaming content, auto_progress, etc.), preserving
    // the button as a canary for broken connections.
    renderer.showPendingDots();
    state.isPending = true;
    updateInputUI();
  }

  const fullMessage = filePrefix + text;
  const msg: WebviewToExtensionMessage = {
    type: "prompt",
    message: fullMessage,
    images: state.images.length > 0 ? [...state.images] : undefined,
  };
  console.debug(`[gsd:send] Sending prompt, images: ${msg.images?.length ?? 0}${msg.images ? `, total base64 chars: ${msg.images.reduce((s, i) => s + i.data.length, 0)}` : ""}`);
  vscode.postMessage(msg);

  promptInput.value = "";
  state.images = [];
  state.files = [];
  persistAttachments();
  fileHandling.renderImagePreviews();
  fileHandling.renderFileChips();
  autoResize();
}

(globalThis as any).__gsdSendMessage = sendMessage;

// Keyboard & click handlers are in keyboard.ts



// UI update functions are in ui-updates.ts
const { updateAllUI, updateHeaderUI, updateFooterUI, updateInputUI, updateOverlayIndicators, updateWorkflowBadge, handleModelRouted } = uiUpdates;

// Dashboard functions are in dashboard.ts



// Message handler is in message-handler.ts

// ============================================================
// Initialize modules
// ============================================================

uiUpdates.init({
  vscode,
  modelBadge,
  thinkingBadge,
  headerSep1,
  costBadge,
  contextBadge,
  contextBarContainer,
  contextBar,
  footerCwd,
  sendBtn,
  sendIcon,
  promptInput,
  inputHint,
  overlayIndicators,
});

dashboard.init({
  messagesContainer,
  welcomeScreen,
  welcomeProcess,
  welcomeModel,
  welcomeHints,
});

// Initialize auto-progress widget
autoProgressWidget.init();

// Initialize workflow visualizer
visualizer.init({ vscode });

fileHandling.init({
  root,
  imagePreview,
  promptInput,
  vscode,
  onSendMessage: sendMessage,
});

keyboard.init({
  vscode,
  messagesContainer,
  welcomeScreen,
  promptInput,
  sendBtn,
  headerVersion,
  newConvoBtn: newConvoBtn,
  compactBtn,
  exportBtn,
  attachBtn,
  thinkingBadge,
  sendMessage,
  updateAllUI,
  autoResize,
});

messageHandler.init({
  vscode,
  messagesContainer,
  welcomeScreen,
  promptInput,
  updateAllUI,
  updateHeaderUI,
  updateFooterUI,
  updateInputUI,
  updateOverlayIndicators,
  updateWorkflowBadge,
  handleModelRouted,
  autoResize,
});

slashMenu.init({
  slashMenuEl: slashMenuEl,
  promptInput,
  vscode,
  onAutoResize: autoResize,
  onShowModelPicker: modelPicker.show,
  onNewConversation: keyboard.handleNewConversation,
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
          messageHandler.addSystemEntry("Last assistant message copied to clipboard.", "info");
          return;
        }
      }
    }
    messageHandler.addSystemEntry("No assistant message to copy.", "warning");
  },
  onToggleAutoCompact: () => {
    const current = state.sessionStats.autoCompactionEnabled;
    const newValue = !current;
    vscode.postMessage({ type: "set_auto_compaction", enabled: newValue });
    state.sessionStats.autoCompactionEnabled = newValue;
    messageHandler.addSystemEntry(`Auto-compaction ${newValue ? "enabled" : "disabled"}.`, "info");
  },
  onToggleAutoRetry: () => {
    const current = state.sessionStats.autoRetryEnabled ?? true;
    const newValue = !current;
    vscode.postMessage({ type: "set_auto_retry", enabled: newValue });
    state.sessionStats.autoRetryEnabled = newValue;
    messageHandler.addSystemEntry(`Auto-retry ${newValue ? "enabled" : "disabled"}.`, "info");
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
  _onSessionSwitched: () => {
    updateAllUI();
  },
  onNewConversation: keyboard.handleNewConversation,
  hasDraft: () => !!(promptInput.value.trim() || state.images.length > 0 || state.files.length > 0),
});

uiDialogs.init({
  messagesContainer,
  vscode,
  getDialogContainer: () => renderer.getCurrentTurnElement(),
});

toasts.init(document.getElementById("toastContainer")!);

renderer.init({
  messagesContainer,
  welcomeScreen,
});

// ============================================================
// Initialize
// ============================================================

const restored = rehydrateAttachments();
if (restored.hadImages) fileHandling.renderImagePreviews();
if (restored.hadFiles) fileHandling.renderFileChips();

vscode.postMessage({ type: "ready" });
vscode.postMessage({ type: "launch_gsd" });
promptInput.focus();
updateAllUI();

window.addEventListener("beforeunload", disposeAll);
