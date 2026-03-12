// ============================================================
// GSD Webview — Full-featured Chat UI
// Vanilla DOM for minimal bundle size. Uses marked for markdown.
// ============================================================

import { marked } from "marked";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  ImageAttachment,
  GsdState,
  SessionStats,
  CommandInfo,
  ProcessStatus,
} from "../shared/types";
import "./styles.css";

// VS Code API
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ============================================================
// Configure marked
// ============================================================

marked.setOptions({
  breaks: true,
  gfm: true,
});

// Custom renderer for links — open externally
const renderer = new marked.Renderer();
renderer.link = ({ href, text }: { href: string; text: string }) => {
  return `<a href="${escapeAttr(href)}" class="gsd-link" title="${escapeAttr(href)}">${text}</a>`;
};
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const langLabel = lang || "text";
  const id = `code-${++codeBlockIdCounter}`;
  return `<div class="gsd-code-block" data-code-id="${id}">
    <div class="gsd-code-header">
      <span class="gsd-code-lang">${escapeHtml(langLabel)}</span>
      <button class="gsd-copy-btn" data-code-id="${id}">Copy</button>
    </div>
    <pre><code class="language-${escapeAttr(langLabel)}">${escapeHtml(text)}</code></pre>
  </div>`;
};
renderer.image = ({ href, title, text }: { href: string; title?: string; text: string }) => {
  return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}" title="${escapeAttr(title || "")}" class="gsd-md-image" />`;
};

let codeBlockIdCounter = 0;

// ============================================================
// State
// ============================================================

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  resultText: string;
  isError: boolean;
  isRunning: boolean;
  startTime: number;
  endTime?: number;
}

/** A segment in the sequential stream — text, thinking, or tool call */
type TurnSegment =
  | { type: "text"; chunks: string[] }
  | { type: "thinking"; chunks: string[] }
  | { type: "tool"; toolCallId: string };

/** One assistant turn = ordered sequence of segments */
interface AssistantTurn {
  id: string;
  /** Ordered segments in the sequence they arrived */
  segments: TurnSegment[];
  /** Quick lookup for tool calls by ID */
  toolCalls: Map<string, ToolCallState>;
  isComplete: boolean;
  timestamp: number;
}

interface ChatEntry {
  id: string;
  type: "user" | "assistant" | "system";
  // For user
  text?: string;
  images?: ImageAttachment[];
  // For assistant — a turn with grouped content
  turn?: AssistantTurn;
  // For system
  systemText?: string;
  systemKind?: "info" | "error" | "warning";
  timestamp: number;
}

interface AppState {
  entries: ChatEntry[];
  isStreaming: boolean;
  isCompacting: boolean;
  isRetrying: boolean;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage: string };
  model: { id: string; name: string; provider: string; contextWindow?: number } | null;
  thinkingLevel: string;
  processStatus: ProcessStatus;
  images: ImageAttachment[];
  useCtrlEnterToSend: boolean;
  cwd: string;
  version: string;
  sessionStats: SessionStats;
  commands: CommandInfo[];
  commandsLoaded: boolean;
  availableModels: AvailableModel[];
  modelsLoaded: boolean;
  // Track the current in-progress assistant turn
  currentTurn: AssistantTurn | null;
}

interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
}

const state: AppState = {
  entries: [],
  isStreaming: false,
  isCompacting: false,
  isRetrying: false,
  model: null,
  thinkingLevel: "off",
  processStatus: "stopped",
  images: [],
  useCtrlEnterToSend: false,
  cwd: "",
  version: "",
  sessionStats: {},
  commands: [],
  commandsLoaded: false,
  availableModels: [],
  modelsLoaded: false,
  currentTurn: null,
};

let entryIdCounter = 0;
function nextId(): string {
  return `e-${++entryIdCounter}`;
}

// ============================================================
// DOM Setup
// ============================================================

const root = document.getElementById("root")!;
root.innerHTML = `
  <div class="gsd-app">
    <header class="gsd-header">
      <div class="gsd-header-brand">
        <span class="gsd-logo">🚀</span>
        <span class="gsd-title">Rokket GSD</span>
      </div>
      <div class="gsd-header-info">
        <span class="gsd-model-badge" id="modelBadge" title="Model"></span>
        <span class="gsd-thinking-badge" id="thinkingBadge" title="Thinking level"></span>
        <span class="gsd-cost-badge" id="costBadge" title="Session cost"></span>
        <span class="gsd-context-badge" id="contextBadge" title="Context usage"></span>
      </div>
      <div class="gsd-header-actions">
        <button class="gsd-action-btn" id="compactBtn" title="Compact context — reduce token usage">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H8L7 3v3h1V3h6v5h-4l-1 1v2H8v1h2l3-3h1l1-1V3l-1-1zM9 7H3L2 8v5l1 1h6l1-1V8L9 7zm0 6H3V8h6v5z"/></svg>
          <span>Compact</span>
        </button>
        <button class="gsd-action-btn" id="exportBtn" title="Export conversation as HTML">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13 1H5L4 2v3h1V2h8v12H5v-3H4v3l1 1h8l1-1V2l-1-1zM1 8l3-3v2h5v2H4v2L1 8z"/></svg>
          <span>Export</span>
        </button>
        <button class="gsd-action-btn" id="modelPickerBtn" title="Change AI model">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm0-9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM4.5 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm7 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/></svg>
          <span>Model</span>
        </button>
        <button class="gsd-action-btn primary" id="newConvoBtn" title="Start a new conversation">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a.5.5 0 01.5.5V7H14a.5.5 0 010 1H8.5v5.5a.5.5 0 01-1 0V8H2a.5.5 0 010-1h5.5V1.5A.5.5 0 018 1z"/></svg>
          <span>New</span>
        </button>
      </div>
    </header>

    <div class="gsd-overlay-indicators" id="overlayIndicators"></div>

    <main class="gsd-messages" id="messagesContainer">
      <div class="gsd-welcome" id="welcomeScreen">
        <div class="gsd-welcome-logo">
          <pre class="gsd-welcome-ascii">
 ██████╗ ███████╗██████╗
██╔════╝ ██╔════╝██╔══██╗
██║  ███╗███████╗██║  ██║
██║   ██║╚════██║██║  ██║
╚██████╔╝███████║██████╔╝
 ╚═════╝ ╚══════╝╚═════╝</pre>
        </div>
        <div class="gsd-welcome-title">Get Shit Done <span class="gsd-welcome-version" id="welcomeVersion"></span></div>
        <div class="gsd-welcome-sub" id="welcomeProcess">Initializing...</div>
        <div class="gsd-welcome-model" id="welcomeModel"></div>
        <div class="gsd-welcome-hints" id="welcomeHints"></div>
        <div class="gsd-welcome-attribution">
          <span class="gsd-rokketek-mark">▲ ROKKETEK</span>
        </div>
      </div>
    </main>

    <div class="gsd-slash-menu" id="slashMenu"></div>
    <div class="gsd-model-picker" id="modelPicker"></div>

    <div class="gsd-input-area">
      <div class="gsd-image-preview" id="imagePreview"></div>
      <div class="gsd-input-row">
        <div class="gsd-input-wrapper">
          <textarea id="promptInput" class="gsd-input" placeholder="Message GSD..." rows="1"></textarea>
        </div>
        <button class="gsd-send-btn" id="sendBtn" title="Send">
          <span id="sendIcon">↑</span>
        </button>
      </div>
      <div class="gsd-input-hint" id="inputHint"></div>
    </div>

    <footer class="gsd-footer" id="footer">
      <div class="gsd-footer-line" id="footerLine1">
        <span class="gsd-footer-cwd" id="footerCwd" title="Working directory"></span>
        <span class="gsd-footer-brand">▲ ROKKETEK</span>
      </div>
      <div class="gsd-footer-line" id="footerLine2">
        <span class="gsd-footer-stats" id="footerStats"></span>
        <span class="gsd-footer-right" id="footerRight"></span>
      </div>
    </footer>
  </div>
`;

