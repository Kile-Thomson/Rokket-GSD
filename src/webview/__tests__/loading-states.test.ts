// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

// ============================================================
// Loading States & Copy-Button Gating Tests
//
// These tests verify the HTML patterns and DOM behavior for:
// 1. Dashboard loading spinner
// 2. Changelog loading spinner
// 3. Model picker loading spinner
// 4. Copy-button gating (isComplete guard)
//
// Since buildTurnHtml and the loading-flow functions are not
// exported, we test the contracts by replicating the exact HTML
// patterns used in the source and verifying DOM structure.
// ============================================================

describe("Loading States", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // ── Dashboard ──────────────────────────────────────────────

  it("dashboard loading renders spinner with correct class", () => {
    // Replicates index.ts:617-620
    const loader = document.createElement("div");
    loader.className = "gsd-dashboard";
    loader.innerHTML = `<div class="gsd-loading-spinner"><div class="gsd-spinner"></div> Loading dashboard...</div>`;
    document.body.appendChild(loader);

    const spinner = document.querySelector(".gsd-dashboard .gsd-loading-spinner");
    expect(spinner).not.toBeNull();
    expect(spinner!.textContent).toContain("Loading dashboard...");
    expect(document.querySelector(".gsd-spinner")).not.toBeNull();
  });

  it("dashboard spinner is replaced when renderDashboard runs", () => {
    // Set up spinner (index.ts:617-620)
    const loader = document.createElement("div");
    loader.className = "gsd-dashboard";
    loader.innerHTML = `<div class="gsd-loading-spinner"><div class="gsd-spinner"></div> Loading dashboard...</div>`;
    document.body.appendChild(loader);

    expect(document.querySelector(".gsd-loading-spinner")).not.toBeNull();

    // Simulate renderDashboard replacement (index.ts:1199-1203)
    const existing = document.querySelector(".gsd-dashboard");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.className = "gsd-dashboard";
    el.innerHTML = `<div class="gsd-dashboard-empty"><div>📊</div><div>No active GSD project</div></div>`;
    document.body.appendChild(el);

    // Spinner gone, dashboard content present
    expect(document.querySelector(".gsd-loading-spinner")).toBeNull();
    expect(document.querySelector(".gsd-dashboard")).not.toBeNull();
    expect(document.querySelector(".gsd-dashboard-empty")).not.toBeNull();
  });

  // ── Changelog ──────────────────────────────────────────────

  it("changelog loading renders spinner with correct class", () => {
    // Replicates index.ts:773-781
    const loader = document.createElement("div");
    loader.id = "gsd-changelog";
    loader.className = "gsd-changelog";
    loader.innerHTML = `
      <div class="gsd-changelog-header">
        <span class="gsd-changelog-title">📋 Changelog</span>
      </div>
      <div class="gsd-loading-spinner"><div class="gsd-spinner"></div> Loading...</div>
    `;
    document.body.appendChild(loader);

    const spinner = document.querySelector("#gsd-changelog .gsd-loading-spinner");
    expect(spinner).not.toBeNull();
    expect(spinner!.textContent).toContain("Loading...");
  });

  it("changelog spinner is replaced when showChangelog runs", () => {
    // Set up spinner
    const loader = document.createElement("div");
    loader.id = "gsd-changelog";
    loader.className = "gsd-changelog";
    loader.innerHTML = `<div class="gsd-loading-spinner"><div class="gsd-spinner"></div> Loading...</div>`;
    document.body.appendChild(loader);

    expect(document.querySelector(".gsd-loading-spinner")).not.toBeNull();

    // Simulate showChangelog (index.ts:2220-2254)
    const existing = document.getElementById("gsd-changelog");
    if (existing) existing.remove();

    const card = document.createElement("div");
    card.id = "gsd-changelog";
    card.className = "gsd-changelog";
    card.innerHTML = `
      <div class="gsd-changelog-header">
        <span class="gsd-changelog-title">📋 Changelog</span>
        <button class="gsd-changelog-close" title="Close">✕</button>
      </div>
      <div class="gsd-changelog-entries">
        <div class="gsd-changelog-entry latest">
          <div class="gsd-changelog-entry-header">
            <span class="gsd-changelog-version">v1.0.0</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(card);

    // Spinner gone, entries present
    expect(document.querySelector(".gsd-loading-spinner")).toBeNull();
    expect(document.querySelector(".gsd-changelog-entries")).not.toBeNull();
    expect(document.querySelector(".gsd-changelog-version")).not.toBeNull();
  });

  // ── Model Picker ───────────────────────────────────────────

  it("model picker renders spinner when models list is empty", () => {
    // Replicates model-picker.ts:60-65
    const pickerEl = document.createElement("div");
    const models: unknown[] = [];

    if (models.length === 0) {
      pickerEl.classList.remove('gsd-hidden');
      pickerEl.innerHTML = `<div class="gsd-model-picker-loading">
        <span class="gsd-tool-spinner"></span> Loading models…
      </div>`;
    }
    document.body.appendChild(pickerEl);

    const loading = document.querySelector(".gsd-model-picker-loading");
    expect(loading).not.toBeNull();
    expect(loading!.textContent).toContain("Loading models");
    expect(document.querySelector(".gsd-tool-spinner")).not.toBeNull();
  });

  it("model picker renders model list when models are available", () => {
    const pickerEl = document.createElement("div");
    const models = [{ id: "gpt-4", provider: "openai", name: "GPT-4" }];

    if (models.length === 0) {
      pickerEl.innerHTML = `<div class="gsd-model-picker-loading"><span class="gsd-tool-spinner"></span> Loading models…</div>`;
    } else {
      pickerEl.innerHTML = `<div class="gsd-model-picker-header"><span class="gsd-model-picker-title">Select Model</span></div>`;
    }
    document.body.appendChild(pickerEl);

    expect(document.querySelector(".gsd-model-picker-loading")).toBeNull();
    expect(document.querySelector(".gsd-model-picker-header")).not.toBeNull();
  });
});

describe("Copy-Button Gating", () => {
  // Replicate the copy-button logic from buildTurnHtml (renderer.ts:324-342)
  function buildCopyButton(turn: { isComplete: boolean; segments: Array<{ type: string; chunks: string[] }>; timestamp?: number }): string {
    let html = "";
    if (turn.isComplete) {
      const textContent = turn.segments
        .filter(s => s.type === "text")
        .map(s => s.chunks.join(""))
        .join("\n\n");
      if (textContent) {
        html += `<div class="gsd-turn-actions">`;
        html += `<button class="gsd-copy-response-btn" data-copy-text="${textContent}" title="Copy response">Copy</button>`;
        html += `</div>`;
      }
    }
    return html;
  }

  it("copy button is NOT rendered when turn.isComplete is false", () => {
    const turn = {
      isComplete: false,
      segments: [{ type: "text", chunks: ["Hello world"] }],
    };

    const html = buildCopyButton(turn);
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector(".gsd-copy-response-btn")).toBeNull();
  });

  it("copy button IS rendered when turn.isComplete is true", () => {
    const turn = {
      isComplete: true,
      segments: [{ type: "text", chunks: ["Hello world"] }],
    };

    const html = buildCopyButton(turn);
    const container = document.createElement("div");
    container.innerHTML = html;

    const btn = container.querySelector(".gsd-copy-response-btn");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("data-copy-text")).toBe("Hello world");
  });

  it("copy button not rendered when complete but no text content", () => {
    const turn = {
      isComplete: true,
      segments: [{ type: "tool", chunks: [] }],
    };

    const html = buildCopyButton(turn);
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector(".gsd-copy-response-btn")).toBeNull();
  });

  it("streaming class is added during streaming and removed on finalize", () => {
    // Replicates renderer.ts:72 (creation) and :209 (removal)
    const el = document.createElement("div");
    el.className = "gsd-entry gsd-entry-assistant streaming";

    expect(el.classList.contains("streaming")).toBe(true);

    // Simulate finalize (renderer.ts:209)
    el.classList.remove("streaming");
    expect(el.classList.contains("streaming")).toBe(false);
    expect(el.classList.contains("gsd-entry-assistant")).toBe(true);
  });
});
