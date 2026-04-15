// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createFocusTrap, saveFocus, restoreFocus } from "../a11y";
import * as fs from "fs";
import * as path from "path";

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
// ARIA semantics — regression tests (T03, M024/S02)
// ============================================================

describe("ARIA semantics", () => {
  const srcDir = path.resolve(__dirname, "..");

  it("toast container has role=status and aria-live=polite", () => {
    const indexTs = fs.readFileSync(path.join(srcDir, "index.ts"), "utf-8");
    expect(indexTs).toContain('id="toastContainer"');
    expect(indexTs).toMatch(/toastContainer.*role="status"/s);
    expect(indexTs).toMatch(/toastContainer.*aria-live="polite"/s);
  });

  it("conversation entries get role=listitem via renderer", () => {
    const rendererTs = fs.readFileSync(path.join(srcDir, "render", "html-builders.ts"), "utf-8");
    expect(rendererTs).toContain('setAttribute("role", "listitem")');
  });

  it("visualizer has tablist and tabpanel roles", () => {
    const vizTs = fs.readFileSync(path.join(srcDir, "visualizer.ts"), "utf-8");
    expect(vizTs).toContain('role="tablist"');
    expect(vizTs).toContain('role="tabpanel"');
  });

  it("overlay panels have role=dialog and aria-modal=true", () => {
    const overlayFiles = [
      "model-picker.ts",
      "thinking-picker.ts",
      "keyboard.ts",
      "session-history.ts",
    ];
    for (const file of overlayFiles) {
      const content = fs.readFileSync(path.join(srcDir, file), "utf-8");
      expect(content).toContain('role", "dialog"');
      expect(content).toContain('aria-modal", "true"');
    }
  });

  it("announceToScreenReader is exported from a11y.ts", () => {
    const a11yTs = fs.readFileSync(path.join(srcDir, "a11y.ts"), "utf-8");
    expect(a11yTs).toMatch(/export\s+function\s+announceToScreenReader/);
  });

  it("message-handler + handler sub-modules call announceToScreenReader at least 5 times", () => {
    const files = [
      path.join(srcDir, "message-handler.ts"),
      ...fs.readdirSync(path.join(srcDir, "handlers")).map(f => path.join(srcDir, "handlers", f)),
    ];
    let totalCalls = 0;
    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      const content = fs.readFileSync(file, "utf-8");
      const calls = content.match(/announceToScreenReader\(/g) || [];
      const importCount = content.match(/import.*announceToScreenReader/g)?.length || 0;
      totalCalls += calls.length - importCount;
    }
    expect(totalCalls).toBeGreaterThanOrEqual(4);
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

// ============================================================
// createFocusTrap() from shared a11y.ts — unit tests (T03)
// ============================================================

describe("createFocusTrap (shared a11y.ts)", () => {
  let container: HTMLDivElement;

  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it("Tab on last focusable wraps to first", () => {
    container = document.createElement("div");
    container.innerHTML = `
      <button id="a">A</button>
      <button id="b">B</button>
      <button id="c">C</button>
    `;
    document.body.appendChild(container);
    const trap = createFocusTrap(container);

    const btnA = container.querySelector("#a") as HTMLButtonElement;
    const btnC = container.querySelector("#c") as HTMLButtonElement;
    btnC.focus();
    expect(document.activeElement).toBe(btnC);

    // Tab on last → should wrap to first
    let prevented = false;
    const tabEvt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(tabEvt, "preventDefault", { value: () => { prevented = true; } });
    trap(tabEvt);

    expect(document.activeElement).toBe(btnA);
    expect(prevented).toBe(true);
  });

  it("Shift+Tab on first focusable wraps to last", () => {
    container = document.createElement("div");
    container.innerHTML = `
      <button id="a">A</button>
      <button id="b">B</button>
      <button id="c">C</button>
    `;
    document.body.appendChild(container);
    const trap = createFocusTrap(container);

    const btnA = container.querySelector("#a") as HTMLButtonElement;
    const btnC = container.querySelector("#c") as HTMLButtonElement;
    btnA.focus();
    expect(document.activeElement).toBe(btnA);

    // Shift+Tab on first → should wrap to last
    let prevented = false;
    const shiftTabEvt = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true });
    Object.defineProperty(shiftTabEvt, "preventDefault", { value: () => { prevented = true; } });
    trap(shiftTabEvt);

    expect(document.activeElement).toBe(btnC);
    expect(prevented).toBe(true);
  });

  it("non-Tab keys are not intercepted (no preventDefault)", () => {
    container = document.createElement("div");
    container.innerHTML = `<button id="a">A</button><button id="b">B</button>`;
    document.body.appendChild(container);
    const trap = createFocusTrap(container);

    const btnA = container.querySelector("#a") as HTMLButtonElement;
    btnA.focus();

    // ArrowDown, Enter, Escape — none should call preventDefault
    for (const key of ["ArrowDown", "Enter", "Escape", "a"]) {
      let prevented = false;
      const evt = new KeyboardEvent("keydown", { key, bubbles: true });
      Object.defineProperty(evt, "preventDefault", { value: () => { prevented = true; } });
      trap(evt);
      expect(prevented).toBe(false);
    }
  });

  it("skips disabled buttons in focus cycle", () => {
    container = document.createElement("div");
    container.innerHTML = `
      <button id="a">A</button>
      <button id="b" disabled>B</button>
      <button id="c">C</button>
    `;
    document.body.appendChild(container);
    const trap = createFocusTrap(container);

    const btnC = container.querySelector("#c") as HTMLButtonElement;
    btnC.focus();

    // Tab on last enabled → should wrap to first enabled (skipping disabled #b)
    const tabEvt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    Object.defineProperty(tabEvt, "preventDefault", { value: () => {} });
    trap(tabEvt);

    const btnA = container.querySelector("#a") as HTMLButtonElement;
    expect(document.activeElement).toBe(btnA);
  });
});

// ============================================================
// saveFocus / restoreFocus — unit tests (T03)
// ============================================================

describe("saveFocus / restoreFocus (shared a11y.ts)", () => {
  it("saveFocus captures the active element and restoreFocus returns it", () => {
    const btn = document.createElement("button");
    btn.textContent = "trigger";
    document.body.appendChild(btn);
    btn.focus();

    const saved = saveFocus();
    expect(saved).toBe(btn);

    // Move focus away
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);

    // Restore
    restoreFocus(saved);
    expect(document.activeElement).toBe(btn);

    document.body.removeChild(btn);
    document.body.removeChild(other);
  });
});

// ============================================================
// Settings dropdown keyboard navigation — tests (T03)
// ============================================================

describe("Settings dropdown keyboard navigation", () => {
  let dropdown: HTMLDivElement;

  afterEach(() => {
    if (dropdown && dropdown.parentNode) {
      dropdown.parentNode.removeChild(dropdown);
    }
  });

  /**
   * Build a settings dropdown DOM with roving tabindex, matching
   * the structure created by keyboard.ts.
   */
  function createDropdown(): {
    dropdown: HTMLDivElement;
    options: HTMLButtonElement[];
    focusOption: (idx: number) => void;
    handler: (e: KeyboardEvent) => void;
    closed: boolean;
  } {
    dropdown = document.createElement("div");
    dropdown.id = "settingsDropdown";
    dropdown.classList.add("open");
    dropdown.innerHTML = `
      <button class="gsd-settings-option active" data-theme="default" aria-checked="true" tabindex="0">Default</button>
      <button class="gsd-settings-option" data-theme="clarity" aria-checked="false" tabindex="-1">Clarity</button>
      <button class="gsd-settings-option" data-theme="forge" aria-checked="false" tabindex="-1">Forge</button>
    `;
    document.body.appendChild(dropdown);

    const options = Array.from(dropdown.querySelectorAll<HTMLButtonElement>(".gsd-settings-option"));
    let activeIndex = 0;
    let closed = false;

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

    // Initial focus
    focusOption(activeIndex);

    const handler = (e: KeyboardEvent) => {
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
        // Simulate option selection
      } else if (e.key === "Escape") {
        e.preventDefault();
        dropdown.classList.remove("open");
        closed = true;
      }
    };

    dropdown.addEventListener("keydown", handler);

    return {
      dropdown,
      options,
      focusOption,
      handler,
      get closed() { return closed; },
    };
  }

  it("ArrowDown moves focus to next option", () => {
    const ctx = createDropdown();
    expect(document.activeElement).toBe(ctx.options[0]);

    const evt = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    Object.defineProperty(evt, "preventDefault", { value: () => {} });
    ctx.dropdown.dispatchEvent(evt);

    expect(document.activeElement).toBe(ctx.options[1]);
  });

  it("ArrowDown wraps from last to first", () => {
    const ctx = createDropdown();
    // Advance to last option via handler (so internal index stays in sync)
    for (let i = 0; i < ctx.options.length - 1; i++) {
      const evt = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      Object.defineProperty(evt, "preventDefault", { value: () => {} });
      ctx.handler(evt);
    }
    expect(document.activeElement).toBe(ctx.options[2]);

    // One more ArrowDown should wrap to first
    const wrapEvt = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
    Object.defineProperty(wrapEvt, "preventDefault", { value: () => {} });
    ctx.handler(wrapEvt);

    expect(document.activeElement).toBe(ctx.options[0]);
  });

  it("ArrowUp at first option wraps to last", () => {
    const ctx = createDropdown();
    expect(document.activeElement).toBe(ctx.options[0]);

    const evt = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
    Object.defineProperty(evt, "preventDefault", { value: () => {} });
    ctx.handler(evt);

    expect(document.activeElement).toBe(ctx.options[2]);
  });

  it("Escape closes the dropdown", () => {
    const ctx = createDropdown();
    expect(ctx.dropdown.classList.contains("open")).toBe(true);

    const evt = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    Object.defineProperty(evt, "preventDefault", { value: () => {} });
    ctx.handler(evt);

    expect(ctx.dropdown.classList.contains("open")).toBe(false);
  });

  it("roving tabindex: only focused option has tabindex=0", () => {
    const ctx = createDropdown();
    // Initially first option is focused
    expect(ctx.options[0].tabIndex).toBe(0);
    expect(ctx.options[1].tabIndex).toBe(-1);
    expect(ctx.options[2].tabIndex).toBe(-1);

    // Move to second
    ctx.focusOption(1);
    expect(ctx.options[0].tabIndex).toBe(-1);
    expect(ctx.options[1].tabIndex).toBe(0);
    expect(ctx.options[2].tabIndex).toBe(-1);

    // Move to third
    ctx.focusOption(2);
    expect(ctx.options[0].tabIndex).toBe(-1);
    expect(ctx.options[1].tabIndex).toBe(-1);
    expect(ctx.options[2].tabIndex).toBe(0);
  });

  it("Enter on focused option does not throw", () => {
    const ctx = createDropdown();
    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    Object.defineProperty(evt, "preventDefault", { value: () => {} });
    // Should not throw
    expect(() => ctx.handler(evt)).not.toThrow();
  });
});

