// ============================================================
// Webview Helpers — pure functions, formatting, markdown, tools
// ============================================================

import { marked, type Token, type TokensList } from "marked";
import DOMPurify from "dompurify";
import type { SessionStats } from "../shared/types";
import type { AppState, ToolCategory, ToolCallState } from "./state";
import { registerCleanup } from "./dispose";
import {
  TASK_PREVIEW_MAX_CHARS,
  TOKEN_THRESHOLD_K,
  TOKEN_THRESHOLD_10K,
  TOKEN_THRESHOLD_M,
  TOKEN_THRESHOLD_10M,
  RELATIVE_TIME_5S_MS,
  RELATIVE_TIME_1M_MS,
  RELATIVE_TIME_1H_MS,
  RELATIVE_TIME_1D_MS,
} from "../shared/constants";

// ============================================================
// URL safety
// ============================================================

const ALLOWED_URL_SCHEMES = ["http:", "https:", "file:", "mailto:", "vscode:"];

/** Validate a URL has a safe scheme. Returns the URL if safe, empty string if not. */
export function sanitizeUrl(href: string): string {
  if (!href) return "";
  try {
    const url = new URL(href, "https://placeholder.invalid");
    if (ALLOWED_URL_SCHEMES.includes(url.protocol)) return href;
    return "";
  } catch {
    // Relative URLs are fine (file paths, anchors)
    if (href.startsWith("/") || href.startsWith("#") || href.startsWith("./") || href.startsWith("../")) return href;
    return "";
  }
}

// ============================================================
// Configure marked
// ============================================================

let codeBlockIdCounter = 0;

const renderer = new marked.Renderer();

renderer.link = ({ href, text }: { href: string; text: string }) => {
  const safeHref = sanitizeUrl(href);
  if (!safeHref) return `<span class="gsd-link-blocked" title="Blocked: unsafe URL scheme">${text}</span>`;
  return `<a href="${escapeAttr(safeHref)}" class="gsd-link" title="${escapeAttr(safeHref)}">${text}</a>`;
};

renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const langLabel = lang || "text";
  const id = `code-${++codeBlockIdCounter}`;
  return `<div class="gsd-code-block" data-code-id="${id}">
    <div class="gsd-code-header">
      <span class="gsd-code-lang">${escapeHtml(langLabel)}</span>
      <button class="gsd-copy-btn" data-code-id="${id}" aria-label="Copy code">Copy</button>
    </div>
    <pre><code class="language-${escapeAttr(langLabel)}">${escapeHtml(text)}</code></pre>
  </div>`;
};

renderer.image = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
  return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}" title="${escapeAttr(title || "")}" class="gsd-md-image" />`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
});

// ============================================================
// HTML / string helpers
// ============================================================