// Element refs
const messagesContainer = document.getElementById("messagesContainer")!;
const welcomeScreen = document.getElementById("welcomeScreen")!;
const welcomeProcess = document.getElementById("welcomeProcess")!;
const welcomeVersion = document.getElementById("welcomeVersion")!;
const welcomeModel = document.getElementById("welcomeModel")!;
const welcomeHints = document.getElementById("welcomeHints")!;
const promptInput = document.getElementById("promptInput") as HTMLTextAreaElement;
const sendBtn = document.getElementById("sendBtn")!;
const sendIcon = document.getElementById("sendIcon")!;
const newConvoBtn = document.getElementById("newConvoBtn")!;
const modelPickerBtn = document.getElementById("modelPickerBtn")!;
const compactBtn = document.getElementById("compactBtn")!;
const exportBtn = document.getElementById("exportBtn")!;
const imagePreview = document.getElementById("imagePreview")!;
const inputHint = document.getElementById("inputHint")!;
const slashMenu = document.getElementById("slashMenu")!;
const modelPicker = document.getElementById("modelPicker")!;
const overlayIndicators = document.getElementById("overlayIndicators")!;

// Header badges
const modelBadge = document.getElementById("modelBadge")!;
const thinkingBadge = document.getElementById("thinkingBadge")!;
const costBadge = document.getElementById("costBadge")!;
const contextBadge = document.getElementById("contextBadge")!;

// Footer
const footerCwd = document.getElementById("footerCwd")!;
const footerStats = document.getElementById("footerStats")!;
const footerRight = document.getElementById("footerRight")!;

// ============================================================
// Helpers
// ============================================================