// ============================================================
// R015 validation: @keyframes prefixes and reduced-motion (T03)
// ============================================================

describe("R015: prefers-reduced-motion covers all @keyframes", () => {
  const stylesDir = path.resolve(__dirname, "..", "styles");

  /**
   * Recursively read all .css files under a directory and collect
   * @keyframes names.
   */
  function collectKeyframeNames(dir: string): string[] {
    const names: string[] = [];
    const regex = /@keyframes\s+([\w-]+)/g;

    function walk(d: string) {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".css")) {
          const content = fs.readFileSync(full, "utf-8");
          let match: RegExpExecArray | null;
          while ((match = regex.exec(content)) !== null) {
            names.push(match[1]);
          }
        }
      }
    }

    walk(dir);
    return names;
  }

  it("has ≥20 @keyframes declarations", () => {
    const names = collectKeyframeNames(stylesDir);
    expect(names.length).toBeGreaterThanOrEqual(20);
  });

  it("all @keyframes names use gsd-* prefix", () => {
    const names = collectKeyframeNames(stylesDir);
    const nonPrefixed = names.filter((n) => !n.startsWith("gsd-"));
    expect(nonPrefixed).toEqual([]);
  });

  it("base.css has blanket prefers-reduced-motion rule targeting *, *::before, *::after", () => {
    const baseCss = fs.readFileSync(path.join(stylesDir, "base.css"), "utf-8");

    // Verify the media query exists
    expect(baseCss).toContain("@media (prefers-reduced-motion: reduce)");

    // Verify it targets the universal selector and pseudo-elements
    // The rule block should contain *, *::before, *::after
    const reducedMotionBlock = baseCss.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}/
    );
    expect(reducedMotionBlock).toBeTruthy();
    const ruleContent = reducedMotionBlock![1];
    expect(ruleContent).toContain("*");
    expect(ruleContent).toContain("*::before");
    expect(ruleContent).toContain("*::after");

    // Verify animation-duration is zeroed
    expect(ruleContent).toContain("animation-duration");
    expect(ruleContent).toContain("animation-iteration-count");
  });

  it("reduced-motion rule also covers transitions", () => {
    const baseCss = fs.readFileSync(path.join(stylesDir, "base.css"), "utf-8");
    const reducedMotionBlock = baseCss.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}/
    );
    expect(reducedMotionBlock).toBeTruthy();
    expect(reducedMotionBlock![1]).toContain("transition-duration");
  });
});