/** Escape HTML special characters to prevent XSS in rendered output. */
export function escapeHtml(text: string): string {
  if (typeof text !== "string") text = String(text ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escape a string for use in HTML attributes. Alias of `escapeHtml()`. */
export function escapeAttr(text: string): string {
  return escapeHtml(text);
}

// ============================================================
// Formatting
// ============================================================

/** Format a cost value as a dollar string with 3 decimal places (e.g. `"$1.234"`). */
export function formatCost(cost: number | undefined): string {
  if (cost == null) return "$0.000";
  return `$${cost.toFixed(3)}`;
}

/** Format a token count with SI suffixes: `1234` → `"1.2k"`, `1500000` → `"1.5M"`. */
export function formatTokens(count: number): string {
  if (count < TOKEN_THRESHOLD_K) return count.toString();
  if (count < TOKEN_THRESHOLD_10K) return `${(count / TOKEN_THRESHOLD_K).toFixed(1)}k`;
  if (count < TOKEN_THRESHOLD_M) return `${Math.round(count / TOKEN_THRESHOLD_K)}k`;
  if (count < TOKEN_THRESHOLD_10M) return `${(count / TOKEN_THRESHOLD_M).toFixed(1)}M`;
  return `${Math.round(count / TOKEN_THRESHOLD_M)}M`;
}

/** Format context window usage as a percentage/window string (e.g. `"42.1%/200k (auto)"`). */
export function formatContextUsage(stats: SessionStats, model: AppState["model"]): string {
  const contextWindow = stats.contextWindow || model?.contextWindow || 0;
  const pct = stats.contextPercent ?? null;
  const auto = stats.autoCompactionEnabled !== false ? " (auto)" : "";
  if (contextWindow > 0) {
    const windowStr = formatTokens(contextWindow);
    if (pct != null) {
      return `${pct.toFixed(1)}%/${windowStr}${auto}`;
    }
    return `?/${windowStr}${auto}`;
  }
  if (pct != null) {
    return `${pct.toFixed(1)}%${auto}`;
  }
  return "";
}

/** Shorten a file path for display — keeps the last 2 segments (e.g. `"…/src/types.ts"`). */
export function shortenPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

/** Format a duration in milliseconds as a human-readable string (e.g. `"1.2s"`, `"450ms"`). */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Truncate a string to `max` characters, taking only the first line and appending "…" if truncated. */
export function truncateArg(s: string, max: number): string {
  const line = s.split("\n")[0];
  if (line.length <= max) return line;
  return line.slice(0, max - 1) + "…";
}

// ============================================================
// Tool helpers
// ============================================================

/** Classify a tool name into a UI category for grouping and icon selection. */
export function getToolCategory(name: string): ToolCategory {
  const n = name.toLowerCase();
  if (["read", "write", "edit"].includes(n)) return "file";
  if (n === "bg_shell") return "process";
  if (n === "bash" || n === "async_bash" || n === "await_job" || n === "cancel_job") return "shell";
  if (n.startsWith("browser_") || n.startsWith("mac_")) return "browser";
  if (["search-the-web", "search_and_read", "fetch_page", "google_search",
       "resolve_library", "get_library_docs", "web_search"].includes(n)) return "search";
  if (n === "subagent" || n === "async_subagent" || n === "await_subagent") return "agent";
  if (n === "lsp") return "generic";
  if (n.startsWith("github_") || n === "mcp_call" || n === "mcp_discover" || n === "mcp_servers") return "generic";
  if (n.startsWith("gsd_")) return "generic";
  return "generic";
}

/** Return an emoji icon for a tool based on its name and category. */
export function getToolIcon(name: string, category: ToolCategory): string {
  const n = name.toLowerCase();
  if (n === "read") return "📄";
  if (n === "write") return "✏️";
  if (n === "edit") return "✂️";
  if (n === "bash" || n === "async_bash") return "⌨";
  if (n === "await_job" || n === "cancel_job") return "⏳";
  if (n === "bg_shell") return "⚙";
  if (n === "subagent" || n === "async_subagent" || n === "await_subagent") return "🤖";
  if (n === "lsp") return "🧠";
  if (n.startsWith("browser_")) return "🌐";
  if (n.startsWith("mac_")) return "🖥";
  if (n.startsWith("github_")) return "🐙";
  if (n === "mcp_call" || n === "mcp_discover" || n === "mcp_servers") return "🔌";
  if (n === "ask_user_questions") return "❓";
  if (n === "secure_env_collect") return "🔒";
  if (n === "discover_configs") return "🔧";
  if (n.startsWith("gsd_")) return "📋";
  if (category === "search") return "🔍";
  return "⚡";
}

/** Extract the most informative argument from a tool call for display in the tool header. */
export function getToolKeyArg(name: string, args: Record<string, unknown>): string {
  const n = name.toLowerCase();
  if (n === "bash" || n === "async_bash") {
    // Prefer human-readable description over raw command
    if (args.description) return truncateArg(String(args.description), 80);
    if (args.command) return truncateArg(String(args.command), 80);
  }
  // Support both `path` (pi tools) and `file_path` (Claude Code tools)
  const filePath = args.file_path || args.path;
  if ((n === "read" || n === "write" || n === "edit") && filePath) return shortenPath(String(filePath));
  if ((n === "grep" || n === "glob") && args.pattern) return truncateArg(String(args.pattern), 80);
  if (n === "agent" && args.description) return truncateArg(String(args.description), 80);
  if (n === "browser_navigate" && args.url) return truncateArg(String(args.url), 60);
  if (n === "browser_click" && args.selector) return truncateArg(String(args.selector), 60);
  if (n === "browser_type" && args.selector) return truncateArg(String(args.selector), 60);
  if (n === "browser_wait_for" && args.condition) {
    const val = args.value ? `: ${truncateArg(String(args.value), 40)}` : "";
    return `${args.condition}${val}`;
  }
  if (n === "browser_assert" && args.checks) {
    const checks = args.checks as unknown[];
    if (checks.length === 1) return truncateArg(String((checks[0] as Record<string, unknown>)?.kind || ""), 60);
    return `${checks.length} checks`;
  }
  if (n === "browser_batch" && args.steps) {
    const steps = args.steps as unknown[];
    return `${steps.length} steps`;
  }
  if (n === "browser_find" && (args.text || args.role)) {
    const parts: string[] = [];
    if (args.role) parts.push(String(args.role));
    if (args.text) parts.push(`"${truncateArg(String(args.text), 30)}"`);
    return parts.join(" ");
  }
  if (n === "browser_evaluate" && args.expression) return truncateArg(String(args.expression), 60);
  if (n === "browser_emulate_device" && args.device) return truncateArg(String(args.device), 40);
  if (n === "browser_mock_route" && args.url) return truncateArg(String(args.url), 60);
  if (n === "browser_extract" && args.selector) return truncateArg(String(args.selector), 60);
  if (n === "subagent" || n === "async_subagent") {
    const agent = args.agent || (args.chain as Record<string, unknown>[] | undefined)?.[0]?.agent || (args.tasks as Record<string, unknown>[] | undefined)?.[0]?.agent || "";
    const task = args.task || "";
    if (agent) return truncateArg(`${agent}: ${task}`, 80);
    if (task) return truncateArg(String(task), 80);
    return "";
  }
  if (n === "await_subagent") {
    const jobs = args.jobs as string[] | undefined;
    if (jobs && jobs.length > 0) return jobs.length === 1 ? jobs[0] : `${jobs.length} jobs`;
    return "(all running)";
  }
  if (n === "bg_shell") {
    const action = args.action ? String(args.action) : "";
    const cmd = args.command ? truncateArg(String(args.command), 60) : "";
    const label = args.label ? String(args.label) : "";
    if (action === "start" && (label || cmd)) return `start: ${label || cmd}`;
    if (action && args.id) return `${action}: ${args.id}`;
    return action || "";
  }
  if (n === "lsp") {
    const action = args.action ? String(args.action) : "";
    const file = args.file ? truncateArg(String(args.file), 40) : "";
    const symbol = args.symbol ? String(args.symbol) : "";
    if (action && file) return `${action}: ${file}${symbol ? ` → ${symbol}` : ""}`;
    if (action && args.query) return `${action}: ${truncateArg(String(args.query), 40)}`;
    return action || "";
  }
  if (n === "await_job" && args.jobs) {
    const jobs = args.jobs as string[];
    return jobs.length === 1 ? jobs[0] : `${jobs.length} jobs`;
  }
  if (n === "cancel_job" && args.job_id) return truncateArg(String(args.job_id), 40);
  if (n.startsWith("github_")) {
    const action = args.action ? String(args.action) : "";
    const num = args.number ? `#${args.number}` : "";
    return action + (num ? ` ${num}` : "");
  }
  if (n === "mcp_call") {
    const server = args.server ? String(args.server) : "";
    const tool = args.tool ? String(args.tool) : "";
    return server && tool ? `${server}/${tool}` : server || tool || "";
  }
  if (n === "gsd_save_decision" && args.decision) return truncateArg(String(args.decision), 60);
  if (n === "gsd_update_requirement" && args.id) return truncateArg(String(args.id), 20);
  if (n === "gsd_save_summary") {
    const parts: string[] = [];
    if (args.milestone_id) parts.push(String(args.milestone_id));
    if (args.slice_id) parts.push(String(args.slice_id));
    if (args.artifact_type) parts.push(String(args.artifact_type));
    return parts.join("/");
  }
  if (n === "resolve_library" && args.libraryName) return truncateArg(String(args.libraryName), 40);
  if (n === "get_library_docs" && args.libraryId) return truncateArg(String(args.libraryId), 40);
  if (n === "web_search" && args.query) return truncateArg(String(args.query), 60);
  if (n === "fetch_page" && args.url) return truncateArg(String(args.url), 60);
  if (n === "search_and_read" && args.query) return truncateArg(String(args.query), 60);
  if (n === "secure_env_collect" && args.keys) {
    const keys = args.keys as Record<string, unknown>[];
    return keys.map((k) => String(k.key || "")).filter(Boolean).join(", ");
  }
  if (n.startsWith("mac_") && args.app) return truncateArg(String(args.app), 40);
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 0 && k !== "content" && k !== "oldText" && k !== "newText") {
      return truncateArg(v, 60);
    }
  }
  return "";
}