function escapeHtml(text: string): string {
  if (typeof text !== "string") text = String(text ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

function formatCost(cost: number | undefined): string {
  if (cost == null) return "$0.000";
  return `$${cost.toFixed(3)}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function formatContextUsage(stats: SessionStats, model: AppState["model"]): string {
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

function shortenPath(p: string): string {
  if (!p) return "";
  // Show last 2 segments
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Tool categorization for icons & color accents */
type ToolCategory = "file" | "shell" | "browser" | "search" | "agent" | "process" | "generic";

function getToolCategory(name: string): ToolCategory {
  const n = name.toLowerCase();
  if (["read", "write", "edit"].includes(n)) return "file";
  if (n === "bash" || n === "bg_shell") return "shell";
  if (n.startsWith("browser_") || n.startsWith("mac_")) return "browser";
  if (["search-the-web", "search_and_read", "fetch_page", "google_search",
       "resolve_library", "get_library_docs"].includes(n)) return "search";
  if (n === "subagent") return "agent";
  if (["bg_shell"].includes(n)) return "process";
  return "generic";
}

function getToolIcon(name: string, category: ToolCategory): string {
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

function getToolKeyArg(name: string, args: Record<string, unknown>): string {
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
  // Generic: show first string arg
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 0 && k !== "content" && k !== "oldText" && k !== "newText") {
      return truncateArg(v, 60);
    }
  }
  return "";
}

function truncateArg(s: string, max: number): string {
  const line = s.split("\n")[0];
  if (line.length <= max) return line;
  return line.slice(0, max - 1) + "…";
}

/** Format tool results for display — special handling for known tools */
function formatToolResult(toolName: string, resultText: string, args: Record<string, unknown>): string {
  const n = toolName.toLowerCase();

  // ask_user_questions: parse the JSON and show a clean summary
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

/** Check if a tool result has structured details (subagent, bg_shell, etc.) */
function hasStructuredDetails(toolName: string, resultText: string): boolean {
  const n = toolName.toLowerCase();
  return n === "subagent" || n === "bg_shell";
}

/** Build rich HTML for subagent results instead of plain text */
function buildSubagentOutputHtml(tc: ToolCallState): string {
  // Try to parse subagent details from the tool_execution_update/end events
  // The details come through in the result, but we only get the text content.
  // Parse the text to extract structure.
  const text = tc.resultText;
  const args = tc.args;
  const mode = args.chain ? "chain" : args.tasks ? "parallel" : "single";

  if (tc.isRunning) {
    // During execution — show activity
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
      // Show streaming progress text
      html += `<div class="gsd-subagent-progress">${escapeHtml(text)}</div>`;
    }
    html += `</div>`;
    return html;
  }

  // Completed — render the final output as markdown for rich formatting
  if (!text) return `<span class="gsd-tool-output-pending">(no output)</span>`;

  // Render the result text as markdown for tables, code blocks, etc.
  return `<div class="gsd-subagent-result">${renderMarkdown(text)}</div>`;
}

function renderMarkdown(text: string): string {
  if (!text) return "";
  try {
    let html = marked.parse(text, { renderer }) as string;
    // Wrap bare <table> elements in a scrollable container for overflow
    html = html.replace(/<table>/g, '<div class="gsd-table-wrapper"><table>');
    html = html.replace(/<\/table>/g, '</table></div>');
    // Detect file paths in <code> blocks and make them clickable
    // Matches paths like /foo/bar.ts, C:\foo\bar.ts, src/foo/bar.ts
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
function isLikelyFilePath(s: string): boolean {
  // Must have an extension or be a recognizable path pattern
  if (s.includes("\n") || s.length > 200 || s.length < 3) return false;
  // Windows absolute path
  if (/^[A-Z]:[\\\/]/.test(s)) return true;
  // Unix absolute path
  if (s.startsWith("/") && !s.startsWith("//") && /\.\w+$/.test(s)) return true;
  // Relative path with extension — must have at least one / or \
  if (/[\/\\]/.test(s) && /\.\w{1,10}$/.test(s) && !s.includes(" ")) return true;
  // Common config files
  if (/^\.?\w[\w.-]*\.\w{1,10}$/.test(s) && !s.includes(" ")) return true;
  return false;
}

function scrollToBottom(): void {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ============================================================
// Auto-resize textarea
// ============================================================

function autoResize(): void {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + "px";
}
promptInput.addEventListener("input", autoResize);

// ============================================================
// Image paste & drop
// ============================================================

function handleFiles(files: FileList | File[]): void {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      state.images.push({ type: "image", data: base64, mimeType: file.type });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  }
}

document.addEventListener("paste", (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  let hasImage = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      hasImage = true;
      const file = items[i].getAsFile();
      if (file) handleFiles([file]);
    }
  }
  if (hasImage) e.preventDefault();
});

const inputArea = root.querySelector(".gsd-input-area")!;
inputArea.addEventListener("dragover", (e: Event) => {
  e.preventDefault();
  (e as DragEvent).dataTransfer!.dropEffect = "copy";
  inputArea.classList.add("drag-over");
});
inputArea.addEventListener("dragleave", () => inputArea.classList.remove("drag-over"));
inputArea.addEventListener("drop", (e: Event) => {
  e.preventDefault();
  inputArea.classList.remove("drag-over");
  const dt = (e as DragEvent).dataTransfer;
  if (dt?.files.length) handleFiles(dt.files);
});

function renderImagePreviews(): void {
  if (state.images.length === 0) {
    imagePreview.style.display = "none";
    imagePreview.innerHTML = "";
    return;
  }
  imagePreview.style.display = "flex";
  imagePreview.innerHTML = state.images.map((img, i) => `
    <div class="gsd-image-thumb">
      <img src="data:${img.mimeType};base64,${img.data}" alt="Attached" />
      <button class="gsd-image-remove" data-idx="${i}">×</button>
    </div>
  `).join("");

  imagePreview.querySelectorAll(".gsd-image-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt((btn as HTMLElement).dataset.idx!);
      state.images.splice(idx, 1);
      renderImagePreviews();
    });
  });
}

// ============================================================
// Slash command menu
// ============================================================

let slashMenuVisible = false;
let slashMenuIndex = 0;

interface SlashMenuItem {
  name: string;
  description: string;
  insertText: string; // what gets inserted into the input
  source?: string;
}

let filteredItems: SlashMenuItem[] = [];

/** Expand commands into individual menu items, breaking out subcommands */
function buildSlashItems(): SlashMenuItem[] {
  const items: SlashMenuItem[] = [];

  // GSD subcommands — expand into individual items
  const gsdSubcommands: Array<{ name: string; desc: string }> = [
    { name: "gsd", desc: "Contextual wizard — pick the next action" },
    { name: "gsd next", desc: "Execute the next task" },
    { name: "gsd auto", desc: "Auto-execute tasks (fresh context per task)" },
    { name: "gsd stop", desc: "Stop auto-mode" },
    { name: "gsd status", desc: "Progress dashboard" },
    { name: "gsd queue", desc: "Queue future milestones" },
    { name: "gsd discuss", desc: "Discuss without executing" },
    { name: "gsd prefs", desc: "View or set preferences" },
    { name: "gsd doctor", desc: "Diagnose and fix issues" },
    { name: "gsd migrate", desc: "Migrate project artifacts" },
    { name: "gsd remote", desc: "Remote question channels (Slack, Discord)" },
  ];

  for (const sub of gsdSubcommands) {
    items.push({
      name: sub.name,
      description: sub.desc,
      insertText: `/${sub.name} `,
      source: "gsd",
    });
  }

  // Add other registered commands (skip "gsd" since we expanded it)
  for (const cmd of state.commands) {
    if (cmd.name === "gsd") continue;
    items.push({
      name: cmd.name,
      description: cmd.description || "",
      insertText: `/${cmd.name} `,
      source: cmd.source,
    });
  }

  // Add built-in webview actions
  items.push(
    { name: "compact", description: "Compact context to reduce token usage", insertText: "", source: "webview" },
    { name: "export", description: "Export conversation as HTML", insertText: "", source: "webview" },
    { name: "model", description: "Change AI model", insertText: "", source: "webview" },
    { name: "thinking", description: "Cycle thinking level", insertText: "", source: "webview" },
    { name: "new", description: "Start a new conversation", insertText: "", source: "webview" },
  );

  return items;
}

function showSlashMenu(filter: string): void {
  if (!state.commandsLoaded) {
    vscode.postMessage({ type: "get_commands" });
  }
  const q = filter.toLowerCase();
  const allItems = buildSlashItems();
  filteredItems = allItems.filter(
    (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
  );
  if (filteredItems.length === 0) {
    hideSlashMenu();
    return;
  }
  slashMenuIndex = 0;
  slashMenuVisible = true;
  renderSlashMenu();
}

function hideSlashMenu(): void {
  slashMenuVisible = false;
  slashMenu.style.display = "none";
  slashMenu.innerHTML = "";
}

function renderSlashMenu(): void {
  slashMenu.style.display = "block";
  slashMenu.innerHTML = filteredItems.map((item, i) => `
    <div class="gsd-slash-item ${i === slashMenuIndex ? "active" : ""}" data-idx="${i}">
      <span class="gsd-slash-name">/${escapeHtml(item.name)}</span>
      <span class="gsd-slash-desc">${escapeHtml(item.description)}</span>
    </div>
  `).join("");

  slashMenu.querySelectorAll(".gsd-slash-item").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt((el as HTMLElement).dataset.idx!);
      selectSlashCommand(idx);
    });
  });

  // Scroll active item into view
  const activeEl = slashMenu.querySelector(".gsd-slash-item.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}

function selectSlashCommand(idx: number): void {
  const item = filteredItems[idx];
  if (!item) { hideSlashMenu(); return; }

  // Handle built-in webview actions directly
  if (item.source === "webview") {
    hideSlashMenu();
    switch (item.name) {
      case "compact":
        vscode.postMessage({ type: "compact_context" });
        promptInput.value = "";
        autoResize();
        break;
      case "export":
        vscode.postMessage({ type: "export_html" });
        promptInput.value = "";
        autoResize();
        break;
      case "model":
        promptInput.value = "";
        autoResize();
        showModelPicker();
        break;
      case "thinking":
        vscode.postMessage({ type: "cycle_thinking_level" });
        promptInput.value = "";
        autoResize();
        break;
      case "new":
        vscode.postMessage({ type: "new_conversation" });
        state.entries = [];
        state.currentTurn = null;
        currentTurnElement = null;
        segmentElements.clear();
        activeSegmentIndex = -1;
        state.sessionStats = {};
        clearMessages();
        welcomeScreen.style.display = "flex";
        promptInput.value = "";
        autoResize();
        updateAllUI();
        break;
    }
    promptInput.focus();
    return;
  }

  // Regular commands — insert into input and let user send
  promptInput.value = item.insertText;
  autoResize();
  promptInput.focus();
  hideSlashMenu();
}

promptInput.addEventListener("input", () => {
  const val = promptInput.value;
  if (val.startsWith("/") && !val.includes("\n")) {
    const filter = val.slice(1).trim();
    showSlashMenu(filter);
  } else {
    hideSlashMenu();
  }
});

// ============================================================
// Model picker
// ============================================================

let modelPickerVisible = false;

function toggleModelPicker(): void {
  if (modelPickerVisible) {
    hideModelPicker();
  } else {
    showModelPicker();
  }
}

function showModelPicker(): void {
  if (!state.modelsLoaded) {
    vscode.postMessage({ type: "get_available_models" });
  }
  modelPickerVisible = true;
  renderModelPicker();
}

function hideModelPicker(): void {
  modelPickerVisible = false;
  modelPicker.style.display = "none";
  modelPicker.innerHTML = "";
}

function renderModelPicker(): void {
  if (!modelPickerVisible) return;

  const models = state.availableModels;
  const currentId = state.model?.id;
  const currentProvider = state.model?.provider;

  if (models.length === 0) {
    modelPicker.style.display = "block";
    modelPicker.innerHTML = `<div class="gsd-model-picker-loading">
      <span class="gsd-tool-spinner"></span> Loading models…
    </div>`;
    return;
  }

  // Group models by provider
  const byProvider = new Map<string, AvailableModel[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) || [];
    list.push(m);
    byProvider.set(m.provider, list);
  }

  let html = `<div class="gsd-model-picker-header">
    <span class="gsd-model-picker-title">Select Model</span>
    <button class="gsd-model-picker-close" id="modelPickerClose">✕</button>
  </div>`;

  for (const [provider, providerModels] of byProvider) {
    html += `<div class="gsd-model-picker-group">
      <div class="gsd-model-picker-provider">${escapeHtml(provider)}</div>`;
    for (const m of providerModels) {
      const isCurrent = m.id === currentId && m.provider === currentProvider;
      const ctxStr = m.contextWindow ? formatTokens(m.contextWindow) : "";
      const reasoningTag = m.reasoning ? `<span class="gsd-model-tag reasoning">reasoning</span>` : "";
      html += `<div class="gsd-model-picker-item ${isCurrent ? "current" : ""}" 
                    data-provider="${escapeAttr(m.provider)}" 
                    data-model-id="${escapeAttr(m.id)}">
        <div class="gsd-model-picker-name">
          ${isCurrent ? '<span class="gsd-model-current-dot">●</span>' : ""}
          ${escapeHtml(m.name || m.id)}
        </div>
        <div class="gsd-model-picker-meta">
          ${ctxStr ? `<span class="gsd-model-ctx">${ctxStr} ctx</span>` : ""}
          ${reasoningTag}
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  modelPicker.style.display = "block";
  modelPicker.innerHTML = html;

  // Event listeners
  modelPicker.querySelector("#modelPickerClose")?.addEventListener("click", hideModelPicker);
  modelPicker.querySelectorAll(".gsd-model-picker-item").forEach((el) => {
    el.addEventListener("click", () => {
      const provider = (el as HTMLElement).dataset.provider!;
      const modelId = (el as HTMLElement).dataset.modelId!;
      vscode.postMessage({ type: "set_model", provider, modelId });
      hideModelPicker();
      // Optimistic update
      if (state.model) {
        state.model.id = modelId;
        state.model.provider = provider;
        const m = state.availableModels.find((m) => m.id === modelId && m.provider === provider);
        if (m) {
          state.model.name = m.name || m.id;
          state.model.contextWindow = m.contextWindow;
        }
      }
      updateHeaderUI();
      updateFooterUI();
      // Re-fetch state to confirm
      setTimeout(() => vscode.postMessage({ type: "get_state" }), 500);
    });
  });
}

modelPickerBtn.addEventListener("click", toggleModelPicker);
modelBadge.addEventListener("click", toggleModelPicker);
modelBadge.style.cursor = "pointer";

// Close picker when clicking outside
document.addEventListener("click", (e: Event) => {
  if (modelPickerVisible) {
    const target = e.target as HTMLElement;
    if (!modelPicker.contains(target) && target !== modelPickerBtn && !modelPickerBtn.contains(target) && target !== modelBadge) {
      hideModelPicker();
    }
  }
});

// ============================================================
// Send message
// ============================================================

// Follow-up queue — messages typed while agent is streaming
const followUpQueue: string[] = [];

function sendMessage(): void {
  hideSlashMenu();
  hideModelPicker();
  const text = promptInput.value.trim();
  if (!text && state.images.length === 0) return;

  // Handle ! bash shortcut
  if (text.startsWith("!") && !text.startsWith("!!") && text.length > 1 && !state.isStreaming) {
    const bashCmd = text.slice(1).trim();
    // Add as user entry with bash styling
    state.entries.push({
      id: nextId(),
      type: "user",
      text: `! ${bashCmd}`,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom();

    // Run bash directly
    vscode.postMessage({ type: "run_bash", command: bashCmd });
    promptInput.value = "";
    autoResize();
    return;
  }

  // If streaming and not a steer, queue as follow-up
  if (state.isStreaming) {
    // Add user entry
    state.entries.push({
      id: nextId(),
      type: "user",
      text,
      images: state.images.length > 0 ? [...state.images] : undefined,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom();

    // Steer the current run
    vscode.postMessage({
      type: "steer",
      message: text,
      images: state.images.length > 0 ? [...state.images] : undefined,
    } as WebviewToExtensionMessage);

    promptInput.value = "";
    state.images = [];
    renderImagePreviews();
    autoResize();
    return;
  }

  // Normal send
  if (text || state.images.length > 0) {
    state.entries.push({
      id: nextId(),
      type: "user",
      text,
      images: state.images.length > 0 ? [...state.images] : undefined,
      timestamp: Date.now(),
    });
    welcomeScreen.style.display = "none";
    renderNewEntry(state.entries[state.entries.length - 1]);
    scrollToBottom();
  }

  const msg: WebviewToExtensionMessage = {
    type: "prompt",
    message: text,
    images: state.images.length > 0 ? [...state.images] : undefined,
  };
  vscode.postMessage(msg);

  promptInput.value = "";
  state.images = [];
  renderImagePreviews();
  autoResize();
}

// ============================================================
// Keyboard handling
// ============================================================

promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
  // Slash menu navigation
  if (slashMenuVisible) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      slashMenuIndex = Math.min(slashMenuIndex + 1, filteredItems.length - 1);
      renderSlashMenu();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      slashMenuIndex = Math.max(slashMenuIndex - 1, 0);
      renderSlashMenu();
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectSlashCommand(slashMenuIndex);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  if (state.useCtrlEnterToSend) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  } else {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
  if (e.key === "Escape" && state.isStreaming) {
    vscode.postMessage({ type: "interrupt" });
  }
});

sendBtn.addEventListener("click", () => {
  if (state.isStreaming) {
    vscode.postMessage({ type: "interrupt" });
  } else {
    sendMessage();
  }
});

newConvoBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "new_conversation" });
  state.entries = [];
  state.currentTurn = null;
  currentTurnElement = null;
  segmentElements.clear();
  activeSegmentIndex = -1;
  state.sessionStats = {};
  clearMessages();
  welcomeScreen.style.display = "flex";
  updateAllUI();
});

