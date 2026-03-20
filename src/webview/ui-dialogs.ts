// ============================================================
// UI Dialogs — inline confirm/select/input rendered in chat
// ============================================================

import { escapeHtml, escapeAttr, scrollToBottom } from "./helpers";

// ============================================================
// Dependencies injected via init()
// ============================================================

let messagesContainer: HTMLElement;
let vscode: { postMessage(msg: unknown): void };

// ============================================================
// Pending dialog tracking
// ============================================================

/** Map of request ID → wrapper element for dialogs still awaiting user input */
const pendingDialogs = new Map<string, HTMLElement>();

/**
 * Expire all pending dialogs — the backend has already auto-resolved them
 * (via abort signal or timeout). Mark them visually so the user knows
 * they can no longer interact.
 */
export function expireAllPending(reason: string = "Agent moved on"): void {
  for (const [_id, wrapper] of pendingDialogs) {
    if (!wrapper.classList.contains("resolved")) {
      // Auto-resolve linked duplicates with cancelled response
      const linkedIds = (wrapper as any).__linkedIds as string[] | undefined;
      if (linkedIds) {
        for (const linkedId of linkedIds) {
          vscode.postMessage({ type: "extension_ui_response", id: linkedId, cancelled: true });
        }
        (wrapper as any).__linkedIds = [];
      }
      disableRequest(wrapper, `Expired: ${reason}`);
    }
  }
  pendingDialogs.clear();
  pendingFingerprints.clear();
  // Don't clear resolvedResponses here — they protect against loops
  // even across expire cycles
}

/**
 * Clear all dialog state — pending, fingerprints, and resolved cache.
 * Called on new conversation to ensure a clean slate.
 */
export function clearAllDialogState(): void {
  pendingDialogs.clear();
  pendingFingerprints.clear();
  resolvedResponses.clear();
}

/**
 * Check if there are any pending (unresolved) dialogs.
 */
export function hasPending(): boolean {
  return pendingDialogs.size > 0;
}

// ============================================================
// Public API
// ============================================================

/** Track the element that had focus before a dialog appeared, for restoration */
let preFocusEl: HTMLElement | null = null;

/**
 * Focus trap helper: cycles Tab/Shift+Tab within a container.
 * Returns a keydown handler to attach to the container.
 */
function createFocusTrap(container: HTMLElement): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusable = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
}

/**
 * Build a fingerprint for a dialog request so we can detect duplicates.
 * Two dialogs are considered duplicates if they have the same method, title,
 * message, and options — even if their IDs differ.
 */
function dialogFingerprint(data: any): string {
  const parts = [
    data.method || "",
    data.title || "",
    data.message || "",
  ];
  if (data.options) {
    parts.push(JSON.stringify(data.options));
  }
  return parts.join("|");
}

/** Fingerprints of currently pending (unresolved) dialogs */
const pendingFingerprints = new Map<string, string>(); // fingerprint → request id

/**
 * Recently resolved dialog responses — keyed by fingerprint.
 * When gsd-pi re-asks the same question within RESOLVED_TTL_MS (e.g. the
 * "Interrupted Session Detected" loop), we auto-respond with the same
 * answer instead of rendering a new dialog. Entries expire after 10 seconds.
 */
const resolvedResponses = new Map<string, { response: Record<string, unknown>; expiresAt: number }>();
const RESOLVED_TTL_MS = 10_000;