/** Format tool results for display — special handling for known tools */
export function formatToolResult(toolName: string, resultText: string, args: Record<string, unknown>): string {
  const n = toolName.toLowerCase();

  if (n === "ask_user_questions") {
    try {
      const parsed = JSON.parse(resultText);
      if (parsed.answers && typeof parsed.answers === "object") {
        const questions = (args.questions as Record<string, unknown>[] | undefined) || [];
        const lines: string[] = [];
        for (const [id, answer] of Object.entries(parsed.answers as Record<string, Record<string, unknown>>)) {
          const q = questions.find((q) => q.id === id);
          const header = q?.header || id;
          const selections = (answer.answers as string[] | undefined) || [];
          lines.push(`✓ ${header}: ${selections.join(", ")}`);
        }
        return lines.join("\n") || resultText;
      }
    } catch {
      // Not JSON — fall through
    }
  }

  return resultText;
}

// ============================================================
// Subagent formatting helpers
// ============================================================

function formatTokenCount(count: number): string {
  if (count < TOKEN_THRESHOLD_K) return count.toString();
  if (count < TOKEN_THRESHOLD_10K) return `${(count / TOKEN_THRESHOLD_K).toFixed(1)}k`;
  if (count < TOKEN_THRESHOLD_M) return `${Math.round(count / TOKEN_THRESHOLD_K)}k`;
  return `${(count / TOKEN_THRESHOLD_M).toFixed(1)}M`;
}