// Compact context button
compactBtn.addEventListener("click", () => {
  if (!state.isStreaming) {
    vscode.postMessage({ type: "compact_context" });
  }
});

// Export HTML button
exportBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "export_html" });
});

// Thinking badge — click to cycle
thinkingBadge.addEventListener("click", () => {
  vscode.postMessage({ type: "cycle_thinking_level" });
});
thinkingBadge.style.cursor = "pointer";

// ============================================================
// Global click handlers (copy, file links, url links, tool toggles)
// ============================================================

document.addEventListener("click", (e: Event) => {
  const target = e.target as HTMLElement;

  // Copy button on code blocks
  const copyBtn = target.closest(".gsd-copy-btn") as HTMLElement | null;
  if (copyBtn) {
    const codeBlock = copyBtn.closest(".gsd-code-block");
    const code = codeBlock?.querySelector("code")?.textContent || "";
    vscode.postMessage({ type: "copy_text", text: code });
    copyBtn.textContent = "✓ Copied";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
    return;
  }

  // File path links
  if (target.classList.contains("gsd-file-link")) {
    const path = target.dataset.path;
    if (path) vscode.postMessage({ type: "open_file", path });
    return;
  }

  // URL links
  if (target.tagName === "A" && target.getAttribute("href")) {
    e.preventDefault();
    vscode.postMessage({ type: "open_url", url: target.getAttribute("href")! });
    return;
  }

  // Tool output toggle
  const toolHeader = target.closest(".gsd-tool-header") as HTMLElement | null;
  if (toolHeader) {
    const block = toolHeader.closest(".gsd-tool-block") as HTMLElement | null;
    if (block) {
      block.classList.toggle("collapsed");
    }
    return;
  }

  // Restart button
  if (target.closest("#restartBtn")) {
    vscode.postMessage({ type: "launch_gsd" });
    return;
  }
});

document.addEventListener("copy", (e: ClipboardEvent) => {
  const selection = window.getSelection()?.toString();
  if (selection) vscode.postMessage({ type: "copy_text", text: selection });
});

// ============================================================
// Rendering — incremental approach
// ============================================================

function clearMessages(): void {
  const els = messagesContainer.querySelectorAll(".gsd-entry");
  els.forEach((el) => el.remove());
}

/** Render a new entry at the bottom of the container */
function renderNewEntry(entry: ChatEntry): void {
  const el = createEntryElement(entry);
  messagesContainer.appendChild(el);
}

function createEntryElement(entry: ChatEntry): HTMLElement {
  const el = document.createElement("div");
  el.className = `gsd-entry gsd-entry-${entry.type}`;
  el.dataset.entryId = entry.id;

  if (entry.type === "user") {
    el.innerHTML = buildUserHtml(entry);
  } else if (entry.type === "assistant" && entry.turn) {
    el.innerHTML = buildTurnHtml(entry.turn);
  } else if (entry.type === "system") {
    el.innerHTML = buildSystemHtml(entry);
  }

  return el;
}