export function handleRequest(data: any): void {
  const id = data.id;
  const method = data.method;

  // Dedup phase 1: if the same dialog was resolved recently, auto-replay
  // the user's previous answer. This breaks the loop where gsd-pi keeps
  // re-asking the same question after receiving a valid response.
  const fp = dialogFingerprint(data);

  const cached = resolvedResponses.get(fp);
  if (cached && Date.now() < cached.expiresAt) {
    // Replay with this request's ID
    vscode.postMessage({ ...cached.response, id });
    return;
  }
  // Clean expired entries opportunistically
  if (cached) resolvedResponses.delete(fp);

  // Dedup phase 2: if an identical dialog is already pending, link this
  // request to it — when the original is resolved, we'll send the same
  // response for this one too. This prevents the "triple confirmation"
  // problem where the agent calls ask_user_questions multiple times for
  // the same question.
  const existingId = pendingFingerprints.get(fp);
  if (existingId && pendingDialogs.has(existingId)) {
    // Link this request to the existing dialog — when the original is resolved,
    // we'll send the same response for this one too.
    const existing = pendingDialogs.get(existingId)!;
    if (!(existing as any).__linkedIds) (existing as any).__linkedIds = [];
    (existing as any).__linkedIds.push(id);
    return;
  }
  pendingFingerprints.set(fp, id);

  // Save focus origin for restoration
  preFocusEl = document.activeElement as HTMLElement | null;

  const wrapper = document.createElement("div");
  wrapper.className = "gsd-entry gsd-entry-ui-request";
  wrapper.dataset.uiId = id;

  if (method === "select") {
    const options: string[] = data.options || [];
    const title = data.title || "Select an option";
    const allowMultiple = !!data.allowMultiple;

    if (allowMultiple) {
      buildMultiSelect(wrapper, id, title, data.message, options);
    } else {
      buildSingleSelect(wrapper, id, title, data.message, options);
    }
  } else if (method === "confirm") {
    wrapper.innerHTML = `
      <div class="gsd-ui-request" role="dialog" aria-modal="true" aria-label="${escapeAttr(data.title || "Confirm")}">
        <div class="gsd-ui-title">${escapeHtml(data.title || "Confirm")}</div>
        ${data.message ? `<div class="gsd-ui-message">${escapeHtml(data.message)}</div>` : ""}
        <div class="gsd-ui-buttons">
          <button class="gsd-ui-btn primary" data-action="yes">Yes</button>
          <button class="gsd-ui-btn secondary" data-action="no">No</button>
        </div>
      </div>
    `;

    wrapper.querySelector('[data-action="yes"]')!.addEventListener("click", () => {
      sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, confirmed: true });
      disableRequest(wrapper, "Confirmed: Yes");
    });
    wrapper.querySelector('[data-action="no"]')!.addEventListener("click", () => {
      sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, confirmed: false });
      disableRequest(wrapper, "Confirmed: No");
    });
  } else if (method === "input") {
    wrapper.innerHTML = `
      <div class="gsd-ui-request" role="dialog" aria-modal="true" aria-label="${escapeAttr(data.title || "Input")}">
        <div class="gsd-ui-title">${escapeHtml(data.title || "Input")}</div>
        <input type="text" class="gsd-ui-input" placeholder="${escapeAttr(data.placeholder || "")}" value="${escapeAttr(data.prefill || "")}" />
        <div class="gsd-ui-buttons">
          <button class="gsd-ui-btn primary" data-action="submit">Submit</button>
          <button class="gsd-ui-btn secondary" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;

    const input = wrapper.querySelector(".gsd-ui-input") as HTMLInputElement;
    setTimeout(() => input.focus(), 50);

    const submit = () => {
      sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, value: input.value });
      disableRequest(wrapper, `Submitted: ${input.value}`);
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, cancelled: true });
        disableRequest(wrapper, "Cancelled");
      }
    });
    wrapper.querySelector('[data-action="submit"]')!.addEventListener("click", submit);
    wrapper.querySelector('[data-action="cancel"]')!.addEventListener("click", () => {
      sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, cancelled: true });
      disableRequest(wrapper, "Cancelled");
    });
  }

  // Track this dialog as pending
  pendingDialogs.set(id, wrapper);

  // If the backend specified a timeout, show a countdown and auto-expire.
  // We expire 2s early to avoid the race where the user clicks at T=29s
  // but the backend already resolved at T=30s. Better to show "expired"
  // than to silently eat the user's click.
  const timeout = data.timeout as number | undefined;
  if (timeout && timeout > 0) {
    const safeTimeout = Math.max(timeout - 2000, 1000);
    startTimeoutCountdown(wrapper, id, safeTimeout);
  }

  messagesContainer.appendChild(wrapper);
  scrollToBottom(messagesContainer, true);

  // Set up focus trap on the dialog request element
  const reqEl = wrapper.querySelector(".gsd-ui-request") as HTMLElement | null;
  if (reqEl) {
    reqEl.addEventListener("keydown", createFocusTrap(reqEl));
    // Focus first focusable element
    const firstFocusable = reqEl.querySelector<HTMLElement>(
      'input:not([disabled]), button:not([disabled])'
    );
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 50);
    }
  }
}

// ============================================================
// Single-select — click an option to submit immediately
// ============================================================

function buildSingleSelect(
  wrapper: HTMLElement, id: string, title: string, message: string | undefined, options: string[]
): void {
  wrapper.innerHTML = `
    <div class="gsd-ui-request" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
      <div class="gsd-ui-title">${escapeHtml(title)}</div>
      ${message ? `<div class="gsd-ui-message">${escapeHtml(message)}</div>` : ""}
      <div class="gsd-ui-options" role="listbox" aria-label="${escapeAttr(title)}">
        ${options.map((opt: string) =>
          `<button class="gsd-ui-option-btn" role="option" data-value="${escapeAttr(opt)}">${escapeHtml(opt)}</button>`
        ).join("")}
      </div>
      <button class="gsd-ui-cancel-btn">Skip</button>
    </div>
  `;

  wrapper.querySelectorAll(".gsd-ui-option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = (btn as HTMLElement).dataset.value!;
      sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, value });
      const shortTitle = title.split(":")[0]?.trim() || title;
      disableRequest(wrapper, `${shortTitle}: ${value}`);
    });
  });
  wrapper.querySelector(".gsd-ui-cancel-btn")!.addEventListener("click", () => {
    sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, cancelled: true });
    disableRequest(wrapper, "Cancelled");
  });
}

// ============================================================
// Multi-select — toggle options with checkboxes, confirm with button
// ============================================================

function buildMultiSelect(
  wrapper: HTMLElement, id: string, title: string, message: string | undefined, options: string[]
): void {
  const selected = new Set<string>();

  wrapper.innerHTML = `
    <div class="gsd-ui-request" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
      <div class="gsd-ui-title">${escapeHtml(title)}</div>
      <div class="gsd-ui-multi-hint">Click to toggle, then confirm</div>
      ${message ? `<div class="gsd-ui-message">${escapeHtml(message)}</div>` : ""}
      <div class="gsd-ui-options gsd-ui-multi-options" role="listbox" aria-label="${escapeAttr(title)}" aria-multiselectable="true">
        ${options.map((opt: string) =>
          `<button class="gsd-ui-option-btn gsd-ui-multi-option" role="option" aria-selected="false" data-value="${escapeAttr(opt)}">
            <span class="gsd-ui-checkbox">☐</span>
            <span class="gsd-ui-option-label">${escapeHtml(opt)}</span>
          </button>`
        ).join("")}
      </div>
      <div class="gsd-ui-multi-actions">
        <span class="gsd-ui-multi-count">0 selected</span>
        <div class="gsd-ui-buttons">
          <button class="gsd-ui-btn primary gsd-ui-multi-confirm" disabled>Confirm</button>
          <button class="gsd-ui-btn secondary gsd-ui-multi-cancel">Skip</button>
        </div>
      </div>
    </div>
  `;

  const countEl = wrapper.querySelector(".gsd-ui-multi-count")!;
  const confirmBtn = wrapper.querySelector(".gsd-ui-multi-confirm") as HTMLButtonElement;

  function updateCount(): void {
    const n = selected.size;
    countEl.textContent = `${n} selected`;
    confirmBtn.disabled = n === 0;
  }

  wrapper.querySelectorAll(".gsd-ui-multi-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = (btn as HTMLElement).dataset.value!;
      const checkbox = btn.querySelector(".gsd-ui-checkbox")!;
      if (selected.has(value)) {
        selected.delete(value);
        btn.classList.remove("checked");
        btn.setAttribute("aria-selected", "false");
        checkbox.textContent = "☐";
      } else {
        selected.add(value);
        btn.classList.add("checked");
        btn.setAttribute("aria-selected", "true");
        checkbox.textContent = "☑";
      }
      updateCount();
    });
  });

  confirmBtn.addEventListener("click", () => {
    if (selected.size === 0) return;
    const values = Array.from(selected);
    sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, value: values.join(", "), values });
    const shortTitle = title.split(":")[0]?.trim() || title;
    disableRequest(wrapper, `${shortTitle}: ${values.join(", ")}`);
  });

  wrapper.querySelector(".gsd-ui-multi-cancel")!.addEventListener("click", () => {
    sendResponseWithLinked(wrapper, id, { type: "extension_ui_response", id, cancelled: true });
    disableRequest(wrapper, "Cancelled");
  });
}

// ============================================================
// Internal
// ============================================================

/**
 * Send a UI response for the primary dialog AND all linked duplicate dialogs.
 * Each linked ID gets an identical response (with its own ID substituted).
 * Also caches the response by fingerprint so repeated identical requests
 * from gsd-pi are auto-answered without re-rendering.
 */
function sendResponseWithLinked(wrapper: HTMLElement, primaryId: string, response: Record<string, unknown>): void {
  // Send primary response
  vscode.postMessage(response);

  // Cache this response by fingerprint so re-asks within RESOLVED_TTL_MS
  // are auto-answered (breaks the gsd-pi "ask same question in a loop" bug)
  const uiId = wrapper.dataset.uiId;
  if (uiId) {
    for (const [fp, fId] of pendingFingerprints) {
      if (fId === uiId) {
        resolvedResponses.set(fp, { response, expiresAt: Date.now() + RESOLVED_TTL_MS });
        break;
      }
    }
  }

  // Send responses for any linked duplicate dialogs
  const linkedIds = (wrapper as any).__linkedIds as string[] | undefined;
  if (linkedIds && linkedIds.length > 0) {
    for (const linkedId of linkedIds) {
      vscode.postMessage({ ...response, id: linkedId });
    }
    (wrapper as any).__linkedIds = [];
  }
}

function disableRequest(wrapper: HTMLElement, summary: string): void {
  wrapper.classList.add("resolved");

  // Restore focus to element that was active before the dialog
  if (preFocusEl && typeof preFocusEl.focus === "function") {
    preFocusEl.focus();
    preFocusEl = null;
  }

  // Remove from pending tracking and fingerprint dedup
  const uiId = wrapper.dataset.uiId;
  if (uiId) {
    pendingDialogs.delete(uiId);
    // Clean up fingerprint entry
    for (const [fp, fId] of pendingFingerprints) {
      if (fId === uiId) {
        pendingFingerprints.delete(fp);
        break;
      }
    }
  }

  // Clear any active timeout countdown
  const timerId = (wrapper as any).__timeoutTimer;
  if (timerId) {
    clearInterval(timerId);
    (wrapper as any).__timeoutTimer = null;
  }

  const req = wrapper.querySelector(".gsd-ui-request");
  if (req) {
    const icon = summary.startsWith("Cancelled") ? "⊘" :
                 summary.startsWith("Expired") ? "⏱" :
                 summary.startsWith("Confirmed: No") ? "✗" : "✓";
    const cssClass = summary.startsWith("Cancelled") ? "cancelled" :
                     summary.startsWith("Expired") ? "expired" :
                     summary.startsWith("Confirmed: No") ? "rejected" : "accepted";
    req.innerHTML = `<div class="gsd-ui-resolved ${cssClass}"><span class="gsd-ui-resolved-icon">${icon}</span> ${escapeHtml(summary)}</div>`;
  }
}

/**
 * Show a countdown timer on a dialog that has a backend timeout.
 * This gives the user visual feedback that they need to act soon.
 */
function startTimeoutCountdown(wrapper: HTMLElement, id: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;

  // Add a countdown element to the request
  const req = wrapper.querySelector(".gsd-ui-request");
  if (!req) return;

  const countdownEl = document.createElement("div");
  countdownEl.className = "gsd-ui-countdown";
  req.prepend(countdownEl);

  const updateCountdown = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      clearInterval(timer);
      (wrapper as any).__timeoutTimer = null;
      // Don't auto-send a response — the backend already auto-resolved.
      // Just mark it visually as expired.
      if (!wrapper.classList.contains("resolved")) {
        disableRequest(wrapper, "Expired: Timed out");
      }
      return;
    }
    const secs = Math.ceil(remaining / 1000);
    countdownEl.textContent = `⏱ ${secs}s`;
    // Add urgency class when under 10s
    if (secs <= 10) {
      countdownEl.classList.add("urgent");
    }
  };

  updateCountdown();
  const timer = setInterval(updateCountdown, 1000);
  (wrapper as any).__timeoutTimer = timer;
}

// ============================================================
// Init
// ============================================================

export interface UiDialogsDeps {
  messagesContainer: HTMLElement;
  vscode: { postMessage(msg: unknown): void };
}

export function init(deps: UiDialogsDeps): void {
  messagesContainer = deps.messagesContainer;
  vscode = deps.vscode;
}