export interface UsageInfo {
  turns?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
}

export function buildUsagePills(usage: UsageInfo | null | undefined, model?: string): string {
  if (!usage) return "";
  const pills: string[] = [];
  if (usage.turns) pills.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) pills.push(`↑${formatTokenCount(usage.input)}`);
  if (usage.output) pills.push(`↓${formatTokenCount(usage.output)}`);
  if (usage.cacheRead) pills.push(`R${formatTokenCount(usage.cacheRead)}`);
  if (usage.cacheWrite) pills.push(`W${formatTokenCount(usage.cacheWrite)}`);
  if (usage.cost) pills.push(`$${(Number(usage.cost) || 0).toFixed(4)}`);
  if (model) pills.push(model);
  if (pills.length === 0) return "";
  return `<div class="gsd-agent-usage">${pills.map(p => `<span class="gsd-agent-pill">${escapeHtml(p)}</span>`).join("")}</div>`;
}

export interface SubagentResult {
  agent: string;
  task?: string;
  exitCode: number;
  stopReason?: string;
  errorMessage?: string;
  usage?: UsageInfo;
  model?: string;
}

function buildAgentCard(r: SubagentResult, _isRunning: boolean): string {
  const running = r.exitCode === -1;
  const failed = !running && (r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted");
  const _done = !running && !failed;

  const stateClass = running ? "running" : failed ? "error" : "done";
  const icon = running
    ? `<span class="gsd-tool-spinner"></span>`
    : failed
      ? `<span class="gsd-agent-icon error">✗</span>`
      : `<span class="gsd-agent-icon done">✓</span>`;

  const taskPreview = r.task
    ? (r.task.length > TASK_PREVIEW_MAX_CHARS ? r.task.slice(0, TASK_PREVIEW_MAX_CHARS) + "…" : r.task)
    : "";

  const parts: string[] = [];
  parts.push(`<div class="gsd-agent-card ${stateClass}">`);
  parts.push(`<div class="gsd-agent-header">`);
  parts.push(`<div class="gsd-agent-header-left">${icon}<span class="gsd-agent-name">${escapeHtml(r.agent)}</span></div>`);
  parts.push(buildUsagePills(r.usage, r.model));
  parts.push(`</div>`);

  if (taskPreview) {
    parts.push(`<div class="gsd-agent-task">${escapeHtml(taskPreview)}</div>`);
  }

  if (failed && r.errorMessage) {
    parts.push(`<div class="gsd-agent-error">${escapeHtml(r.errorMessage)}</div>`);
  }

  parts.push(`</div>`);
  return parts.join("");
}

/** Build rich HTML for subagent results instead of plain text */
export function buildSubagentOutputHtml(tc: ToolCallState): string {
  const text = tc.resultText;
  const args = tc.args;
  const details = tc.details as { mode?: string; results?: SubagentResult[] } | undefined;
  const mode = details?.mode || (args.chain ? "chain" : args.tasks ? "parallel" : "single");
  const results = details?.results;

  // If we have structured details with per-agent results, render cards
  if (results && results.length > 0) {
    const running = results.filter((r) => r.exitCode === -1).length;
    const done = results.filter((r) => r.exitCode !== -1 && r.exitCode === 0).length;
    const failed = results.filter((r) => r.exitCode > 0 || r.stopReason === "error").length;
    const total = results.length;

    const parts: string[] = [];
    parts.push(`<div class="gsd-subagent-panel">`);

    // Summary bar
    const modeLabel = mode === "chain" ? "Chain" : mode === "parallel" ? "Parallel" : "Agent";
    const statusParts: string[] = [];
    if (done > 0) statusParts.push(`<span class="gsd-agent-stat done">${done} done</span>`);
    if (running > 0) statusParts.push(`<span class="gsd-agent-stat running">${running} running</span>`);
    if (failed > 0) statusParts.push(`<span class="gsd-agent-stat error">${failed} failed</span>`);
    parts.push(`<div class="gsd-subagent-summary">`);
    parts.push(`<span class="gsd-subagent-mode">${escapeHtml(modeLabel)}</span>`);
    parts.push(`<span class="gsd-subagent-counts">${statusParts.join(`<span class="gsd-agent-sep">·</span>`)}</span>`);
    parts.push(`<span class="gsd-subagent-total">${done + failed}/${total}</span>`);
    parts.push(`</div>`);

    // Agent cards
    parts.push(`<div class="gsd-agent-cards">`);
    for (const r of results) {
      parts.push(buildAgentCard(r, tc.isRunning));
    }
    parts.push(`</div>`);

    // Aggregate usage for completed runs
    if (!tc.isRunning) {
      const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
      for (const r of results) {
        if (r.usage) {
          totalUsage.input += r.usage.input || 0;
          totalUsage.output += r.usage.output || 0;
          totalUsage.cost += r.usage.cost || 0;
          totalUsage.turns += r.usage.turns || 0;
        }
      }
      if (totalUsage.turns > 0) {
        parts.push(`<div class="gsd-subagent-footer">${buildUsagePills(totalUsage)}</div>`);
      }
    }

    parts.push(`</div>`);

    // If completed, also render the final output as markdown below
    if (!tc.isRunning && text) {
      parts.push(`<div class="gsd-subagent-result">${renderMarkdown(text)}</div>`);
    }

    return parts.join("");
  }

  // Fallback: no structured details, use legacy rendering
  if (tc.isRunning) {
    const agentName = (args.agent as string) ||
                      (args.chain as Record<string, unknown>[] | undefined)?.[0]?.agent ||
                      (args.tasks as Record<string, unknown>[] | undefined)?.[0]?.agent || "agent";
    const taskCount = (args.chain as unknown[] | undefined)?.length || (args.tasks as unknown[] | undefined)?.length || 1;

    const parts: string[] = [];
    parts.push(`<div class="gsd-subagent-live">`);
    parts.push(`<div class="gsd-subagent-status">`);
    parts.push(`<span class="gsd-tool-spinner"></span>`);

    if (mode === "chain") {
      parts.push(` Chain: ${taskCount} steps`);
    } else if (mode === "parallel") {
      parts.push(` Parallel: ${taskCount} tasks`);
    } else {
      parts.push(` ${escapeHtml(agentName)}`);
    }
    parts.push(`</div>`);

    if (text) {
      parts.push(`<div class="gsd-subagent-progress">${escapeHtml(text)}</div>`);
    }
    parts.push(`</div>`);
    return parts.join("");
  }

  if (!text) return `<span class="gsd-tool-output-pending">(no output)</span>`;

  return `<div class="gsd-subagent-result">${renderMarkdown(text)}</div>`;
}

// ============================================================
// Markdown rendering
// ============================================================

/**
 * Sanitize HTML and apply post-processing: DOMPurify sanitize, table wrapping,
 * and file-path link detection. Reusable for both full-document and per-block rendering.
 */
export function sanitizeAndPostProcess(html: string): string {
  // Sanitize HTML output — strips script tags, event handlers, dangerous attributes
  let result = DOMPurify.sanitize(html, {
    ADD_TAGS: ["details", "summary"],
    ADD_ATTR: ["class", "data-code-id", "data-path", "data-idx", "data-value", "data-action", "data-model", "title", "disabled"],
  });

  // Wrap bare <table> elements in a scrollable container
  result = result.replace(/<table>/g, '<div class="gsd-table-wrapper"><table>');
  result = result.replace(/<\/table>/g, '</table></div>');
  // Detect file paths in <code> blocks and make them clickable
  result = result.replace(/<code>([^<]+)<\/code>/g, (_match, content: string) => {
    const decoded = content.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'");
    if (isLikelyFilePath(decoded)) {
      return `<code class="gsd-file-link" data-path="${escapeAttr(decoded)}">${content}</code>`;
    }
    return `<code>${content}</code>`;
  });
  return result;
}

/**
 * Tokenize markdown text into block-level tokens using marked's Lexer.
 * Returns the token array with the `links` property preserved for Parser use.
 */
export function lexMarkdown(text: string): TokensList {
  const lexer = new marked.Lexer({ breaks: true, gfm: true });
  return lexer.lex(text);
}

/**
 * Parse a subset of block tokens into HTML using marked's Parser.
 * The `tokens` array must have a `links` property (from the original lex result).
 * Uses the same custom renderer as `renderMarkdown()` for consistent output.
 */
export function parseTokens(tokens: Token[]): string {
  return marked.Parser.parse(tokens, { renderer });
}

/** Render markdown text to sanitized HTML using marked with custom renderers for links, code blocks, and images. */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  try {
    const html = marked.parse(text, { renderer }) as string;
    return sanitizeAndPostProcess(html);
  } catch {
    return `<p>${escapeHtml(text)}</p>`;
  }
}

