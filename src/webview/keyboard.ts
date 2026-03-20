// ============================================================
// Keyboard & Click Handlers
// ============================================================

import type { WebviewToExtensionMessage } from "../shared/types";
import { scrollToBottom, sanitizeUrl } from "./helpers";
import { state } from "./state";
import { createFocusTrap, saveFocus, restoreFocus } from "./a11y";
import * as slashMenu from "./slash-menu";
import * as modelPicker from "./model-picker";
import * as thinkingPicker from "./thinking-picker";
import * as sessionHistory from "./session-history";
import * as visualizer from "./visualizer";
import * as toasts from "./toasts";
import * as renderer from "./renderer";
// messageHandler used indirectly via callbacks

// ============================================================
// Dependencies — set via init()
// ============================================================

let vscode: { postMessage(msg: unknown): void };
let messagesContainer: HTMLElement;
let welcomeScreen: HTMLElement;
let promptInput: HTMLTextAreaElement;
let sendBtn: HTMLElement;
let headerVersion: HTMLElement;
let newConvoBtn: HTMLElement;
let compactBtn: HTMLElement;
let exportBtn: HTMLElement;
let attachBtn: HTMLElement;
let thinkingBadge: HTMLElement;

// Callbacks into index.ts
let sendMessage: () => void;
let updateAllUI: () => void;
let _autoResize: () => void;

// Focus trap state for settings dropdown and changelog
let settingsTrapHandler: ((e: KeyboardEvent) => void) | null = null;
let settingsNavHandler: ((e: KeyboardEvent) => void) | null = null;
let settingsTriggerEl: HTMLElement | null = null;
let changelogTrapHandler: ((e: KeyboardEvent) => void) | null = null;
let changelogNavHandler: ((e: KeyboardEvent) => void) | null = null;
let changelogTriggerEl: HTMLElement | null = null;

export interface KeyboardDeps {
  vscode: { postMessage(msg: unknown): void };
  messagesContainer: HTMLElement;
  welcomeScreen: HTMLElement;
  promptInput: HTMLTextAreaElement;
  sendBtn: HTMLElement;
  headerVersion: HTMLElement;
  newConvoBtn: HTMLElement;
  compactBtn: HTMLElement;
  exportBtn: HTMLElement;
  attachBtn: HTMLElement;
  thinkingBadge: HTMLElement;
  sendMessage: () => void;
  updateAllUI: () => void;
  autoResize: () => void;
}

export function init(deps: KeyboardDeps): void {
  vscode = deps.vscode;
  messagesContainer = deps.messagesContainer;
  welcomeScreen = deps.welcomeScreen;
  promptInput = deps.promptInput;
  sendBtn = deps.sendBtn;
  headerVersion = deps.headerVersion;
  newConvoBtn = deps.newConvoBtn;
  compactBtn = deps.compactBtn;
  exportBtn = deps.exportBtn;
  attachBtn = deps.attachBtn;
  thinkingBadge = deps.thinkingBadge;
  sendMessage = deps.sendMessage;
  updateAllUI = deps.updateAllUI;
  _autoResize = deps.autoResize;

  setupKeyboardHandlers();
  setupClickHandlers();
  setupButtonHandlers();
}

// ============================================================
// Keyboard handlers
// ============================================================

function setupKeyboardHandlers(): void {
  promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
    // Block prompt input while visualizer overlay is open
    if (visualizer.isVisible()) {
      e.preventDefault();
      return;
    }

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
        if (!state.isCompacting) sendMessage();
      }
    } else {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!state.isCompacting) sendMessage();
      }
    }
    if (e.key === "Escape" && state.isStreaming) {
      vscode.postMessage({ type: "interrupt" });
    }
  });

  // Global keyboard handler for overlay panels
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (visualizer.isVisible()) {
      if (visualizer.handleKeyDown(e)) return;
    }
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

  // Keyboard support for version badge (role="button")
  headerVersion.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      headerVersion.click();
    }
  });

  // Keyboard activation for role="button" elements (tool headers, group headers)
  messagesContainer.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") !== "button") return;
    e.preventDefault();
    target.click();
  });

  // Sync aria-expanded on <details> toggle for group headers
  messagesContainer.addEventListener("toggle", (e: Event) => {
    const details = e.target as HTMLDetailsElement;
    if (!details.classList.contains("gsd-tool-group")) return;
    const summary = details.querySelector(".gsd-tool-group-header");
    if (summary) {
      summary.setAttribute("aria-expanded", String(details.open));
    }
  }, true);

  // Copy handler
  document.addEventListener("copy", (_e: ClipboardEvent) => {
    const selection = window.getSelection()?.toString();
    if (selection) vscode.postMessage({ type: "copy_text", text: selection });
  });
}