function buildUserHtml(entry: ChatEntry): string {
  let html = `<div class="gsd-user-bubble">`;
  if (entry.images?.length) {
    html += `<div class="gsd-user-images">${entry.images.map((img) =>
      `<img src="data:${img.mimeType};base64,${img.data}" class="gsd-user-img" alt="Image" />`
    ).join("")}</div>`;
  }
  html += escapeHtml(entry.text || "");
  html += `</div>`;
  return html;
}

function buildTurnHtml(turn: AssistantTurn): string {
  let html = "";

  // Render segments in order
  for (const seg of turn.segments) {
    if (seg.type === "thinking") {
      const thinkingText = seg.chunks.join("");
      if (thinkingText) {
        html += `<details class="gsd-thinking-block">
          <summary class="gsd-thinking-header">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
            Thinking
          </summary>
          <div class="gsd-thinking-content">${escapeHtml(thinkingText)}</div>
        </details>`;
      }
    } else if (seg.type === "text") {
      const text = seg.chunks.join("");
      if (text) {
        html += `<div class="gsd-assistant-text">${renderMarkdown(text)}</div>`;
      }
    } else if (seg.type === "tool") {
      const tc = turn.toolCalls.get(seg.toolCallId);
      if (tc) {
        try {
          html += `<div class="gsd-tool-segment">${buildToolCallHtml(tc)}</div>`;
        } catch (err) {
          console.error("Error rendering tool call:", tc.name, err);
          html += `<div class="gsd-tool-segment"><div class="gsd-tool-block error collapsed" data-tool-id="${escapeAttr(tc.id)}">
            <div class="gsd-tool-header">
              <span class="gsd-tool-icon error">✗</span>
              <span class="gsd-tool-name">${escapeHtml(tc.name)}</span>
              <span class="gsd-tool-arg">render error</span>
            </div>
          </div></div>`;
        }
      }
    }
  }

  // Streaming cursor — show only when nothing visible is happening
  if (!turn.isComplete) {
    const hasAnyContent = turn.segments.length > 0;
    const hasRunningTool = Array.from(turn.toolCalls.values()).some((t) => t.isRunning);
    if (!hasRunningTool && !hasAnyContent) {
      html += `<div class="gsd-thinking-dots"><span></span><span></span><span></span></div>`;
    }
  }

  return html;
}

function buildToolCallHtml(tc: ToolCallState): string {
  const keyArg = getToolKeyArg(tc.name, tc.args);
  const category = getToolCategory(tc.name);
  const toolIcon = getToolIcon(tc.name, category);

  const statusIcon = tc.isRunning ? `<span class="gsd-tool-spinner"></span>` :
    tc.isError ? `<span class="gsd-tool-icon error">✗</span>` :
    `<span class="gsd-tool-icon success">✓</span>`;

  const duration = tc.endTime && tc.startTime ? formatDuration(tc.endTime - tc.startTime) : "";
  const durationHtml = duration ? `<span class="gsd-tool-duration">${duration}</span>` : "";

  const stateClass = tc.isRunning ? "running" : tc.isError ? "error" : "done";
  const isSubagent = tc.name.toLowerCase() === "subagent";

  // Determine if output should be auto-collapsed
  // Subagent results stay expanded — they contain rich rendered content
  const lines = tc.resultText ? tc.resultText.split("\n").length : 0;
  const shouldCollapse = !tc.isRunning && !isSubagent && lines > 5;
  const collapsedClass = shouldCollapse ? "collapsed" : "";

  // Build output HTML with smart formatting
  let outputHtml = "";

  if (isSubagent) {
    // Subagent gets rich rendering
    outputHtml = `<div class="gsd-tool-output gsd-tool-output-rich">${buildSubagentOutputHtml(tc)}</div>`;
  } else if (tc.resultText) {
    // Standard tools: format and display as code
    const formattedResult = formatToolResult(tc.name, tc.resultText, tc.args);
    const maxOutputLen = 8000;
    let displayText = formattedResult;
    let truncated = false;
    if (displayText.length > maxOutputLen) {
      displayText = displayText.slice(0, maxOutputLen);
      truncated = true;
    }
    outputHtml = `<div class="gsd-tool-output"><pre><code>${escapeHtml(displayText)}</code></pre>`;
    if (truncated) {
      outputHtml += `<div class="gsd-tool-output-truncated">… output truncated (${formatTokens(tc.resultText.length)} chars)</div>`;
    }
    outputHtml += `</div>`;
  } else if (tc.isRunning) {
    outputHtml = `<div class="gsd-tool-output"><span class="gsd-tool-output-pending">Running...</span></div>`;
  }

  return `<div class="gsd-tool-block ${stateClass} ${collapsedClass} cat-${category}" data-tool-id="${escapeAttr(tc.id)}">
    <div class="gsd-tool-header">
      ${statusIcon}
      <span class="gsd-tool-cat-icon">${toolIcon}</span>
      <span class="gsd-tool-name">${escapeHtml(tc.name)}</span>
      ${keyArg ? `<span class="gsd-tool-arg">${escapeHtml(keyArg)}</span>` : ""}
      <span class="gsd-tool-header-right">${durationHtml}<span class="gsd-tool-chevron">▸</span></span>
    </div>
    ${outputHtml}
  </div>`;
}

function buildSystemHtml(entry: ChatEntry): string {
  const kind = entry.systemKind || "info";
  return `<div class="gsd-system-msg ${kind}">${escapeHtml(entry.systemText || "")}</div>`;
}

// ============================================================
// Streaming render — incremental, sequential, append-only
// ============================================================

let currentTurnElement: HTMLElement | null = null;
/** Maps segment index → its DOM element inside the turn container */
const segmentElements = new Map<number, HTMLElement>();
/** Index of the segment currently being appended to */
let activeSegmentIndex = -1;
/** rAF handle for throttled text segment updates */
let pendingTextRender: number | null = null;

function ensureCurrentTurnElement(): HTMLElement {
  if (!currentTurnElement) {
    const el = document.createElement("div");
    el.className = "gsd-entry gsd-entry-assistant streaming";
    el.dataset.entryId = state.currentTurn?.id || "stream";
    messagesContainer.appendChild(el);
    currentTurnElement = el;
    welcomeScreen.style.display = "none";
  }
  return currentTurnElement;
}

/**
 * Append a text or thinking delta to the current turn.
 * Creates a new segment if the last segment isn't the same type,
 * otherwise appends to it. Uses rAF to batch DOM updates.
 */
function appendToTextSegment(segType: "text" | "thinking", delta: string): void {
  if (!state.currentTurn) return;

  const turn = state.currentTurn;
  const segments = turn.segments;
  let segIdx: number;

  // Reuse the last segment if it's the same type, otherwise create a new one
  const lastSeg = segments.length > 0 ? segments[segments.length - 1] : null;
  if (lastSeg && lastSeg.type === segType) {
    segIdx = segments.length - 1;
    lastSeg.chunks.push(delta);
  } else {
    segIdx = segments.length;
    segments.push({ type: segType, chunks: [delta] });
  }
  activeSegmentIndex = segIdx;

  // Throttle DOM updates to one per animation frame
  if (pendingTextRender === null) {
    pendingTextRender = requestAnimationFrame(() => {
      pendingTextRender = null;
      renderTextSegment(segIdx);
      scrollToBottom();
    });
  }
}

