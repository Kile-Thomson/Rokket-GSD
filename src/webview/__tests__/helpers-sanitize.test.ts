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