// ============================================================
// Click handlers
// ============================================================

function setupClickHandlers(): void {
  /** Dismiss the changelog overlay, clean up listeners, restore focus */
  function dismissChangelog(): void {
    const el = document.getElementById("gsd-changelog");
    if (!el) return;
    if (changelogTrapHandler) {
      el.removeEventListener("keydown", changelogTrapHandler);
      changelogTrapHandler = null;
    }
    if (changelogNavHandler) {
      el.removeEventListener("keydown", changelogNavHandler);
      changelogNavHandler = null;
    }
    el.classList.add("dismissing");
    setTimeout(() => el.remove(), 300);
    restoreFocus(changelogTriggerEl);
    changelogTriggerEl = null;
  }

  // Version badge click → changelog
  headerVersion.addEventListener("click", () => {
    const existing = document.getElementById("gsd-changelog");
    if (existing) {
      dismissChangelog();
    } else {
      // Save focus before opening changelog
      changelogTriggerEl = saveFocus();

      // Show loading spinner while fetching
      const loader = document.createElement("div");
      loader.id = "gsd-changelog";
      loader.className = "gsd-changelog";
      loader.setAttribute("tabindex", "-1");
      loader.innerHTML = `
        <div class="gsd-changelog-header">
          <span class="gsd-changelog-title">📋 Changelog</span>
          <button class="gsd-changelog-close" aria-label="Close changelog">✕</button>
        </div>
        <div class="gsd-loading-spinner"><div class="gsd-spinner"></div> Loading...</div>
      `;

      // Apply focus trap to changelog
      changelogTrapHandler = createFocusTrap(loader);
      loader.addEventListener("keydown", changelogTrapHandler);

      // Keyboard navigation: Escape to close
      changelogNavHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          dismissChangelog();
        }
      };
      loader.addEventListener("keydown", changelogNavHandler);

      // Close button click
      loader.querySelector(".gsd-changelog-close")?.addEventListener("click", dismissChangelog);

      // Focus the close button (or the container if no close button)
      const closeBtn = loader.querySelector<HTMLElement>(".gsd-changelog-close");
      messagesContainer.appendChild(loader);
      scrollToBottom(messagesContainer, true);
      if (closeBtn) {
        closeBtn.focus();
      } else {
        loader.focus();
      }

      vscode.postMessage({ type: "get_changelog" } as WebviewToExtensionMessage);
    }
  });

  // Global click handlers (copy, file links, url links, tool toggles)
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
        const isExpanded = !block.classList.contains("collapsed");
        toolHeader.setAttribute("aria-expanded", String(isExpanded));
      }
      return;
    }

    // Stale echo expand/collapse
    const staleBar = target.closest(".gsd-stale-echo-bar") as HTMLElement | null;
    if (staleBar) {
      const entry = staleBar.closest(".gsd-stale-echo") as HTMLElement | null;
      if (entry) {
        const full = entry.querySelector(".gsd-stale-echo-full") as HTMLElement | null;
        if (full) {
          const isHidden = full.hidden;
          full.hidden = !isHidden;
          staleBar.setAttribute("aria-expanded", String(isHidden));
        }
      }
      return;
    }

    if (target.closest("#restartBtn")) {
      vscode.postMessage({ type: "launch_gsd" });
      return;
    }
  });
}

// ============================================================
// Button handlers
// ============================================================

