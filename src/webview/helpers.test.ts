// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  escapeAttr,
  sanitizeUrl,
  formatCost,
  formatTokens,
  formatContextUsage,
  formatMarkdownNotes,
  formatShortDate,
  shortenPath,
  formatDuration,
  truncateArg,
  getToolCategory,
  getToolIcon,
  getToolKeyArg,
  isLikelyFilePath,
  formatRelativeTime,
  formatToolResult,
  renderMarkdown,
} from "./helpers";

// ============================================================
// escapeHtml / escapeAttr
// ============================================================

describe("escapeHtml", () => {
  it("escapes all HTML special chars", () => {
    expect(escapeHtml('<script>"a&b\'</script>')).toBe(
      "&lt;script&gt;&quot;a&amp;b&#039;&lt;/script&gt;"
    );
  });
  it("handles non-string input", () => {
    expect(escapeHtml(null as any)).toBe("");
    expect(escapeHtml(undefined as any)).toBe("");
  });
  it("returns empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("escapeAttr", () => {
  it("delegates to escapeHtml", () => {
    expect(escapeAttr('"foo"')).toBe("&quot;foo&quot;");
  });
});

// ============================================================
// sanitizeUrl
// ============================================================

describe("sanitizeUrl", () => {
  it("allows http/https URLs", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
    expect(sanitizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("allows vscode and mailto schemes", () => {
    expect(sanitizeUrl("vscode://ext")).toBe("vscode://ext");
    expect(sanitizeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });
  it("blocks javascript: URLs", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
  });
  it("allows relative paths", () => {
    expect(sanitizeUrl("/foo/bar")).toBe("/foo/bar");
    expect(sanitizeUrl("#anchor")).toBe("#anchor");
    expect(sanitizeUrl("./file.ts")).toBe("./file.ts");
    expect(sanitizeUrl("../up.ts")).toBe("../up.ts");
  });
  it("returns empty for empty input", () => {
    expect(sanitizeUrl("")).toBe("");
  });
});

// ============================================================
// formatCost
// ============================================================

describe("formatCost", () => {
  it("formats undefined as $0.000", () => {
    expect(formatCost(undefined)).toBe("$0.000");
  });
  it("formats a cost to 3 decimal places", () => {
    expect(formatCost(1.5)).toBe("$1.500");
    expect(formatCost(0.0042)).toBe("$0.004");
  });
});

// ============================================================
// formatTokens
// ============================================================

describe("formatTokens", () => {
  it("shows raw count under 1000", () => {
    expect(formatTokens(999)).toBe("999");
  });
  it("shows 1 decimal k for 1000-9999", () => {
    expect(formatTokens(1500)).toBe("1.5k");
  });
  it("shows rounded k for 10000-999999", () => {
    expect(formatTokens(45_000)).toBe("45k");
  });
  it("shows M for millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(15_000_000)).toBe("15M");
  });
});

// ============================================================
// formatContextUsage
// ============================================================

describe("formatContextUsage", () => {
  it("shows percent and window", () => {
    const stats = { contextWindow: 200000, contextPercent: 42.5, autoCompactionEnabled: true } as any;
    const model = { contextWindow: 200000 } as any;
    expect(formatContextUsage(stats, model)).toBe("42.5%/200k (auto)");
  });
  it("shows ?/ when no percent", () => {
    const stats = { contextWindow: 128000 } as any;
    expect(formatContextUsage(stats, {}  as any)).toBe("?/128k (auto)");
  });
  it("clamps percent above 100", () => {
    const stats = { contextWindow: 200000, contextPercent: 299.1, autoCompactionEnabled: true } as any;
    expect(formatContextUsage(stats, {} as any)).toBe("100.0%/200k (auto)");
  });
  it("returns empty when no data", () => {
    expect(formatContextUsage({} as any, {} as any)).toBe("");
  });
});

// ============================================================
// shortenPath
// ============================================================

describe("shortenPath", () => {
  it("shortens long paths", () => {
    expect(shortenPath("a/b/c/d/e.ts")).toBe("…/d/e.ts");
  });
  it("keeps short paths", () => {
    expect(shortenPath("a/b")).toBe("a/b");
  });
  it("handles backslashes", () => {
    expect(shortenPath("C:\\Users\\foo\\bar.ts")).toBe("…/foo/bar.ts");
  });
  it("returns empty for empty", () => {
    expect(shortenPath("")).toBe("");
  });
});

// ============================================================
// formatDuration
// ============================================================

describe("formatDuration", () => {
  it("shows ms for < 1000", () => {
    expect(formatDuration(500)).toBe("500ms");
  });
  it("shows seconds for >= 1000", () => {
    expect(formatDuration(2500)).toBe("2.5s");
  });
});

// ============================================================
// truncateArg
// ============================================================

describe("truncateArg", () => {
  it("truncates long strings", () => {
    expect(truncateArg("abcdefghij", 5)).toBe("abcd…");
  });
  it("takes first line only", () => {
    expect(truncateArg("line1\nline2", 100)).toBe("line1");
  });
  it("returns short strings as-is", () => {
    expect(truncateArg("hi", 10)).toBe("hi");
  });
});

// ============================================================
// getToolCategory
// ============================================================

describe("getToolCategory", () => {
  it("classifies file tools", () => {
    expect(getToolCategory("read")).toBe("file");
    expect(getToolCategory("Write")).toBe("file");
    expect(getToolCategory("edit")).toBe("file");
  });
  it("classifies shell/process", () => {
    expect(getToolCategory("bash")).toBe("shell");
    expect(getToolCategory("async_bash")).toBe("shell");
    expect(getToolCategory("await_job")).toBe("shell");
    expect(getToolCategory("cancel_job")).toBe("shell");
    expect(getToolCategory("bg_shell")).toBe("process");
  });
  it("classifies browser tools", () => {
    expect(getToolCategory("browser_click")).toBe("browser");
    expect(getToolCategory("browser_batch")).toBe("browser");
    expect(getToolCategory("browser_assert")).toBe("browser");
    expect(getToolCategory("browser_find")).toBe("browser");
    expect(getToolCategory("browser_emulate_device")).toBe("browser");
    expect(getToolCategory("mac_screenshot")).toBe("browser");
  });
  it("classifies search tools", () => {
    expect(getToolCategory("google_search")).toBe("search");
    expect(getToolCategory("fetch_page")).toBe("search");
    expect(getToolCategory("web_search")).toBe("search");
    expect(getToolCategory("resolve_library")).toBe("search");
    expect(getToolCategory("get_library_docs")).toBe("search");
    expect(getToolCategory("search_and_read")).toBe("search");
  });
  it("classifies subagent", () => {
    expect(getToolCategory("subagent")).toBe("agent");
  });
  it("classifies lsp as generic", () => {
    expect(getToolCategory("lsp")).toBe("generic");
  });
  it("classifies gsd_ tools as generic", () => {
    expect(getToolCategory("gsd_save_decision")).toBe("generic");
    expect(getToolCategory("gsd_update_requirement")).toBe("generic");
    expect(getToolCategory("gsd_save_summary")).toBe("generic");
  });
  it("returns generic for unknown", () => {
    expect(getToolCategory("unknown_tool")).toBe("generic");
  });
});

// ============================================================
// getToolIcon
// ============================================================

describe("getToolIcon", () => {
  it("returns correct icons", () => {
    expect(getToolIcon("read", "file")).toBe("📄");
    expect(getToolIcon("bash", "shell")).toBe("⌨");
    expect(getToolIcon("subagent", "agent")).toBe("🤖");
    expect(getToolIcon("browser_navigate", "browser")).toBe("🌐");
    expect(getToolIcon("google_search", "search")).toBe("🔍");
    expect(getToolIcon("unknown", "generic")).toBe("⚡");
  });
  it("returns icons for new v2.20+ tools", () => {
    expect(getToolIcon("lsp", "generic")).toBe("🧠");
    expect(getToolIcon("await_job", "shell")).toBe("⏳");
    expect(getToolIcon("cancel_job", "shell")).toBe("⏳");
    expect(getToolIcon("gsd_save_decision", "generic")).toBe("📋");
    expect(getToolIcon("gsd_update_requirement", "generic")).toBe("📋");
    expect(getToolIcon("gsd_save_summary", "generic")).toBe("📋");
    expect(getToolIcon("github_reviews", "generic")).toBe("🐙");
    expect(getToolIcon("github_comments", "generic")).toBe("🐙");
    expect(getToolIcon("github_labels", "generic")).toBe("🐙");
  });
});

// ============================================================
// getToolKeyArg
// ============================================================

describe("getToolKeyArg", () => {
  it("extracts bash command", () => {
    expect(getToolKeyArg("bash", { command: "ls -la" })).toBe("ls -la");
  });
  it("extracts file path for read/write/edit", () => {
    expect(getToolKeyArg("read", { path: "src/foo.ts" })).toBe("src/foo.ts");
  });
  it("extracts subagent info", () => {
    expect(getToolKeyArg("subagent", { agent: "scout", task: "find stuff" })).toBe("scout: find stuff");
  });
  it("extracts bg_shell start", () => {
    expect(getToolKeyArg("bg_shell", { action: "start", command: "npm run dev", label: "dev server" })).toBe("start: dev server");
  });
  it("falls back to first string arg", () => {
    expect(getToolKeyArg("unknown", { query: "hello" })).toBe("hello");
  });
  it("extracts lsp action and file", () => {
    expect(getToolKeyArg("lsp", { action: "definition", file: "src/foo.ts", symbol: "MyClass" })).toBe("definition: src/foo.ts → MyClass");
    expect(getToolKeyArg("lsp", { action: "diagnostics" })).toBe("diagnostics");
    expect(getToolKeyArg("lsp", { action: "symbols", query: "handleClick" })).toBe("symbols: handleClick");
  });
  it("extracts github_ action and number", () => {
    expect(getToolKeyArg("github_issues", { action: "view", number: 42 })).toBe("view #42");
    expect(getToolKeyArg("github_prs", { action: "list" })).toBe("list");
    expect(getToolKeyArg("github_reviews", { action: "submit", number: 10 })).toBe("submit #10");
  });
  it("extracts mcp_call server/tool", () => {
    expect(getToolKeyArg("mcp_call", { server: "railway", tool: "list_projects" })).toBe("railway/list_projects");
  });
  it("extracts gsd_ tool args", () => {
    expect(getToolKeyArg("gsd_save_decision", { decision: "Use SQLite for storage" })).toBe("Use SQLite for storage");
    expect(getToolKeyArg("gsd_update_requirement", { id: "R003" })).toBe("R003");
    expect(getToolKeyArg("gsd_save_summary", { milestone_id: "M001", slice_id: "S01", artifact_type: "SUMMARY" })).toBe("M001/S01/SUMMARY");
  });
  it("extracts browser_batch step count", () => {
    expect(getToolKeyArg("browser_batch", { steps: [{ action: "click" }, { action: "type" }] })).toBe("2 steps");
  });
  it("extracts browser_find text/role", () => {
    expect(getToolKeyArg("browser_find", { text: "Submit", role: "button" })).toBe("button \"Submit\"");
    expect(getToolKeyArg("browser_find", { text: "Login" })).toBe("\"Login\"");
  });
  it("extracts browser_wait_for condition", () => {
    expect(getToolKeyArg("browser_wait_for", { condition: "text_visible", value: "Success" })).toBe("text_visible: Success");
  });
  it("extracts web_search query", () => {
    expect(getToolKeyArg("web_search", { query: "react hooks" })).toBe("react hooks");
  });
  it("extracts resolve_library name", () => {
    expect(getToolKeyArg("resolve_library", { libraryName: "next.js" })).toBe("next.js");
  });
  it("extracts await_job job ids", () => {
    expect(getToolKeyArg("await_job", { jobs: ["bg_abc123"] })).toBe("bg_abc123");
    expect(getToolKeyArg("await_job", { jobs: ["bg_a", "bg_b", "bg_c"] })).toBe("3 jobs");
  });
  it("extracts cancel_job id", () => {
    expect(getToolKeyArg("cancel_job", { job_id: "bg_abc123" })).toBe("bg_abc123");
  });
  it("extracts mac_ app name", () => {
    expect(getToolKeyArg("mac_find", { app: "Finder", role: "AXButton" })).toBe("Finder");
  });
  it("extracts secure_env_collect key names", () => {
    expect(getToolKeyArg("secure_env_collect", { keys: [{ key: "OPENAI_API_KEY" }, { key: "DATABASE_URL" }] })).toBe("OPENAI_API_KEY, DATABASE_URL");
  });
});

// ============================================================
// isLikelyFilePath
// ============================================================

describe("isLikelyFilePath", () => {
  it("detects Windows paths", () => {
    expect(isLikelyFilePath("C:\\Users\\foo\\bar.ts")).toBe(true);
  });
  it("detects Unix absolute paths", () => {
    expect(isLikelyFilePath("/home/user/file.ts")).toBe(true);
  });
  it("detects relative paths", () => {
    expect(isLikelyFilePath("src/foo/bar.ts")).toBe(true);
  });
  it("detects bare filenames", () => {
    expect(isLikelyFilePath("package.json")).toBe(true);
  });
  it("rejects short strings", () => {
    expect(isLikelyFilePath("ab")).toBe(false);
  });
  it("rejects strings with spaces and slashes", () => {
    expect(isLikelyFilePath("not a path")).toBe(false);
  });
  it("rejects multiline", () => {
    expect(isLikelyFilePath("a/b.ts\nc/d.ts")).toBe(false);
  });
});

// ============================================================
// formatRelativeTime
// ============================================================

describe("formatRelativeTime", () => {
  it("shows 'just now' for < 5s", () => {
    expect(formatRelativeTime(Date.now() - 2000)).toBe("just now");
  });
  it("shows seconds", () => {
    expect(formatRelativeTime(Date.now() - 30_000)).toBe("30s ago");
  });
  it("shows minutes", () => {
    expect(formatRelativeTime(Date.now() - 120_000)).toBe("2m ago");
  });
  it("shows hours", () => {
    expect(formatRelativeTime(Date.now() - 7_200_000)).toBe("2h ago");
  });
  it("shows date for old timestamps", () => {
    const old = Date.now() - 100_000_000;
    expect(formatRelativeTime(old)).toMatch(/\d/);
  });
});

// ============================================================
// formatToolResult
// ============================================================

describe("formatToolResult", () => {
  it("formats ask_user_questions JSON", () => {
    const result = JSON.stringify({
      answers: { q1: { answers: ["Option A"] } },
    });
    const args = { questions: [{ id: "q1", header: "Choice" }] };
    expect(formatToolResult("ask_user_questions", result, args)).toBe("✓ Choice: Option A");
  });
  it("returns raw text for other tools", () => {
    expect(formatToolResult("bash", "output here", {})).toBe("output here");
  });
  it("returns raw text when JSON is invalid", () => {
    expect(formatToolResult("ask_user_questions", "not json", {})).toBe("not json");
  });
});

// ============================================================
// renderMarkdown (jsdom environment)
// ============================================================

describe("renderMarkdown", () => {
  it("renders basic markdown", () => {
    const html = renderMarkdown("**bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });
  it("returns empty for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
  it("renders code blocks with IDs", () => {
    const html = renderMarkdown("```js\nconsole.log('hi')\n```");
    expect(html).toMatch(/data-code-id="code-\d+"/);
    expect(html).toContain("gsd-code-block");
    expect(html).toContain("gsd-copy-btn");
  });
  it("renders links with sanitized URLs", () => {
    const html = renderMarkdown("[click](https://example.com)");
    expect(html).toContain('class="gsd-link"');
    expect(html).toContain("https://example.com");
  });
  it("blocks javascript: links", () => {
    const html = renderMarkdown("[xss](javascript:alert(1))");
    expect(html).toContain("gsd-link-blocked");
    expect(html).not.toContain("javascript:");
  });
  it("wraps tables in scrollable container", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("gsd-table-wrapper");
  });
  it("makes file paths clickable in inline code", () => {
    const html = renderMarkdown("`src/foo/bar.ts`");
    expect(html).toContain("gsd-file-link");
    expect(html).toContain('data-path="src/foo/bar.ts"');
  });
});

describe("formatMarkdownNotes", () => {
  it("returns fallback for empty input", () => {
    expect(formatMarkdownNotes("")).toContain("No details available");
    expect(formatMarkdownNotes("   ")).toContain("No details available");
  });

  it("converts headers", () => {
    expect(formatMarkdownNotes("### Added")).toContain("<h4>Added</h4>");
    expect(formatMarkdownNotes("## Fixed")).toContain("<h3>Fixed</h3>");
  });

  it("converts bold and code", () => {
    const result = formatMarkdownNotes("**bold text** and `code`");
    expect(result).toContain("<strong>bold text</strong>");
    expect(result).toContain("<code>code</code>");
  });

  it("converts list items", () => {
    const result = formatMarkdownNotes("- item one\n- item two");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>item one</li>");
    expect(result).toContain("<li>item two</li>");
  });

  it("escapes HTML in input", () => {
    const result = formatMarkdownNotes("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });
});

describe("formatShortDate", () => {
  it("returns empty for empty input", () => {
    expect(formatShortDate("")).toBe("");
  });

  it("formats an ISO date", () => {
    const result = formatShortDate("2026-03-14T10:00:00Z");
    // Should contain month, day, year in some locale format
    expect(result).toMatch(/\d{4}/); // year present
    expect(result.length).toBeGreaterThan(5);
  });
});
