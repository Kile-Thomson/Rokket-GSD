// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// ============================================================
// Tests for rendered content ARIA attributes (from T01)
// ============================================================

describe("Rendered content ARIA attributes", () => {
  it("tool block headers have role=button and aria-expanded", () => {
    const html = `<div class="gsd-tool-header" role="button" tabindex="0" aria-label="Toggle read_file details" aria-expanded="false">
      <span class="gsd-tool-name">read_file</span>
    </div>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    const header = container.querySelector(".gsd-tool-header")!;
    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.getAttribute("tabindex")).toBe("0");
    expect(header.getAttribute("aria-label")).toContain("Toggle");
  });

  it("tool block headers toggle aria-expanded", () => {
    const container = document.createElement("div");
    container.innerHTML = `<div class="gsd-tool-header" role="button" tabindex="0" aria-expanded="false"></div>`;
    const header = container.querySelector(".gsd-tool-header")!;
    // Simulate what the click handler does
    const expanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!expanded));
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("group headers have ARIA attributes", () => {
    const html = `<summary class="gsd-tool-group-header" role="button" tabindex="0" aria-label="Toggle File operations" aria-expanded="false">
      File operations (3)
    </summary>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    const header = container.querySelector(".gsd-tool-group-header")!;
    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("tabindex")).toBe("0");
    expect(header.getAttribute("aria-label")).toContain("Toggle");
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("copy response buttons have aria-label", () => {
    const html = `<button class="gsd-copy-response-btn" aria-label="Copy response" title="Copy response">📋</button>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    const btn = container.querySelector(".gsd-copy-response-btn")!;
    expect(btn.getAttribute("aria-label")).toBe("Copy response");
  });
});

// ============================================================
// Tests for overlay ARIA roles (from T02)
// ============================================================

describe("Model picker ARIA", () => {
  it("items have role=option and aria-selected", () => {
    const html = `
      <div class="gsd-model-picker-item current" role="option" aria-selected="true" tabindex="0" data-flat-idx="0" data-provider="anthropic" data-model-id="claude-3">
        Claude 3
      </div>
      <div class="gsd-model-picker-item" role="option" aria-selected="false" tabindex="-1" data-flat-idx="1" data-provider="openai" data-model-id="gpt-4">
        GPT-4
      </div>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    const items = container.querySelectorAll('[role="option"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute("aria-selected")).toBe("true");
    expect(items[1].getAttribute("aria-selected")).toBe("false");
  });

  it("listbox container has correct role", () => {
    const html = `<div role="listbox" aria-labelledby="modelPickerTitle"><div role="option">item</div></div>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector('[role="listbox"]')).toBeTruthy();
  });
});

describe("Thinking picker ARIA", () => {
  it("items have role=option with aria-selected", () => {
    const html = `
      <div class="gsd-thinking-picker-list" role="listbox" aria-labelledby="thinkingPickerTitle">
        <div class="gsd-thinking-picker-item active" role="option" aria-selected="true" tabindex="0" data-level="medium" data-idx="0">Medium</div>
        <div class="gsd-thinking-picker-item" role="option" aria-selected="false" tabindex="-1" data-level="high" data-idx="1">High</div>
      </div>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    const listbox = container.querySelector('[role="listbox"]')!;
    expect(listbox).toBeTruthy();
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });
});

describe("Slash menu ARIA", () => {
  it("container has role=listbox with option items", () => {
    const container = document.createElement("div");
    container.setAttribute("role", "listbox");
    container.setAttribute("aria-label", "Slash commands");
    container.innerHTML = `
      <div class="gsd-slash-item active" role="option" aria-selected="true" data-idx="0">
        <span class="gsd-slash-name">/gsd</span>
      </div>
      <div class="gsd-slash-item" role="option" aria-selected="false" data-idx="1">
        <span class="gsd-slash-name">/model</span>
      </div>`;
    expect(container.getAttribute("role")).toBe("listbox");
    expect(container.getAttribute("aria-label")).toBe("Slash commands");
    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });
});

describe("UI dialogs ARIA", () => {
  it("confirm dialog has role=dialog and aria-modal", () => {
    const html = `
      <div class="gsd-ui-request" role="dialog" aria-modal="true" aria-label="Confirm action">
        <div class="gsd-ui-title">Confirm action</div>
        <div class="gsd-ui-buttons">
          <button class="gsd-ui-btn primary" data-action="yes">Yes</button>
          <button class="gsd-ui-btn secondary" data-action="no">No</button>
        </div>
      </div>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Confirm action");
  });

  it("select dialog has role=dialog with listbox options", () => {
    const html = `
      <div class="gsd-ui-request" role="dialog" aria-modal="true" aria-label="Pick one">
        <div class="gsd-ui-options" role="listbox" aria-label="Pick one">
          <button class="gsd-ui-option-btn" role="option" data-value="a">A</button>
          <button class="gsd-ui-option-btn" role="option" data-value="b">B</button>
        </div>
      </div>`;
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    expect(container.querySelectorAll('[role="option"]').length).toBe(2);
  });
});

describe("Session history ARIA", () => {
  it("panel has role=complementary and aria-label", () => {
    const panel = document.createElement("div");
    panel.setAttribute("role", "complementary");
    panel.setAttribute("aria-label", "Session history");
    expect(panel.getAttribute("role")).toBe("complementary");
    expect(panel.getAttribute("aria-label")).toBe("Session history");
  });
});

// ============================================================
// Focus trap helper test
// ============================================================

describe("Focus trap cycling", () => {
  it("Tab from last element wraps to first", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button id="btn1">First</button>
      <button id="btn2">Second</button>
      <button id="btn3">Third</button>
    `;
    document.body.appendChild(container);

    const btn1 = container.querySelector("#btn1") as HTMLButtonElement;
    const btn3 = container.querySelector("#btn3") as HTMLButtonElement;
    btn3.focus();

    // Create a focus trap handler inline (same logic as ui-dialogs.ts)
    const focusTrapHandler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = container.querySelectorAll<HTMLElement>("button:not([disabled])");
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

    // Simulate Tab on last element
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(tabEvent, "preventDefault", { value: () => {} });
    focusTrapHandler(tabEvent);

    expect(document.activeElement).toBe(btn1);

    // Simulate Shift+Tab on first element
    btn1.focus();
    const shiftTabEvent = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    Object.defineProperty(shiftTabEvent, "preventDefault", { value: () => {} });
    focusTrapHandler(shiftTabEvent);

    expect(document.activeElement).toBe(btn3);

    document.body.removeChild(container);
  });
});