function setupButtonHandlers(): void {
  sendBtn.addEventListener("click", () => {
    if (state.isCompacting) return;
    if (state.isStreaming) {
      vscode.postMessage({ type: "interrupt" });
    } else {
      sendMessage();
    }
  });

  newConvoBtn.addEventListener("click", handleNewConversation);

  compactBtn.addEventListener("click", () => {
    if (!state.isStreaming) {
      vscode.postMessage({ type: "compact_context" });
      toasts.show("Compacting context…");
    }
  });

  exportBtn.addEventListener("click", () => {
    // Collect all stylesheet rules from the page
    let allCss = "";
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          allCss += rule.cssText + "\n";
        }
      } catch { /* cross-origin sheets */ }
    }
    vscode.postMessage({
      type: "export_html",
      html: messagesContainer.innerHTML,
      css: allCss,
    });
    toasts.show("Exporting conversation…");
  });

  attachBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "attach_files" });
  });

  // Settings dropdown
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsDropdown = document.getElementById("settingsDropdown");
  const settingsWrapper = document.getElementById("settingsWrapper");
  if (settingsBtn && settingsDropdown && settingsWrapper) {
    /** Close settings dropdown: remove listeners and restore focus */
    function closeSettingsDropdown(): void {
      settingsDropdown!.classList.remove("open");
      settingsBtn!.setAttribute("aria-expanded", "false");
      if (settingsTrapHandler) {
        settingsDropdown!.removeEventListener("keydown", settingsTrapHandler);
        settingsTrapHandler = null;
      }
      if (settingsNavHandler) {
        settingsDropdown!.removeEventListener("keydown", settingsNavHandler);
        settingsNavHandler = null;
      }
      restoreFocus(settingsTriggerEl);
      settingsTriggerEl = null;
    }

    /** Select a theme option: update state, apply theme, close dropdown */
    function selectSettingsOption(option: HTMLElement): void {
      const theme = option.dataset.theme!;
      if (theme === state.theme) {
        closeSettingsDropdown();
        return;
      }

      // Update active state
      settingsDropdown!.querySelectorAll(".gsd-settings-option").forEach(el => {
        el.classList.remove("active");
        el.setAttribute("aria-checked", "false");
      });
      option.classList.add("active");
      option.setAttribute("aria-checked", "true");

      // Apply and persist
      state.theme = theme;
      document.querySelector(".gsd-app")?.setAttribute("data-theme", theme);
      vscode.postMessage({ type: "set_theme", theme } as WebviewToExtensionMessage);

      closeSettingsDropdown();
    }

    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = settingsDropdown.classList.toggle("open");
      settingsBtn.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        // Save focus and apply focus trap
        settingsTriggerEl = saveFocus();
        settingsTrapHandler = createFocusTrap(settingsDropdown);
        settingsDropdown.addEventListener("keydown", settingsTrapHandler);

        // Keyboard navigation: roving tabindex on options
        const options = settingsDropdown.querySelectorAll<HTMLElement>(".gsd-settings-option");
        if (options.length > 0) {
          // Find the active (checked) option index, default to 0
          let activeIndex = 0;
          options.forEach((el, i) => {
            if (el.classList.contains("active") || el.getAttribute("aria-checked") === "true") {
              activeIndex = i;
            }
          });

          function focusOption(index: number): void {
            options.forEach((el, i) => {
              el.tabIndex = i === index ? 0 : -1;
              if (i === index) {
                el.classList.add("focused");
                el.focus();
              } else {
                el.classList.remove("focused");
              }
            });
          }

          // Set initial tabindex and focus the active option
          focusOption(activeIndex);

          settingsNavHandler = (e: KeyboardEvent) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              activeIndex = (activeIndex + 1) % options.length;
              focusOption(activeIndex);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              activeIndex = (activeIndex - 1 + options.length) % options.length;
              focusOption(activeIndex);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const focused = options[activeIndex];
              if (focused) selectSettingsOption(focused);
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeSettingsDropdown();
            }
          };
          settingsDropdown.addEventListener("keydown", settingsNavHandler);
        }
      } else {
        closeSettingsDropdown();
      }
    });

    // Theme option clicks
    settingsDropdown.addEventListener("click", (e) => {
      const option = (e.target as HTMLElement).closest("[data-theme]") as HTMLElement | null;
      if (!option) return;
      selectSettingsOption(option);
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!settingsWrapper.contains(e.target as Node)) {
        closeSettingsDropdown();
      }
    });
  }

  // Thinking badge click is handled by thinkingPicker.init()
  thinkingBadge.style.cursor = "pointer";
}

export function handleNewConversation(): void {
  vscode.postMessage({ type: "new_conversation" });
  state.entries = [];
  state.currentTurn = null;
  renderer.resetStreamingState();
  state.sessionStats = {};
  renderer.clearMessages();
  welcomeScreen.classList.remove("gsd-hidden");
  sessionHistory.hide();
  modelPicker.hide();
  updateAllUI();
}
