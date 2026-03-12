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
// Public API
// ============================================================

export function handleRequest(data: any): void {
  const id = data.id;
  const method = data.method;

  const wrapper = document.createElement("div");
  wrapper.className = "gsd-entry gsd-entry-ui-request";
  wrapper.dataset.uiId = id;

  if (method === "select") {
    const options: string[] = data.options || [];
    const title = data.title || "Select an option";
    wrapper.innerHTML = `
      <div class="gsd-ui-request">
        <div class="gsd-ui-title">${escapeHtml(title)}</div>
        ${data.message ? `<div class="gsd-ui-message">${escapeHtml(data.message)}</div>` : ""}
        <div class="gsd-ui-options">
          ${options.map((opt: string) =>
            `<button class="gsd-ui-option-btn" data-value="${escapeAttr(opt)}">${escapeHtml(opt)}</button>`
          ).join("")}
        </div>
        <button class="gsd-ui-cancel-btn">Skip</button>
      </div>
    `;

    wrapper.querySelectorAll(".gsd-ui-option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = (btn as HTMLElement).dataset.value!;
        vscode.postMessage({ type: "extension_ui_response", id, value });
        const shortTitle = title.split(":")[0]?.trim() || title;
        disableRequest(wrapper, `${shortTitle}: ${value}`);
      });
    });
    wrapper.querySelector(".gsd-ui-cancel-btn")!.addEventListener("click", () => {
      vscode.postMessage({ type: "extension_ui_response", id, cancelled: true });
      disableRequest(wrapper, "Cancelled");
    });
  } else if (method === "confirm") {
    wrapper.innerHTML = `
      <div class="gsd-ui-request">
        <div class="gsd-ui-title">${escapeHtml(data.title || "Confirm")}</div>
        ${data.message ? `<div class="gsd-ui-message">${escapeHtml(data.message)}</div>` : ""}
        <div class="gsd-ui-buttons">
          <button class="gsd-ui-btn primary" data-action="yes">Yes</button>
          <button class="gsd-ui-btn secondary" data-action="no">No</button>
        </div>
      </div>
    `;

    wrapper.querySelector('[data-action="yes"]')!.addEventListener("click", () => {
      vscode.postMessage({ type: "extension_ui_response", id, confirmed: true });
      disableRequest(wrapper, "Confirmed: Yes");
    });
    wrapper.querySelector('[data-action="no"]')!.addEventListener("click", () => {
      vscode.postMessage({ type: "extension_ui_response", id, confirmed: false });
      disableRequest(wrapper, "Confirmed: No");
    });
  } else if (method === "input") {
    wrapper.innerHTML = `
      <div class="gsd-ui-request">
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
      vscode.postMessage({ type: "extension_ui_response", id, value: input.value });
      disableRequest(wrapper, `Submitted: ${input.value}`);
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        vscode.postMessage({ type: "extension_ui_response", id, cancelled: true });
        disableRequest(wrapper, "Cancelled");
      }
    });
    wrapper.querySelector('[data-action="submit"]')!.addEventListener("click", submit);
    wrapper.querySelector('[data-action="cancel"]')!.addEventListener("click", () => {
      vscode.postMessage({ type: "extension_ui_response", id, cancelled: true });
      disableRequest(wrapper, "Cancelled");
    });
  }

  messagesContainer.appendChild(wrapper);
  scrollToBottom(messagesContainer);
}

// ============================================================
// Internal
// ============================================================

function disableRequest(wrapper: HTMLElement, summary: string): void {
  wrapper.classList.add("resolved");
  const req = wrapper.querySelector(".gsd-ui-request");
  if (req) {
    const icon = summary.startsWith("Cancelled") ? "⊘" :
                 summary.startsWith("Confirmed: No") ? "✗" : "✓";
    const cssClass = summary.startsWith("Cancelled") ? "cancelled" :
                     summary.startsWith("Confirmed: No") ? "rejected" : "accepted";
    req.innerHTML = `<div class="gsd-ui-resolved ${cssClass}"><span class="gsd-ui-resolved-icon">${icon}</span> ${escapeHtml(summary)}</div>`;
  }
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