/** Heuristic: does this look like a file path? */
export function isLikelyFilePath(s: string): boolean {
  if (s.includes("\n") || s.length > 200 || s.length < 3) return false;
  if (/^[A-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith("/") && !s.startsWith("//") && /\.\w+$/.test(s)) return true;
  if (/[/\\]/.test(s) && /\.\w{1,10}$/.test(s) && !s.includes(" ")) return true;
  if (/^\.?\w[\w.-]*\.\w{1,10}$/.test(s) && !s.includes(" ")) return true;
  return false;
}

// ============================================================
// Time formatting
// ============================================================

/** Format a Unix timestamp as a relative time string (e.g. `"5s ago"`, `"3m ago"`, `"2h ago"`). */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < RELATIVE_TIME_5S_MS) return "just now";
  if (diff < RELATIVE_TIME_1M_MS) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < RELATIVE_TIME_1H_MS) return `${Math.floor(diff / RELATIVE_TIME_1M_MS)}m ago`;
  if (diff < RELATIVE_TIME_1D_MS) return `${Math.floor(diff / RELATIVE_TIME_1H_MS)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ============================================================
// DOM helpers
// ============================================================

/**
 * Scroll to bottom of a container.
 * When `force` is false (default), only scrolls if already near the bottom.
 * This prevents hijacking the viewport when the user has scrolled up to review.
 */
/**
 * Convert simple markdown to HTML for release notes / changelog display.
 * Handles headers, bold, code, lists. NOT for full markdown — use renderMarkdown() for that.
 */
export function formatMarkdownNotes(md: string): string {
  if (!md.trim()) return "<p>No details available.</p>";
  const result = escapeHtml(md)
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n{2,}/g, '<br>')
    .replace(/\n/g, ' ');
  return DOMPurify.sanitize(result);
}

/**
 * Format an ISO date string to a short human-readable form.
 */
export function formatShortDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

/**
 * Auto-scroll to bottom of the message container.
 *
 * Uses intent-based tracking: we track whether the user has actively scrolled
 * away from the bottom (userScrolledUp). Auto-scroll is suppressed when the
 * user has scrolled up, and re-enabled when they scroll back near the bottom
 * or click the scroll FAB.
 *
 * The `force` parameter bypasses intent tracking (used for user messages,
 * new sessions, etc.).
 */
let _userScrolledUp = false;
let _lastScrollTop = 0;
let _scrollContainer: HTMLElement | null = null;
let _scrollHandler: (() => void) | null = null;
let _programmaticScroll = false;
let _mutationObserver: MutationObserver | null = null;

/**
 * Initialize intent-based auto-scroll tracking on a container element.
 *
 * Attaches a scroll listener that tracks whether the user has actively scrolled
 * away from the bottom. Auto-scroll is suppressed when `userScrolledUp` is true
 * and re-enabled when the user scrolls back near the bottom.
 */
export function initAutoScroll(container: HTMLElement): void {
  // If already attached to this container, skip
  if (_scrollContainer === container) return;

  // Detach from previous container if any
  if (_scrollContainer && _scrollHandler) {
    _scrollContainer.removeEventListener("scroll", _scrollHandler);
  }
  if (_mutationObserver) {
    _mutationObserver.disconnect();
    _mutationObserver = null;
  }

  _lastScrollTop = container.scrollTop;
  _scrollContainer = container;

  _scrollHandler = () => {
    // Ignore scroll events triggered by our own scrollToBottom calls
    if (_programmaticScroll) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;

    if (scrollTop < _lastScrollTop && distFromBottom > 50) {
      // User actively scrolled up and is meaningfully away from bottom
      _userScrolledUp = true;
    } else if (distFromBottom < 30) {
      // User has reached the bottom (manually or content caught up)
      _userScrolledUp = false;
    }
    _lastScrollTop = scrollTop;
  };

  container.addEventListener("scroll", _scrollHandler, { passive: true });

  // MutationObserver watches for child additions and subtree changes — this
  // fires reliably when content grows inside the container, unlike ResizeObserver
  // which won't fire on a fixed-height flex container with overflow-y:auto.
  // Deferred via rAF to avoid forcing layout in the middle of a frame.
  let pendingScrollRaf: number | null = null;
  _mutationObserver = new MutationObserver(() => {
    if (pendingScrollRaf !== null) return;
    pendingScrollRaf = requestAnimationFrame(() => {
      pendingScrollRaf = null;
      scrollToBottom(container);
    });
  });
  _mutationObserver.observe(container, { childList: true, subtree: true, characterData: true });
  registerCleanup("auto-scroll-observer", () => { _mutationObserver?.disconnect(); _mutationObserver = null; });
}

/** Reset scroll tracking (e.g. new session, clear messages) */
export function resetAutoScroll(): void {
  _userScrolledUp = false;
  _lastScrollTop = 0;
}

/** Check if auto-scroll is currently suppressed by user intent */
export function isAutoScrollSuppressed(): boolean {
  return _userScrolledUp;
}

/**
 * Scroll a container to the bottom, respecting user intent.
 *
 * When `force` is false (default), only scrolls if the user hasn't actively scrolled up.
 * When `force` is true, scrolls unconditionally and resets the scroll-up tracking state.
 * Used for new user messages, session switches, and explicit scroll-to-bottom actions.
 */
export function scrollToBottom(container: HTMLElement, force = false): void {
  if (force) {
    _userScrolledUp = false;
  }
  if (_userScrolledUp) return;
  _programmaticScroll = true;
  container.scrollTop = container.scrollHeight;
  _lastScrollTop = container.scrollTop;
  _programmaticScroll = false;
}
