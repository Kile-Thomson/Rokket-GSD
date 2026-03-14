// ============================================================
// Webview Helpers — pure functions, formatting, markdown, tools
// ============================================================

import { marked } from "marked";
import DOMPurify from "dompurify";
import type { SessionStats } from "../shared/types";
import type { AppState, ToolCategory, ToolCallState } from "./state";

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

renderer.image = ({ href, title, text }: { href: string; title?: string; text: string }) => {
  return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}" title="${escapeAttr(title || "")}" class="gsd-md-image" />`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
});

// ============================================================
// HTML / string helpers
// ============================================================

export function escapeHtml(text: string): string {
  if (typeof text !== "string") text = String(text ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeAttr(text: string): string {
  return escapeHtml(text);
}

// ============================================================
// Formatting
// ============================================================

export function formatCost(cost: number | undefined): string {
  if (cost == null) return "$0.000";
  return `$${cost.toFixed(3)}`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function formatContextUsage(stats: SessionStats, model: AppState["model"]): string {
  const contextWindow = stats.contextWindow || model?.contextWindow || 0;
  const pct = stats.contextPercent;
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

export function shortenPath(p: string): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function truncateArg(s: string, max: number): string {
  const line = s.split("\n")[0];
  if (line.length <= max) return line;
  return line.slice(0, max - 1) + "…";
}

// ============================================================
// Tool helpers
// ============================================================

export function getToolCategory(name: string): ToolCategory {
  const n = name.toLowerCase();
  if (["read", "write", "edit"].includes(n)) return "file";
  if (n === "bg_shell") return "process";
  if (n === "bash") return "shell";
  if (n.startsWith("browser_") || n.startsWith("mac_")) return "browser";
  if (["search-the-web", "search_and_read", "fetch_page", "google_search",
       "resolve_library", "get_library_docs"].includes(n)) return "search";
  if (n === "subagent") return "agent";
  return "generic";
}

export function getToolIcon(name: string, category: ToolCategory): string {
  const n = name.toLowerCase();
  if (n === "read") return "📄";
  if (n === "write") return "✏️";
  if (n === "edit") return "✂️";
  if (n === "bash") return "⌨";
  if (n === "bg_shell") return "⚙";
  if (n === "subagent") return "🤖";
  if (n.startsWith("browser_")) return "🌐";
  if (n.startsWith("mac_")) return "🖥";
  if (category === "search") return "🔍";
  return "⚡";
}

export function getToolKeyArg(name: string, args: Record<string, unknown>): string {
  const n = name.toLowerCase();
  if (n === "bash" && args.command) return truncateArg(String(args.command), 80);
  if ((n === "read" || n === "write" || n === "edit") && args.path) return truncateArg(String(args.path), 80);
  if (n === "browser_navigate" && args.url) return truncateArg(String(args.url), 60);
  if (n === "browser_click" && args.selector) return truncateArg(String(args.selector), 60);
  if (n === "subagent") {
    const agent = args.agent || (args.chain as any)?.[0]?.agent || (args.tasks as any)?.[0]?.agent || "";
    const task = args.task || "";
    if (agent) return truncateArg(`${agent}: ${task}`, 80);
    if (task) return truncateArg(String(task), 80);
    return "";
  }
  if (n === "bg_shell") {
    const action = args.action ? String(args.action) : "";
    const cmd = args.command ? truncateArg(String(args.command), 60) : "";
    const label = args.label ? String(args.label) : "";
    if (action === "start" && (label || cmd)) return `start: ${label || cmd}`;
    if (action && args.id) return `${action}: ${args.id}`;
    return action || "";
  }
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
        const questions = (args.questions as any[]) || [];
        const lines: string[] = [];
        for (const [id, answer] of Object.entries(parsed.answers) as [string, any][]) {
          const q = questions.find((q: any) => q.id === id);
          const header = q?.header || id;
          const selections = answer.answers || [];
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

/** Build rich HTML for subagent results instead of plain text */
export function buildSubagentOutputHtml(tc: ToolCallState): string {
  const text = tc.resultText;
  const args = tc.args;
  const mode = args.chain ? "chain" : args.tasks ? "parallel" : "single";

  if (tc.isRunning) {
    const agentName = (args.agent as string) ||
                      (args.chain as any[])?.[0]?.agent ||
                      (args.tasks as any[])?.[0]?.agent || "agent";
    const taskCount = (args.chain as any[])?.length || (args.tasks as any[])?.length || 1;

    let html = `<div class="gsd-subagent-live">`;
    html += `<div class="gsd-subagent-status">`;
    html += `<span class="gsd-tool-spinner"></span>`;

    if (mode === "chain") {
      html += ` Chain: ${taskCount} steps`;
    } else if (mode === "parallel") {
      html += ` Parallel: ${taskCount} tasks`;
    } else {
      html += ` ${escapeHtml(agentName)}`;
    }
    html += `</div>`;

    if (text) {
      html += `<div class="gsd-subagent-progress">${escapeHtml(text)}</div>`;
    }
    html += `</div>`;
    return html;
  }

  if (!text) return `<span class="gsd-tool-output-pending">(no output)</span>`;

  return `<div class="gsd-subagent-result">${renderMarkdown(text)}</div>`;
}

// ============================================================
// Markdown rendering
// ============================================================

export function renderMarkdown(text: string): string {
  if (!text) return "";
  try {
    let html = marked.parse(text, { renderer }) as string;

    // Sanitize HTML output — strips script tags, event handlers, dangerous attributes
    html = DOMPurify.sanitize(html, {
      ADD_TAGS: ["details", "summary"],
      ADD_ATTR: ["class", "data-code-id", "data-path", "data-idx", "data-value", "data-action", "title"],
    });

    // Wrap bare <table> elements in a scrollable container
    html = html.replace(/<table>/g, '<div class="gsd-table-wrapper"><table>');
    html = html.replace(/<\/table>/g, '</table></div>');
    // Detect file paths in <code> blocks and make them clickable
    html = html.replace(/<code>([^<]+)<\/code>/g, (_match, content: string) => {
      const decoded = content.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'");
      if (isLikelyFilePath(decoded)) {
        return `<code class="gsd-file-link" data-path="${escapeAttr(decoded)}">${content}</code>`;
      }
      return `<code>${content}</code>`;
    });
    return html;
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

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
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
  return escapeHtml(md)
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

export function scrollToBottom(container: HTMLElement, force = false): void {
  requestAnimationFrame(() => {
    if (force || container.scrollHeight - container.scrollTop - container.clientHeight < 150) {
      container.scrollTop = container.scrollHeight;
    }
  });
}