/** Render (or re-render) a text/thinking segment's DOM element */
function renderTextSegment(segIdx: number): void {
  if (!state.currentTurn) return;
  const seg = state.currentTurn.segments[segIdx];
  if (!seg || seg.type === "tool") return;

  const container = ensureCurrentTurnElement();
  let el = segmentElements.get(segIdx);

  const fullText = seg.chunks.join("");

  if (seg.type === "thinking") {
    if (!el) {
      el = document.createElement("details");
      el.className = "gsd-thinking-block";
      el.innerHTML = `<summary class="gsd-thinking-header">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm-.5-3h1v1h-1v-1zm.5-7a2.5 2.5 0 00-2.5 2.5h1A1.5 1.5 0 018 5a1.5 1.5 0 011.5 1.5c0 .44-.18.84-.46 1.13l-.64.66A2.49 2.49 0 007.5 10h1c0-.52.21-1 .57-1.35l.64-.66A2.49 2.49 0 0010.5 6.5 2.5 2.5 0 008 4z"/></svg>
        Thinking
      </summary>
      <div class="gsd-thinking-content"></div>`;
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }
    const content = el.querySelector(".gsd-thinking-content");
    if (content) content.textContent = fullText;
  } else {
    // text segment
    if (!el) {
      el = document.createElement("div");
      el.className = "gsd-assistant-text";
      insertSegmentElement(container, segIdx, el);
      segmentElements.set(segIdx, el);
    }
    el.innerHTML = renderMarkdown(fullText);
  }
}

/** Insert a segment element at the correct position (maintains order) */
function insertSegmentElement(container: HTMLElement, segIdx: number, el: HTMLElement): void {
  el.dataset.segIdx = String(segIdx);
  // Find the next sibling segment element with a higher index
  let inserted = false;
  for (const [idx, existingEl] of segmentElements) {
    if (idx > segIdx) {
      container.insertBefore(el, existingEl);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    container.appendChild(el);
  }
}

/** Create and append a tool segment's DOM element */
function appendToolSegmentElement(tc: ToolCallState, segIdx: number): void {
  const container = ensureCurrentTurnElement();
  const el = document.createElement("div");
  el.className = "gsd-tool-segment";
  el.dataset.segIdx = String(segIdx);
  el.dataset.toolId = tc.id;
  el.innerHTML = buildToolCallHtml(tc);
  insertSegmentElement(container, segIdx, el);
  segmentElements.set(segIdx, el);
}

/** Update only the specific tool call's DOM element */
function updateToolSegmentElement(toolCallId: string): void {
  if (!state.currentTurn) return;
  const tc = state.currentTurn.toolCalls.get(toolCallId);
  if (!tc) return;

  // Find the segment element for this tool
  for (const [segIdx, el] of segmentElements) {
    if (el.dataset.toolId === toolCallId) {
      el.innerHTML = buildToolCallHtml(tc);
      return;
    }
  }
}

function finalizeCurrentTurn(): void {
  if (!state.currentTurn) return;

  // Cancel any pending render
  if (pendingTextRender !== null) {
    cancelAnimationFrame(pendingTextRender);
    pendingTextRender = null;
  }

  const turn = state.currentTurn;
  turn.isComplete = true;

  // Mark all tool calls as done
  for (const [, tc] of turn.toolCalls) {
    tc.isRunning = false;
  }

  // Add to entries
  state.entries.push({
    id: turn.id,
    type: "assistant",
    turn,
    timestamp: turn.timestamp,
  });

  // Do a final re-render of the complete turn to ensure everything is clean
  if (currentTurnElement) {
    currentTurnElement.classList.remove("streaming");
    currentTurnElement.innerHTML = buildTurnHtml(turn);
  }

  state.currentTurn = null;
  currentTurnElement = null;
  segmentElements.clear();
  activeSegmentIndex = -1;
}

// ============================================================
// UI Updates
// ============================================================

function updateAllUI(): void {
  updateHeaderUI();
  updateFooterUI();
  updateInputUI();
  updateOverlayIndicators();
  updateWelcomeScreen();
}

function updateHeaderUI(): void {
  if (state.model) {
    modelBadge.textContent = state.model.name || state.model.id;
    modelBadge.title = `${state.model.provider} / ${state.model.id}`;
    modelBadge.style.display = "inline-flex";
  } else {
    modelBadge.style.display = "none";
  }

  // Always show thinking badge so user can click to cycle
  const thinkingLabel = state.thinkingLevel && state.thinkingLevel !== "off" ? state.thinkingLevel : "off";
  thinkingBadge.textContent = `🧠 ${thinkingLabel}`;
  thinkingBadge.title = "Click to cycle thinking level";
  thinkingBadge.style.display = "inline-flex";

  const stats = state.sessionStats;
  const hasCost = stats.cost != null && stats.cost > 0;
  if (hasCost) {
    costBadge.textContent = formatCost(stats.cost);
    costBadge.style.display = "inline-flex";
  } else {
    costBadge.style.display = "none";
  }

  const ctx = formatContextUsage(stats, state.model);
  if (ctx) {
    contextBadge.textContent = `◐ ${ctx}`;
    contextBadge.style.display = "inline-flex";
    // Color based on percentage
    const pct = stats.contextPercent ?? 0;
    contextBadge.classList.remove("warn", "crit");
    if (pct > 90) contextBadge.classList.add("crit");
    else if (pct > 70) contextBadge.classList.add("warn");
  } else {
    contextBadge.style.display = "none";
  }
}

function updateFooterUI(): void {
  footerCwd.textContent = state.cwd || "";
  footerCwd.title = state.cwd;

  // Build stats line matching CLI format: ↑input ↓output RcacheRead WcacheWrite $cost percent%/contextWindow (auto)
  const stats = state.sessionStats;
  const tokens = stats.tokens;
  const parts: string[] = [];

  if (tokens) {
    if (tokens.input) parts.push(`↑${formatTokens(tokens.input)}`);
    if (tokens.output) parts.push(`↓${formatTokens(tokens.output)}`);
    if (tokens.cacheRead) parts.push(`R${formatTokens(tokens.cacheRead)}`);
    if (tokens.cacheWrite) parts.push(`W${formatTokens(tokens.cacheWrite)}`);
  }

  parts.push(formatCost(stats.cost));

  const ctx = formatContextUsage(stats, state.model);
  if (ctx) parts.push(ctx);

  footerStats.textContent = parts.join(" ");

  // Right side: model + thinking
  let right = "";
  if (state.model) {
    right = state.model.id || state.model.name || "";
    if (state.thinkingLevel && state.thinkingLevel !== "off") {
      right += ` • ${state.thinkingLevel}`;
    } else {
      right += " • thinking off";
    }
  }
  footerRight.textContent = right;
}

function updateInputUI(): void {
  if (state.isStreaming) {
    sendIcon.textContent = "■";
    sendBtn.classList.add("gsd-stop-btn");
    sendBtn.title = "Stop (Esc)";
    promptInput.placeholder = "Interrupt or steer GSD...";
  } else {
    sendIcon.textContent = "↑";
    sendBtn.classList.remove("gsd-stop-btn");
    sendBtn.title = "Send";
    promptInput.placeholder = "Message GSD...";
  }

  const sendKey = state.useCtrlEnterToSend ? "Ctrl+Enter" : "Enter";
  if (state.isStreaming) {
    inputHint.textContent = `${sendKey} to steer • Esc to stop`;
  } else {
    inputHint.textContent = `${sendKey} to send • !cmd for bash • / for commands`;
  }
}

function updateOverlayIndicators(): void {
  const parts: string[] = [];

  if (state.isCompacting) {
    parts.push(`<div class="gsd-overlay-indicator compacting">
      <span class="gsd-overlay-spinner"></span>Compacting context…
    </div>`);
  }

  if (state.isRetrying && state.retryInfo) {
    parts.push(`<div class="gsd-overlay-indicator retrying">
      <span class="gsd-overlay-spinner"></span>Retrying (${state.retryInfo.attempt}/${state.retryInfo.maxAttempts})…
      <span class="gsd-overlay-detail">${escapeHtml(state.retryInfo.errorMessage)}</span>
    </div>`);
  }

  if (state.processStatus === "starting") {
    parts.push(`<div class="gsd-overlay-indicator starting">
      <span class="gsd-overlay-spinner"></span>Starting GSD…
    </div>`);
  }

  if (state.processStatus === "restarting") {
    parts.push(`<div class="gsd-overlay-indicator restarting">
      <span class="gsd-overlay-spinner"></span>Restarting GSD…
    </div>`);
  }

  if (state.processStatus === "crashed") {
    parts.push(`<div class="gsd-overlay-indicator crashed">
      ⚠ GSD process crashed
      <button id="restartBtn" class="gsd-overlay-btn">Restart</button>
    </div>`);
  }

  overlayIndicators.innerHTML = parts.join("");
  overlayIndicators.style.display = parts.length > 0 ? "flex" : "none";
}

function updateWelcomeScreen(): void {
  if (state.entries.length > 0 || state.currentTurn) {
    welcomeScreen.style.display = "none";
    return;
  }
  welcomeScreen.style.display = "flex";

  // Version
  welcomeVersion.textContent = state.version ? `v${state.version}` : "";

  // Status
  switch (state.processStatus) {
    case "starting":
      welcomeProcess.textContent = "Starting GSD…";
      break;
    case "running":
      welcomeProcess.textContent = "Type a message to start";
      break;
    case "crashed":
      welcomeProcess.textContent = "GSD process crashed — click Restart or send a message";
      break;
    case "restarting":
      welcomeProcess.textContent = "Restarting…";
      break;
    default:
      welcomeProcess.textContent = "Initializing…";
  }

  // Model
  if (state.model && state.processStatus === "running") {
    let modelStr = state.model.id || state.model.name || "";
    if (state.model.provider) modelStr = `${state.model.provider}/${modelStr}`;
    if (state.thinkingLevel && state.thinkingLevel !== "off") {
      modelStr += ` • 🧠 ${state.thinkingLevel}`;
    }
    welcomeModel.textContent = modelStr;
    welcomeModel.style.display = "block";
  } else {
    welcomeModel.style.display = "none";
  }

  // Hints
  if (state.processStatus === "running") {
    const sendKey = state.useCtrlEnterToSend ? "Ctrl+Enter" : "Enter";
    welcomeHints.innerHTML = [
      `<span>${sendKey} to send</span>`,
      `<span>Shift+Enter for newline</span>`,
      `<span>Esc to interrupt</span>`,
      `<span>/ for commands</span>`,
    ].join('<span class="gsd-hint-sep">•</span>');
    welcomeHints.style.display = "flex";
  } else {
    welcomeHints.style.display = "none";
  }
}

// ============================================================
// Inline UI requests
// ============================================================

function handleInlineUiRequest(data: any): void {
  const id = data.id;
  const method = data.method;

  // Create an inline element in the messages container (not overlay)
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
          ${options.map((opt, i) =>
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
        // Show compact resolved state with question context
        const shortTitle = title.split(":")[0]?.trim() || title;
        disableUiRequest(wrapper, `${shortTitle}: ${value}`);
      });
    });
    wrapper.querySelector(".gsd-ui-cancel-btn")!.addEventListener("click", () => {
      vscode.postMessage({ type: "extension_ui_response", id, cancelled: true });
      disableUiRequest(wrapper, "Cancelled");
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
      disableUiRequest(wrapper, "Confirmed: Yes");
    });
    wrapper.querySelector('[data-action="no"]')!.addEventListener("click", () => {
      vscode.postMessage({ type: "extension_ui_response", id, confirmed: false });
      disableUiRequest(wrapper, "Confirmed: No");
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
      disableUiRequest(wrapper, `Submitted: ${input.value}`);
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") {
        vscode.postMessage({ type: "extension_ui_response", id, cancelled: true });
        disableUiRequest(wrapper, "Cancelled");
      }
    });
    wrapper.querySelector('[data-action="submit"]')!.addEventListener("click", submit);
    wrapper.querySelector('[data-action="cancel"]')!.addEventListener("click", () => {
      vscode.postMessage({ type: "extension_ui_response", id, cancelled: true });
      disableUiRequest(wrapper, "Cancelled");
    });
  }

  messagesContainer.appendChild(wrapper);
  scrollToBottom();
}

