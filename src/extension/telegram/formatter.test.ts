import { describe, it, expect } from "vitest";
import { escapeHtml, truncateMessage } from "./formatter";

describe("escapeHtml", () => {
  it("escapes &, <, >, and double quotes", () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe(
      "a &amp; b &lt; c &gt; d &quot;e&quot;",
    );
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("truncateMessage", () => {
  it("returns text shorter than limit unchanged", () => {
    expect(truncateMessage("short")).toBe("short");
  });

  it("returns text at exactly 4096 chars unchanged", () => {
    const text = "a".repeat(4096);
    expect(truncateMessage(text)).toBe(text);
  });

  it("truncates text at 4097 chars with suffix", () => {
    const text = "a".repeat(4097);
    const result = truncateMessage(text);
    expect(result.length).toBe(4096);
    expect(result.endsWith("…(truncated)")).toBe(true);
  });

  it("respects custom maxLen", () => {
    const text = "a".repeat(100);
    const result = truncateMessage(text, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("…(truncated)")).toBe(true);
  });
});
