import { describe, it, expect, vi } from "vitest";

// Mock marked (imported by helpers.ts at top level — needs Renderer constructor)
vi.mock("marked", () => {
  function Renderer() {}
  const marked = Object.assign(
    vi.fn((s: string) => s),
    {
      Renderer,
      setOptions: vi.fn(),
      parse: vi.fn((s: string) => s),
    },
  );
  return { marked };
});

// Mock dompurify — use a real-ish sanitize that strips <script> tags
vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string) => {
      // Simulate real DOMPurify: strip <script> tags and their content
      return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    }),
  },
}));

import { formatMarkdownNotes } from "../helpers";
import DOMPurify from "dompurify";

describe("formatMarkdownNotes", () => {
  it("returns formatted HTML for normal markdown", () => {
    const result = formatMarkdownNotes("## Hello\n**bold** text");
    expect(result).toContain("<h3>");
    expect(result).toContain("<strong>bold</strong>");
  });

  it("returns placeholder for empty input", () => {
    const result = formatMarkdownNotes("   ");
    expect(result).toBe("<p>No details available.</p>");
  });

  it("passes output through DOMPurify.sanitize()", () => {
    formatMarkdownNotes("## Hello World");
    expect(DOMPurify.sanitize).toHaveBeenCalled();
  });

  it("sanitizes embedded script tags", () => {
    const malicious = "Hello <script>alert('xss')</script> World";
    const result = formatMarkdownNotes(malicious);
    // escapeHtml runs first, so <script> becomes &lt;script&gt;
    // But even if escapeHtml missed something, DOMPurify is the second layer
    expect(result).not.toContain("<script>");
    expect(DOMPurify.sanitize).toHaveBeenCalled();
  });
});

// ============================================================
// buildUsagePills
// ============================================================

import { buildUsagePills } from "../helpers";

describe("buildUsagePills", () => {
  it("returns empty string when usage is null/undefined", () => {
    expect(buildUsagePills(null)).toBe("");
    expect(buildUsagePills(undefined)).toBe("");
  });

  it("returns empty string when all usage values are zero/falsy", () => {
    expect(buildUsagePills({ turns: 0, input: 0, output: 0, cost: 0 })).toBe("");
  });

  it("renders turn count", () => {
    const html = buildUsagePills({ turns: 2 });
    expect(html).toContain("2 turns");
  });

  it("renders singular turn", () => {
    const html = buildUsagePills({ turns: 1 });
    expect(html).toContain("1 turn");
    expect(html).not.toContain("1 turns");
  });

  it("renders input tokens with k suffix", () => {
    const html = buildUsagePills({ input: 1500 });
    expect(html).toContain("↑");
  });

  it("renders cost formatted to 4 decimal places", () => {
    const html = buildUsagePills({ cost: 0.1234 });
    expect(html).toContain("$0.1234");
  });

  it("renders cacheRead pill", () => {
    const html = buildUsagePills({ cacheRead: 25000 });
    expect(html).toContain("R25.0k");
  });

  it("renders cacheWrite pill", () => {
    const html = buildUsagePills({ cacheWrite: 3200 });
    expect(html).toContain("W3.2k");
  });

  it("renders model name when provided", () => {
    const html = buildUsagePills({ turns: 1 }, "claude-sonnet-4");
    expect(html).toContain("claude-sonnet-4");
  });

  it("wraps pills in gsd-agent-usage div", () => {
    const html = buildUsagePills({ turns: 1 });
    expect(html).toContain("gsd-agent-usage");
    expect(html).toContain("gsd-agent-pill");
  });
});

// ============================================================
// parseAgentUsage
// ============================================================

import { parseAgentUsage } from "../helpers";

describe("parseAgentUsage", () => {
  it("returns null when there is no <usage> block", () => {
    expect(parseAgentUsage("just some result text")).toBeNull();
  });

  it("parses subagent_tokens from a single-dispatch result (the real runtime shape)", () => {
    // Exact shape emitted by a single `subagent` dispatch, captured from a live
    // gsd --mode rpc run: tool_execution_end result text.
    const resultText =
      "ok\nagentId: abbee4e9671c46d2f\n" +
      "<usage>subagent_tokens: 18132\ntool_uses: 0\nduration_ms: 1581</usage>";
    const parsed = parseAgentUsage(resultText);
    expect(parsed).not.toBeNull();
    expect(parsed?.usage.totalTokens).toBe(18132);
    expect(parsed?.usage.toolUses).toBe(0);
    expect(parsed?.usage.durationMs).toBe(1581);
    // the <usage> tag is stripped from the displayed text
    expect(parsed?.cleanText).not.toContain("<usage>");
    expect(parsed?.cleanText).toContain("ok");
  });

  it("still parses total_tokens (parallel/chain summary shape)", () => {
    const resultText =
      "done\n<usage>total_tokens: 50000\ntool_uses: 4\nduration_ms: 9000</usage>";
    const parsed = parseAgentUsage(resultText);
    expect(parsed?.usage.totalTokens).toBe(50000);
    expect(parsed?.usage.toolUses).toBe(4);
    expect(parsed?.usage.durationMs).toBe(9000);
  });

  it("prefers total_tokens over subagent_tokens when both are present", () => {
    const resultText =
      "<usage>total_tokens: 999\nsubagent_tokens: 111\ntool_uses: 1\nduration_ms: 5</usage>";
    const parsed = parseAgentUsage(resultText);
    expect(parsed?.usage.totalTokens).toBe(999);
  });

  it("returns null when the <usage> block has no recognized fields", () => {
    expect(parseAgentUsage("<usage>unrelated: 1</usage>")).toBeNull();
  });
});