function disableUiRequest(wrapper: HTMLElement, summary: string): void {
  wrapper.classList.add("resolved");
  const req = wrapper.querySelector(".gsd-ui-request");
  if (req) {
    // Parse the summary for a cleaner display
    const icon = summary.startsWith("Cancelled") ? "⊘" :
                 summary.startsWith("Confirmed: No") ? "✗" : "✓";
    const cssClass = summary.startsWith("Cancelled") ? "cancelled" :
                     summary.startsWith("Confirmed: No") ? "rejected" : "accepted";
    req.innerHTML = `<div class="gsd-ui-resolved ${cssClass}"><span class="gsd-ui-resolved-icon">${icon}</span> ${escapeHtml(summary)}</div>`;
  }
}

// ============================================================
// Handle messages FROM extension
// ============================================================

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionToWebviewMessage | Record<string, unknown>;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "config": {
      const data = msg as any;
      state.useCtrlEnterToSend = data.useCtrlEnterToSend ?? false;
      if (data.cwd) state.cwd = data.cwd;
      if (data.version) state.version = data.version;
      updateAllUI();
      break;
    }

    case "state": {
      const data = (msg as any).data as GsdState;
      if (data) {
        state.model = data.model || null;
        state.thinkingLevel = data.thinkingLevel || "off";
        state.isStreaming = data.isStreaming || false;
        state.isCompacting = data.isCompacting || false;
        if (data.cwd) state.cwd = data.cwd;
        if (data.autoCompactionEnabled != null) {
          state.sessionStats.autoCompactionEnabled = data.autoCompactionEnabled;
        }
        // Carry context window from model into stats
        if (data.model?.contextWindow) {
          state.sessionStats.contextWindow = data.model.contextWindow;
        }
        if (state.processStatus !== "crashed") state.processStatus = "running";
        updateAllUI();
      }
      break;
    }

    case "session_stats": {
      const data = (msg as any).data;
      if (data) {
        // Merge into session stats, preserving context fields that may come from get_state
        state.sessionStats = {
          ...state.sessionStats,
          ...data,
        };
        updateHeaderUI();
        updateFooterUI();
      }
      break;
    }

    case "process_status": {
      const data = msg as any;
      state.processStatus = data.status as ProcessStatus;
      updateOverlayIndicators();
      updateWelcomeScreen();
      break;
    }

    case "agent_start": {
      state.isStreaming = true;
      state.currentTurn = {
        id: nextId(),
        segments: [],
        toolCalls: new Map(),
        isComplete: false,
        timestamp: Date.now(),
      };
      currentTurnElement = null;
      segmentElements.clear();
      activeSegmentIndex = -1;
      updateInputUI();
      ensureCurrentTurnElement();
      break;
    }

    case "agent_end": {
      state.isStreaming = false;
      finalizeCurrentTurn();
      updateInputUI();
      updateOverlayIndicators();
      // Fetch latest stats
      vscode.postMessage({ type: "get_session_stats" });
      break;
    }

    case "turn_start": {
      // If no current turn, create one (can happen on retry)
      if (!state.currentTurn) {
        state.currentTurn = {
          id: nextId(),
          segments: [],
          toolCalls: new Map(),
          isComplete: false,
          timestamp: Date.now(),
        };
        currentTurnElement = null;
        segmentElements.clear();
        activeSegmentIndex = -1;
      }
      break;
    }

    case "turn_end": {
      // Don't finalize here — wait for agent_end to group everything
      break;
    }

    case "message_start": {
      break;
    }

    case "message_update": {
      if (!state.currentTurn) break;
      const data = msg as any;
      const delta = data.assistantMessageEvent || data.delta;

      if (delta) {
        if (delta.type === "text_delta" && delta.delta) {
          appendToTextSegment("text", delta.delta);
        } else if (delta.type === "thinking_delta" && delta.delta) {
          appendToTextSegment("thinking", delta.delta);
        }
      }
      break;
    }

    case "message_end": {
      // Extract usage data from assistant messages for live stats
      const endData = msg as any;
      const endMsg = endData.message;
      if (endMsg?.role === "assistant" && endMsg.usage) {
        const u = endMsg.usage;
        // Accumulate tokens
        if (!state.sessionStats.tokens) {
          state.sessionStats.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
        }
        const t = state.sessionStats.tokens;
        t.input += u.input || 0;
        t.output += u.output || 0;
        t.cacheRead += u.cacheRead || 0;
        t.cacheWrite += u.cacheWrite || 0;
        t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
        // Accumulate cost
        if (u.cost?.total) {
          state.sessionStats.cost = (state.sessionStats.cost || 0) + u.cost.total;
        }
        // Estimate context usage from the latest response
        // Context ≈ input + cacheRead (tokens that were in the context window)
        const contextTokens = (u.input || 0) + (u.cacheRead || 0);
        const contextWindow = state.model?.contextWindow || state.sessionStats.contextWindow || 0;
        if (contextWindow > 0 && contextTokens > 0) {
          state.sessionStats.contextTokens = contextTokens;
          state.sessionStats.contextWindow = contextWindow;
          state.sessionStats.contextPercent = (contextTokens / contextWindow) * 100;
        }
        updateHeaderUI();
        updateFooterUI();
      }
      break;
    }

    case "tool_execution_start": {
      if (!state.currentTurn) break;
      const data = msg as any;
      const tc: ToolCallState = {
        id: data.toolCallId,
        name: data.toolName,
        args: data.args || {},
        resultText: "",
        isError: false,
        isRunning: true,
        startTime: Date.now(),
      };
      state.currentTurn.toolCalls.set(data.toolCallId, tc);
      // Add a tool segment in sequence
      const segIdx = state.currentTurn.segments.length;
      state.currentTurn.segments.push({ type: "tool", toolCallId: data.toolCallId });
      activeSegmentIndex = segIdx;
      // Create DOM element for this tool segment
      appendToolSegmentElement(tc, segIdx);
      scrollToBottom();
      break;
    }

    case "tool_execution_update": {
      if (!state.currentTurn) break;
      const data = msg as any;
      const tc = state.currentTurn.toolCalls.get(data.toolCallId);
      if (tc && data.partialResult) {
        const text = data.partialResult.content
          ?.map((c: any) => c.text || "")
          .filter(Boolean)
          .join("\n");
        if (text) tc.resultText = text;
        updateToolSegmentElement(data.toolCallId);
        scrollToBottom();
      }
      break;
    }

    case "tool_execution_end": {
      if (!state.currentTurn) break;
      const data = msg as any;
      const tc = state.currentTurn.toolCalls.get(data.toolCallId);
      if (tc) {
        tc.isRunning = false;
        tc.isError = data.isError;
        tc.endTime = Date.now();
        if (data.durationMs) {
          tc.endTime = tc.startTime + data.durationMs;
        }
        if (data.result) {
          const text = data.result.content
            ?.map((c: any) => c.text || "")
            .filter(Boolean)
            .join("\n");
          if (text) tc.resultText = text;
        }
      }
      updateToolSegmentElement(data.toolCallId);
      scrollToBottom();
      break;
    }

    case "auto_compaction_start": {
      state.isCompacting = true;
      updateOverlayIndicators();
      break;
    }

    case "auto_compaction_end": {
      state.isCompacting = false;
      updateOverlayIndicators();
      break;
    }

    case "auto_retry_start": {
      const data = msg as any;
      state.isRetrying = true;
      state.retryInfo = {
        attempt: data.attempt,
        maxAttempts: data.maxAttempts,
        errorMessage: data.errorMessage || "",
      };
      updateOverlayIndicators();
      break;
    }

    case "auto_retry_end": {
      const data = msg as any;
      state.isRetrying = false;
      state.retryInfo = undefined;
      updateOverlayIndicators();
      if (!data.success && data.finalError) {
        addSystemEntry(data.finalError, "error");
      }
      break;
    }

    case "extension_ui_request": {
      const data = msg as any;
      if (data.method === "setStatus" && data.statusText) {
        // Status text — could update footer
      } else if (data.method === "set_editor_text" && data.text) {
        promptInput.value = data.text;
        autoResize();
      } else if (data.method === "select" || data.method === "confirm" || data.method === "input") {
        handleInlineUiRequest(data);
      }
      break;
    }

    case "commands": {
      const data = msg as any;
      state.commands = data.commands || [];
      state.commandsLoaded = true;
      if (slashMenuVisible) {
        const filter = promptInput.value.slice(1).trim();
        showSlashMenu(filter);
      }
      break;
    }

    case "available_models": {
      const data = msg as any;
      state.availableModels = (data.models || []).map((m: any) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider,
        reasoning: m.reasoning || false,
        contextWindow: m.contextWindow,
      }));
      state.modelsLoaded = true;
      if (modelPickerVisible) {
        renderModelPicker();
      }
      break;
    }

    case "thinking_level_changed": {
      const data = msg as any;
      state.thinkingLevel = data.level || "off";
      updateHeaderUI();
      updateFooterUI();
      addSystemEntry(`Thinking level: ${state.thinkingLevel}`, "info");
      break;
    }

    case "bash_result": {
      const data = msg as any;
      const result = data.result;
      if (result) {
        const output = result.stdout || result.stderr || result.output || JSON.stringify(result);
        const isError = result.exitCode !== 0 || result.error;
        addSystemEntry(typeof output === "string" ? output : JSON.stringify(output, null, 2), isError ? "error" : "info");
      }
      break;
    }

    case "error": {
      const data = msg as any;
      addSystemEntry(data.message, "error");
      break;
    }

    case "process_exit": {
      const data = msg as any;
      state.isStreaming = false;
      state.isCompacting = false;
      state.isRetrying = false;
      state.currentTurn = null;
      currentTurnElement = null;
      segmentElements.clear();
      activeSegmentIndex = -1;
      updateInputUI();
      updateOverlayIndicators();

      const message = data.code === 0
        ? "GSD process exited. Send a message to restart."
        : `GSD process exited (code: ${data.code}). Send a message to restart.`;
      addSystemEntry(message, data.code === 0 ? "info" : "warning");
      break;
    }
  }
});

function addSystemEntry(text: string, kind: "info" | "error" | "warning" = "info"): void {
  const entry: ChatEntry = {
    id: nextId(),
    type: "system",
    systemText: text,
    systemKind: kind,
    timestamp: Date.now(),
  };
  state.entries.push(entry);
  renderNewEntry(entry);
  scrollToBottom();
}

// ============================================================
// Initialize
// ============================================================

vscode.postMessage({ type: "ready" });
vscode.postMessage({ type: "launch_gsd" });
promptInput.focus();
updateAllUI();