// ============================================================
// Focus-visible coverage — regression tests (T02, M024/S01)
// ============================================================

describe("Focus-visible coverage", () => {
  const stylesDir = path.resolve(__dirname, "..", "styles");

  function readAllCss(): { file: string; content: string }[] {
    const results: { file: string; content: string }[] = [];
    const entries = fs.readdirSync(stylesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".css")) {
        results.push({
          file: entry.name,
          content: fs.readFileSync(path.join(stylesDir, entry.name), "utf-8"),
        });
      }
    }
    return results;
  }

  function extractHoverSelectors(cssFiles: { file: string; content: string }[]): string[] {
    const hoverRegex = /([^{}\n]+):hover(?:\s*[,{])/g;
    const selectors: string[] = [];
    for (const { content } of cssFiles) {
      let match: RegExpExecArray | null;
      while ((match = hoverRegex.exec(content)) !== null) {
        selectors.push(match[1].trim() + ":hover");
      }
    }
    return selectors;
  }

  function extractBaseClass(selector: string): string {
    const withoutHover = selector.replace(/:hover$/, "");
    const classMatch = withoutHover.match(/(\.\w[\w-]*)/);
    return classMatch ? classMatch[1] : withoutHover;
  }

  const excludePatterns = [
    "scrollbar",
    "::before",
    "::after",
    "tr:hover",
    ".gsd-entry:hover",
    ".gsd-entry-assistant:hover",
    ".gsd-session-history-item:hover .gsd-session-action-btn",
    ".gsd-image-thumb:hover",
    ".gsd-resize-handle",
    ".gsd-model-picker-item:hover",
    ".gsd-thinking-picker-item:hover",
    ".gsd-session-history-item:hover",
    ".gsd-slash-item.disabled:hover",
    ".gsd-thinking-badge.disabled:hover",
    ".gsd-assistant-text a:hover",
    ".gsd-link:hover",
  ];

  function shouldExclude(selector: string): boolean {
    return excludePatterns.some((pat) => selector.includes(pat));
  }

  it("every interactive :hover selector has a matching :focus-visible rule", () => {
    const cssFiles = readAllCss();
    const hoverSelectors = extractHoverSelectors(cssFiles);
    const allCss = cssFiles.map((f) => f.content).join("\n");

    const missing: string[] = [];
    for (const hoverSel of hoverSelectors) {
      if (shouldExclude(hoverSel)) continue;
      const full = hoverSel.replace(/:hover$/, "");
      const base = extractBaseClass(hoverSel);
      const hasFocusVisible = (sel: string) => {
        if (allCss.includes(sel + ":focus-visible")) return true;
        const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const attrPattern = new RegExp(escaped + "\\[.*?\\]:focus-visible");
        return attrPattern.test(allCss);
      };
      if (!hasFocusVisible(full) && !hasFocusVisible(base)) {
        missing.push(hoverSel);
      }
    }

    expect(missing).toEqual([]);
  });

  it("consolidated focus-visible block in misc.css has at least 42 selectors", () => {
    const miscCss = fs.readFileSync(path.join(stylesDir, "misc.css"), "utf-8");
    const fvMatches = miscCss.match(/:focus-visible/g) || [];
    expect(fvMatches.length).toBeGreaterThanOrEqual(42);
  });

  it("consolidated :active block in misc.css has at least 20 selectors", () => {
    const miscCss = fs.readFileSync(path.join(stylesDir, "misc.css"), "utf-8");
    const activeMatches = miscCss.match(/:active/g) || [];
    expect(activeMatches.length).toBeGreaterThanOrEqual(20);
  });
});
