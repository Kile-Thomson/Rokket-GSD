/**
 * Async Subagent Extension
 *
 * Non-blocking subagent execution. Spawns subagent processes and returns
 * a job ID immediately so the parent agent can keep working.
 *
 * Tools:
 *   async_subagent — spawn a subagent (single/parallel/chain), get a job ID back immediately
 *   await_subagent — wait for subagent job(s) to complete, get results
 *
 * Commands:
 *   /subagent-jobs — show running and recent subagent jobs
 */
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { getMarkdownTheme } from "@gsd/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@gsd/pi-tui";
import { discoverAgents } from "../subagent/agents.js";

// ── Constants ──────────────────────────────────────────────────────────────

const COLLAPSED_ITEM_COUNT = 10;
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;

// ── Display helpers (mirrored from subagent extension) ─────────────────────

function formatUsageStats(usage, model) {
  const parts = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost) parts.push(`$${(Number(usage.cost) || 0).toFixed(4)}`);
  if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatToolCall(toolName, args, themeFg) {
  const shortenPath = (p) => {
    const home = os.homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  };

  switch (toolName) {
    case "bash": {
      const command = (args.command) || "...";
      const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
    }
    case "read": {
      const rawPath = (args.file_path || args.path || "...");
      const filePath = shortenPath(rawPath);
      const offset = args.offset;
      const limit = args.limit;
      let text = themeFg("accent", filePath);
      if (offset !== undefined || limit !== undefined) {
        const startLine = offset ?? 1;
        const endLine = limit !== undefined ? startLine + limit - 1 : "";
        text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
      }
      return themeFg("muted", "read ") + text;
    }
    case "write": {
      const rawPath = (args.file_path || args.path || "...");
      const filePath = shortenPath(rawPath);
      const content = (args.content || "");
      const lines = content.split("\n").length;
      let text = themeFg("muted", "write ") + themeFg("accent", filePath);
      if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit": {
      const rawPath = (args.file_path || args.path || "...");
      return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
    }
    default: {
      const argsStr = JSON.stringify(args);
      const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
    }
  }
}

function getFinalOutput(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}

function getDisplayItems(messages) {
  const items = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
      }
    }
  }
  return items;
}

function renderDisplayItemsText(items, theme, expanded, limit) {
  const toShow = limit ? items.slice(-limit) : items;
  const skipped = limit && items.length > limit ? items.length - limit : 0;
  let text = "";
  if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
  for (const item of toShow) {
    if (item.type === "text") {
      const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
      text += `${theme.fg("toolOutput", preview)}\n`;
    } else {
      text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
    }
  }
  return text.trimEnd();
}

/**
 * Render a single completed/failed subagent result in the same style
 * as the blocking subagent tool's renderResult (single mode).
 */
function renderSingleResult(r, expanded, theme) {
  const mdTheme = getMarkdownTheme();
  const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
  const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
  const displayItems = getDisplayItems(r.messages || []);
  const finalOutput = getFinalOutput(r.messages || []);

  if (expanded) {
    const container = new Container();
    let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource || "unknown"})`)}`;
    if (r.id) header += theme.fg("dim", ` ${r.id}`);
    if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
    container.addChild(new Text(header, 0, 0));
    if (isError && r.errorMessage)
      container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
    container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
    if (displayItems.length === 0 && !finalOutput) {
      container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
    } else {
      for (const item of displayItems) {
        if (item.type === "toolCall")
          container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
      }
      if (finalOutput) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
      }
    }
    const usageStr = formatUsageStats(r.usage || {}, r.model);
    if (usageStr) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
    }
    return container;
  }

  // Collapsed view
  let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource || "unknown"})`)}`;
  if (r.id) text += theme.fg("dim", ` ${r.id}`);
  if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
  if (isError && r.errorMessage) {
    text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
  } else if (displayItems.length === 0) {
    text += `\n${theme.fg("muted", "(no output)")}`;
  } else {
    text += `\n${renderDisplayItemsText(displayItems, theme, false, COLLAPSED_ITEM_COUNT)}`;
    if (displayItems.length > COLLAPSED_ITEM_COUNT)
      text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
  }
  const usageStr = formatUsageStats(r.usage || {}, r.model);
  if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
  return new Text(text, 0, 0);
}

function aggregateUsage(results) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
  for (const r of results) {
    if (!r.usage) continue;
    total.input += r.usage.input || 0;
    total.output += r.usage.output || 0;
    total.cacheRead += r.usage.cacheRead || 0;
    total.cacheWrite += r.usage.cacheWrite || 0;
    total.cost += r.usage.cost || 0;
    total.turns += r.usage.turns || 0;
  }
  return total;
}

// ── Job Manager ────────────────────────────────────────────────────────────

const jobs = new Map();
const MAX_JOBS = 15;
const EVICTION_MS = 10 * 60 * 1000;
let piInstance = null;

function generateJobId() {
  return `sa_${crypto.randomUUID().slice(0, 8)}`;
}

function evictOldestCompleted() {
  let oldest = null;
  for (const job of jobs.values()) {
    if (job.status !== "running") {
      if (!oldest || job.startTime < oldest.startTime) oldest = job;
    }
  }
  if (oldest) {
    if (oldest.evictionTimer) clearTimeout(oldest.evictionTimer);
    jobs.delete(oldest.id);
  }
}

function scheduleEviction(id) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.evictionTimer) clearTimeout(job.evictionTimer);
  job.evictionTimer = setTimeout(() => jobs.delete(id), EVICTION_MS);
}

function deliverProgress(job) {
  if (!piInstance) return;
  if (job.status !== "running") return;

  const results = job.subResults.map(sr => ({
    agent: sr.agent,
    agentSource: sr.agentSource,
    task: sr.task,
    step: sr.step,
    exitCode: sr.status === "completed" ? 0 : sr.status === "running" ? -1 : 1,
    status: sr.status,
    stopReason: sr.stopReason,
    errorMessage: sr.errorMessage,
    usage: sr.usage,
    model: sr.model,
  }));

  // Emit structured JSON to stderr for the IDE extension to intercept
  const progressEvent = JSON.stringify({
    __async_subagent_progress: true,
    toolCallId: job._toolCallId,
    mode: job.mode,
    results,
  });
  process.stderr.write(`${progressEvent}\n`);
}

function deliverResult(job) {
  if (!piInstance) return;
  if (job.awaited) return;
  const elapsed = ((Date.now() - job.startTime) / 1000).toFixed(1);
  const icon = job.status === "completed" ? "done" : "error";

  let output;
  if (job.mode === "single") {
    output = job.status === "completed"
      ? (job.finalOutput || "(no output)")
      : `Error: ${job.errorMessage || job.stderr || "unknown"}`;
  } else {
    const subResults = job.subResults || [];
    const successCount = subResults.filter(r => r.status === "completed").length;
    output = `${job.mode}: ${successCount}/${subResults.length} succeeded`;
  }

  const maxLen = 2000;
  const truncated = output.length > maxLen
    ? output.slice(0, maxLen) + "\n\n[... truncated, use await_subagent for full output]"
    : output;

  // Update the spawn cards to final state
  const finalResults = (job.subResults || []).map(sr => ({
    agent: sr.agent,
    agentSource: sr.agentSource,
    task: sr.task,
    step: sr.step,
    exitCode: sr.status === "completed" ? 0 : sr.status === "running" ? -1 : 1,
    status: sr.status,
    stopReason: sr.stopReason,
    errorMessage: sr.errorMessage,
    usage: sr.usage,
    model: sr.model,
  }));

  piInstance.sendMessage({
    customType: "async_subagent_result",
    content: [
      `**Subagent job ${icon}: ${job.id}** (${job.label}, ${elapsed}s)`,
      "",
      truncated,
    ].join("\n"),
    display: true,
    details: {
      jobId: job.id,
      toolCallId: job._toolCallId,
      mode: job.mode,
      results: finalResults,
    },
  }, { triggerTurn: true });

  // Also emit structured completion to stderr for IDE card update
  const completionEvent = JSON.stringify({
    __async_subagent_progress: true,
    toolCallId: job._toolCallId,
    mode: job.mode,
    results: finalResults,
  });
  process.stderr.write(`${completionEvent}\n`);
}

// ── Process spawning ───────────────────────────────────────────────────────

function writePromptToTempFile(agentName, prompt) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-async-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

function buildArgs(agent, task, tmpPromptPath) {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
  if (tmpPromptPath) args.push("--append-system-prompt", tmpPromptPath);
  args.push(`Task: ${task}`);
  return args;
}

function processEventLine(line, subResult, onProgress) {
  if (!line.trim()) return;
  let event;
  try { event = JSON.parse(line); } catch { return; }

  if (event.type === "message_end" && event.message) {
    const msg = event.message;
    subResult.messages.push(msg);

    if (msg.role === "assistant") {
      subResult.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        subResult.usage.input += usage.input || 0;
        subResult.usage.output += usage.output || 0;
        subResult.usage.cacheRead += usage.cacheRead || 0;
        subResult.usage.cacheWrite += usage.cacheWrite || 0;
        subResult.usage.cost += usage.cost?.total || 0;
        subResult.usage.contextTokens = usage.totalTokens || 0;
      }
      if (!subResult.model && msg.model) subResult.model = msg.model;
      if (msg.stopReason) subResult.stopReason = msg.stopReason;
      if (msg.errorMessage) subResult.errorMessage = msg.errorMessage;

      for (const part of msg.content) {
        if (part.type === "text") subResult.finalOutput = part.text;
      }
      if (onProgress) onProgress();
    }
  }

  if (event.type === "tool_result_end" && event.message) {
    subResult.messages.push(event.message);
  }
}

function makeSubResult(agent, task, step) {
  return {
    agent: agent.name,
    agentSource: agent.source,
    task,
    step,
    status: "running",
    exitCode: null,
    finalOutput: "",
    stderr: "",
    errorMessage: null,
    stopReason: null,
    model: agent.model || null,
    messages: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
  };
}

/**
 * Run a single subagent process. Returns a promise that resolves when done.
 */
function runSingleSubagent(subResult, agent, task, cwd, onProgress) {
  return new Promise((resolve) => {
    let tmpPromptDir = null;
    let tmpPromptPath = null;

    if (agent.systemPrompt?.trim()) {
      const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
    }

    const args = buildArgs(agent, task, tmpPromptPath);
    const bundledPaths = (process.env.GSD_BUNDLED_EXTENSION_PATHS ?? "")
      .split(path.delimiter).map(s => s.trim()).filter(Boolean);
    const extensionArgs = bundledPaths.flatMap(p => ["--extension", p]);

    const proc = spawn(
      process.execPath,
      [process.env.GSD_BIN_PATH, ...extensionArgs, ...args],
      { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] }
    );

    subResult._proc = proc;
    let buffer = "";

    proc.stdout.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processEventLine(line, subResult, onProgress);
    });

    proc.stderr.on("data", (data) => {
      subResult.stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (buffer.trim()) processEventLine(buffer, subResult, onProgress);

      if (tmpPromptPath) try { fs.unlinkSync(tmpPromptPath); } catch {}
      if (tmpPromptDir) try { fs.rmdirSync(tmpPromptDir); } catch {}

      const isError = code !== 0 || subResult.stopReason === "error" || subResult.stopReason === "aborted";
      subResult.exitCode = code ?? 1;
      subResult.status = isError ? "failed" : "completed";
      subResult._proc = null;
      resolve(subResult);
    });

    proc.on("error", (err) => {
      subResult.status = "failed";
      subResult.errorMessage = err.message;
      subResult._proc = null;
      resolve(subResult);
    });
  });
}

/**
 * Run tasks with a concurrency limit.
 */
async function mapWithConcurrencyLimit(items, concurrency, fn) {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Build a details snapshot from a job's current sub-results for onUpdate.
 */
function buildJobDetailsSnapshot(job) {
  return {
    mode: job.mode,
    results: job.subResults.map(sr => ({
      agent: sr.agent,
      agentSource: sr.agentSource,
      task: sr.task,
      step: sr.step,
      exitCode: sr.status === "completed" ? 0 : sr.status === "running" ? -1 : 1,
      status: sr.status,
      stopReason: sr.stopReason,
      errorMessage: sr.errorMessage,
      usage: sr.usage,
      model: sr.model,
    })),
  };
}

/**
 * Spawn a job — handles single, parallel, and chain modes.
 */
function spawnJob(job, agents, cwd) {
  // Progress callback — pushes live updates via sendMessage (survives after execute returns)
  const emitProgress = () => {
    deliverProgress(job);
  };

  if (job.mode === "single") {
    const agent = agents.find(a => a.name === job.agentName);
    const subResult = makeSubResult(agent, job.task, undefined);
    job.subResults = [subResult];

    runSingleSubagent(subResult, agent, job.task, job.cwd || cwd, emitProgress).then(() => {
      job.finalOutput = subResult.finalOutput;
      job.errorMessage = subResult.errorMessage;
      job.stderr = subResult.stderr;
      job.exitCode = subResult.exitCode;
      job.model = subResult.model;
      job.usage = subResult.usage;
      job.status = subResult.status;
      job.messages = subResult.messages;
      job.endTime = Date.now();
      scheduleEviction(job.id);
      deliverResult(job);
      if (job._resolve) { job._resolve(); job._resolve = null; }
    });

  } else if (job.mode === "parallel") {
    const taskItems = job.taskItems;
    job.subResults = taskItems.map((t) => {
      const agent = agents.find(a => a.name === t.agent);
      return makeSubResult(agent || { name: t.agent, source: "unknown" }, t.task, undefined);
    });

    mapWithConcurrencyLimit(taskItems, MAX_CONCURRENCY, async (t, index) => {
      const agent = agents.find(a => a.name === t.agent);
      if (!agent) {
        job.subResults[index].status = "failed";
        job.subResults[index].errorMessage = `Unknown agent: "${t.agent}"`;
        return;
      }
      await runSingleSubagent(job.subResults[index], agent, t.task, t.cwd || cwd, emitProgress);
    }).then(() => {
      const successCount = job.subResults.filter(r => r.status === "completed").length;
      job.exitCode = successCount === job.subResults.length ? 0 : 1;
      job.status = job.exitCode === 0 ? "completed" : "failed";
      job.endTime = Date.now();
      job.usage = aggregateUsage(job.subResults);
      scheduleEviction(job.id);
      deliverResult(job);
      if (job._resolve) { job._resolve(); job._resolve = null; }
    });

  } else if (job.mode === "chain") {
    const chainItems = job.chainItems;
    job.subResults = [];

    (async () => {
      let previousOutput = "";
      for (let i = 0; i < chainItems.length; i++) {
        const step = chainItems[i];
        const agent = agents.find(a => a.name === step.agent);
        if (!agent) {
          const failResult = makeSubResult({ name: step.agent, source: "unknown" }, step.task, i + 1);
          failResult.status = "failed";
          failResult.errorMessage = `Unknown agent: "${step.agent}"`;
          job.subResults.push(failResult);
          break;
        }
        const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
        const subResult = makeSubResult(agent, taskWithContext, i + 1);
        job.subResults.push(subResult);
        await runSingleSubagent(subResult, agent, taskWithContext, step.cwd || cwd, emitProgress);

        const isError = subResult.status === "failed";
        if (isError) break;
        previousOutput = getFinalOutput(subResult.messages);
      }

      const lastResult = job.subResults[job.subResults.length - 1];
      job.exitCode = lastResult?.status === "completed" ? 0 : 1;
      job.status = job.exitCode === 0 ? "completed" : "failed";
      job.finalOutput = lastResult ? getFinalOutput(lastResult.messages) : "";
      job.endTime = Date.now();
      job.usage = aggregateUsage(job.subResults);
      scheduleEviction(job.id);
      deliverResult(job);
      if (job._resolve) { job._resolve(); job._resolve = null; }
    })();
  }
}

// ── Tool schemas ───────────────────────────────────────────────────────────

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const asyncSubagentSchema = Type.Object({
  agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
  task: Type.Optional(Type.String({ description: "Task to delegate to the agent (for single mode)" })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
  chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
  agentScope: Type.Optional(Type.String({
    description: 'Which agent directories to use: "user", "project", or "both" (default).',
    default: "both",
  })),
});

const awaitSubagentSchema = Type.Object({
  jobs: Type.Optional(Type.Array(Type.String(), {
    description: "Subagent job IDs to wait for. Omit to wait for any running subagent job.",
  })),
});

// ── Extension entry point ──────────────────────────────────────────────────

export default function AsyncSubagent(pi) {
  piInstance = pi;

  pi.on("session_start", async () => {
    for (const [id, job] of jobs) {
      if (job.status === "running") killJobProcesses(job);
      if (job.evictionTimer) clearTimeout(job.evictionTimer);
    }
    jobs.clear();
  });

  // Inject system prompt preference to use async_subagent over blocking subagent
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: event.systemPrompt +
        "\n\nAlways use async_subagent instead of subagent. The async_subagent tool is non-blocking — " +
        "it spawns agents in the background and returns immediately, letting the conversation continue. " +
        "Use await_subagent to collect results when needed. Never use the blocking subagent tool.",
    };
  });

  pi.on("session_shutdown", async () => {
    for (const job of jobs.values()) {
      if (job.status === "running") killJobProcesses(job);
      if (job.evictionTimer) clearTimeout(job.evictionTimer);
    }
    jobs.clear();
    piInstance = null;
  });

  // ── async_subagent tool ────────────────────────────────────────────────

  pi.registerTool({
    name: "async_subagent",
    label: "Async Subagent",
    description: [
      "Spawn a subagent in the background and get a job ID immediately.",
      "The subagent runs in its own process with an isolated context window.",
      "Use await_subagent to collect results when ready.",
      "Use this instead of the blocking subagent tool.",
      "IMPORTANT: To run multiple agents in parallel, pass tasks: [{agent, task}, {agent, task}, ...] in a SINGLE call — never call async_subagent multiple times for parallel work.",
    ].join(" "),
    promptGuidelines: [
      "Use async_subagent instead of subagent — it doesn't block the conversation.",
      "After spawning, continue working or chatting. Do NOT immediately call await_subagent — that defeats the purpose of async.",
      "Results are delivered automatically when jobs complete — you'll receive them as a follow-up message. Present them to the user when they arrive.",
      "Only call await_subagent if you specifically need to block and wait for results before continuing (e.g. chained tasks that depend on prior output).",
      "PARALLEL WORK: always use a single async_subagent call with tasks: [{agent, task}, {agent, task}, ...]. NEVER make multiple separate async_subagent calls for parallel work — each call is a separate isolated job with no shared state.",
    ],
    parameters: asyncSubagentSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope = params.agentScope ?? "both";
      const discovery = discoverAgents(ctx.cwd, scope);
      const agents = discovery.agents;

      const hasChain = (params.chain?.length ?? 0) > 0;
      const hasTasks = (params.tasks?.length ?? 0) > 0;
      const hasSingle = Boolean(params.agent && params.task);
      const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

      if (modeCount !== 1) {
        const available = agents.map(a => `"${a.name}"`).join(", ") || "none";
        return {
          content: [{ type: "text", text: `Invalid parameters. Provide exactly one mode: single (agent+task), parallel (tasks), or chain.\nAvailable agents: ${available}` }],
          isError: true,
        };
      }

      const runningCount = [...jobs.values()].filter(j => j.status === "running").length;
      if (runningCount >= MAX_JOBS) {
        return {
          content: [{ type: "text", text: `Max concurrent subagent jobs reached (${MAX_JOBS}). Use await_subagent or wait for some to finish.` }],
          isError: true,
        };
      }
      if (jobs.size >= MAX_JOBS * 2) evictOldestCompleted();

      // Validate agents exist
      const requestedAgents = new Set();
      if (hasSingle) requestedAgents.add(params.agent);
      if (hasTasks) for (const t of params.tasks) requestedAgents.add(t.agent);
      if (hasChain) for (const s of params.chain) requestedAgents.add(s.agent);

      const unknownAgents = [...requestedAgents].filter(name => !agents.find(a => a.name === name));
      if (unknownAgents.length > 0) {
        const available = agents.map(a => `"${a.name}"`).join(", ") || "none";
        return {
          content: [{ type: "text", text: `Unknown agent(s): ${unknownAgents.map(a => `"${a}"`).join(", ")}. Available: ${available}` }],
          isError: true,
        };
      }

      if (hasTasks && params.tasks.length > MAX_PARALLEL_TASKS) {
        return {
          content: [{ type: "text", text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.` }],
          isError: true,
        };
      }

      const id = generateJobId();
      let mode, label;

      if (hasSingle) {
        mode = "single";
        label = params.agent;
      } else if (hasTasks) {
        mode = "parallel";
        label = `parallel (${params.tasks.length} tasks)`;
      } else {
        mode = "chain";
        label = `chain (${params.chain.length} steps)`;
      }

      const job = {
        id,
        mode,
        label,
        // Single mode fields
        agentName: hasSingle ? params.agent : null,
        agentSource: hasSingle ? agents.find(a => a.name === params.agent)?.source : null,
        task: hasSingle ? params.task : null,
        cwd: params.cwd,
        // Parallel mode
        taskItems: hasTasks ? params.tasks : null,
        // Chain mode
        chainItems: hasChain ? params.chain : null,
        // Shared state
        subResults: [],
        status: "running",
        startTime: Date.now(),
        endTime: null,
        exitCode: null,
        finalOutput: "",
        stderr: "",
        errorMessage: null,
        stopReason: null,
        model: null,
        messages: [],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
        evictionTimer: null,
        awaited: false,
        _onUpdate: null,
        _toolCallId: _toolCallId,
        _resolve: null,
        _promise: null,
      };

      job._promise = new Promise(resolve => { job._resolve = resolve; });
      // Store onUpdate so background processes can push live updates
      if (_onUpdate) job._onUpdate = _onUpdate;
      jobs.set(id, job);
      spawnJob(job, agents, ctx.cwd);

      // Brief content text — the cards in details carry the visual info
      const responseText = `Spawned **${id}**. Use \`await_subagent\` to collect results.`;

      // Build running-state results for the IDE card rendering
      let spawnResults = [];
      if (hasSingle) {
        spawnResults = [{
          agent: params.agent,
          agentSource: job.agentSource,
          task: params.task,
          exitCode: -1,
          status: "running",
        }];
      } else if (hasTasks) {
        spawnResults = params.tasks.map(t => ({
          agent: t.agent,
          agentSource: agents.find(a => a.name === t.agent)?.source || "unknown",
          task: t.task,
          exitCode: -1,
          status: "running",
        }));
      } else if (hasChain) {
        spawnResults = params.chain.map((s, i) => ({
          agent: s.agent,
          agentSource: agents.find(a => a.name === s.agent)?.source || "unknown",
          task: s.task,
          step: i + 1,
          exitCode: -1,
          status: "running",
        }));
      }

      return {
        content: [{ type: "text", text: responseText }],
        details: {
          jobId: id,
          mode,
          results: spawnResults,
          // For single
          agent: hasSingle ? params.agent : undefined,
          agentSource: hasSingle ? job.agentSource : undefined,
          task: hasSingle ? params.task : undefined,
          // For parallel
          tasks: hasTasks ? params.tasks : undefined,
          // For chain
          chain: hasChain ? params.chain : undefined,
          status: "running",
        },
      };
    },

    renderCall(args, theme) {
      const scope = args.agentScope ?? "both";

      // Chain mode
      if (args.chain && args.chain.length > 0) {
        let text = theme.fg("toolTitle", theme.bold("async_subagent ")) +
          theme.fg("accent", `chain (${args.chain.length} steps)`) +
          theme.fg("muted", ` [${scope}]`);
        for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
          const step = args.chain[i];
          const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
          const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
          text += "\n  " +
            theme.fg("muted", `${i + 1}.`) + " " +
            theme.fg("accent", step.agent) +
            theme.fg("dim", ` ${preview}`);
        }
        if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }

      // Parallel mode
      if (args.tasks && args.tasks.length > 0) {
        let text = theme.fg("toolTitle", theme.bold("async_subagent ")) +
          theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
          theme.fg("muted", ` [${scope}]`);
        for (const t of args.tasks.slice(0, 3)) {
          const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
          text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
        }
        if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }

      // Single mode
      const agentName = args.agent || "...";
      const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
      let text = theme.fg("toolTitle", theme.bold("async_subagent ")) +
        theme.fg("accent", agentName) +
        theme.fg("muted", ` [${scope}]`);
      text += `\n  ${theme.fg("dim", preview)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _opts, theme) {
      const details = result.details;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      if (result.isError) {
        const text = result.content[0];
        return new Text(theme.fg("error", "✗ ") + (text?.type === "text" ? text.text : "error"), 0, 0);
      }

      // Single mode
      if (details.mode === "single" || (!details.mode && details.agent)) {
        const text = theme.fg("warning", "⏳ ") +
          theme.fg("toolTitle", theme.bold(details.agent)) +
          theme.fg("muted", ` (${details.agentSource})`) +
          theme.fg("dim", ` ${details.jobId}`) +
          `\n${theme.fg("muted", "spawned — use await_subagent to collect")}`;
        return new Text(text, 0, 0);
      }

      // Parallel mode
      if (details.mode === "parallel" && details.tasks) {
        let text = theme.fg("warning", "⏳ ") +
          theme.fg("toolTitle", theme.bold("parallel ")) +
          theme.fg("accent", `${details.tasks.length} tasks`) +
          theme.fg("dim", ` ${details.jobId}`);
        for (const t of details.tasks.slice(0, 3)) {
          const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
          text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
        }
        if (details.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${details.tasks.length - 3} more`)}`;
        text += `\n${theme.fg("muted", "spawned — use await_subagent to collect")}`;
        return new Text(text, 0, 0);
      }

      // Chain mode
      if (details.mode === "chain" && details.chain) {
        let text = theme.fg("warning", "⏳ ") +
          theme.fg("toolTitle", theme.bold("chain ")) +
          theme.fg("accent", `${details.chain.length} steps`) +
          theme.fg("dim", ` ${details.jobId}`);
        for (let i = 0; i < Math.min(details.chain.length, 3); i++) {
          const step = details.chain[i];
          const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
          const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
          text += "\n  " +
            theme.fg("muted", `${i + 1}.`) + " " +
            theme.fg("accent", step.agent) +
            theme.fg("dim", ` ${preview}`);
        }
        if (details.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${details.chain.length - 3} more`)}`;
        text += `\n${theme.fg("muted", "spawned — use await_subagent to collect")}`;
        return new Text(text, 0, 0);
      }

      // Fallback
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
    },
  });

  // ── await_subagent tool ────────────────────────────────────────────────

  pi.registerTool({
    name: "await_subagent",
    label: "Await Subagent",
    description: [
      "Wait for subagent background jobs to complete and return their results.",
      "Provide specific job IDs or omit to wait for any running subagent job.",
    ].join(" "),
    parameters: awaitSubagentSchema,

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const jobIds = params.jobs;
      let toWait = [];

      if (jobIds && jobIds.length > 0) {
        const notFound = [];
        for (const id of jobIds) {
          const job = jobs.get(id);
          if (job) toWait.push(job);
          else notFound.push(id);
        }
        if (notFound.length > 0 && toWait.length === 0) {
          return {
            content: [{ type: "text", text: `No subagent jobs found: ${notFound.join(", ")}` }],
          };
        }
      } else {
        toWait = [...jobs.values()].filter(j => j.status === "running");
        if (toWait.length === 0) {
          return {
            content: [{ type: "text", text: "No running subagent jobs." }],
          };
        }
      }

      const done = toWait.filter(j => j.status !== "running");
      const running = toWait.filter(j => j.status === "running");

      // Wire up live progress updates for all running jobs
      if (onUpdate && running.length > 0) {
        const emitAwaitUpdate = () => {
          const allResults = [];
          for (const j of toWait) {
            for (const sr of (j.subResults || [])) {
              allResults.push({
                agent: sr.agent,
                agentSource: sr.agentSource,
                task: sr.task,
                step: sr.step,
                exitCode: sr.status === "completed" ? 0 : sr.status === "running" ? -1 : 1,
                status: sr.status,
                stopReason: sr.stopReason,
                errorMessage: sr.errorMessage,
                usage: sr.usage,
                model: sr.model,
              });
            }
          }
          const overallMode = toWait.length === 1 ? toWait[0].mode : "parallel";
          onUpdate({
            content: [{ type: "text", text: "Waiting for subagents..." }],
            details: { mode: overallMode, results: allResults },
          });
        };
        for (const j of running) {
          j._onUpdate = emitAwaitUpdate;
        }
      }

      if (running.length > 0) {
        await Promise.race([
          Promise.all(running.map(j => j._promise)),
          new Promise((_, reject) => {
            if (signal?.aborted) reject(new Error("aborted"));
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        ]).catch(() => {});
      }

      // Detach update callbacks
      for (const j of toWait) j._onUpdate = null;

      const allJobs = [...done, ...running];
      for (const j of allJobs) j.awaited = true;

      // Build flat list of all sub-results across all awaited jobs
      const allResults = [];
      for (const j of allJobs) {
        if (j.subResults && j.subResults.length > 0) {
          for (const sr of j.subResults) {
            allResults.push({ ...sr, id: j.id, jobMode: j.mode });
          }
        }
      }

      // Build text content
      const resultTexts = allJobs.map(j => {
        const elapsed = ((j.endTime || Date.now()) - j.startTime) / 1000;
        if (j.mode === "single") {
          const isError = j.status === "failed";
          return [
            `### ${j.id} — ${j.agentName} (${j.status}, ${elapsed.toFixed(1)}s)`,
            "",
            isError
              ? `**Error:** ${j.errorMessage || j.stderr || "unknown"}`
              : (j.finalOutput || "(no output)"),
            "",
            `_${formatUsageStats(j.usage, j.model)}_`,
          ].join("\n");
        } else {
          const subResults = j.subResults || [];
          const successCount = subResults.filter(r => r.status === "completed").length;
          const lines = [`### ${j.id} — ${j.mode} (${successCount}/${subResults.length} succeeded, ${elapsed.toFixed(1)}s)`, ""];
          for (const sr of subResults) {
            const srIcon = sr.status === "completed" ? "✓" : "✗";
            lines.push(`**${srIcon} ${sr.agent}** (step ${sr.step || ""})`);
            lines.push(sr.status === "failed"
              ? `Error: ${sr.errorMessage || sr.stderr || "unknown"}`
              : (getFinalOutput(sr.messages) || "(no output)"));
            lines.push("");
          }
          lines.push(`_${formatUsageStats(j.usage, j.model)}_`);
          return lines.join("\n");
        }
      });

      // Flatten all sub-results into a top-level results array for IDE rendering compatibility
      const flatResults = [];
      for (const j of allJobs) {
        if (j.subResults && j.subResults.length > 0) {
          for (const sr of j.subResults) {
            flatResults.push({
              agent: sr.agent,
              agentSource: sr.agentSource,
              task: sr.task,
              step: sr.step,
              status: sr.status,
              exitCode: sr.status === "completed" ? 0 : sr.status === "running" ? -1 : 1,
              stopReason: sr.stopReason,
              errorMessage: sr.errorMessage,
              finalOutput: sr.finalOutput,
              messages: sr.messages,
              model: sr.model,
              usage: sr.usage,
            });
          }
        }
      }

      // Determine overall mode
      const overallMode = allJobs.length === 1 ? allJobs[0].mode : "parallel";

      return {
        content: [{ type: "text", text: resultTexts.join("\n---\n\n") || "No results." }],
        details: {
          mode: overallMode,
          results: flatResults,
          jobs: allJobs.map(j => ({
            id: j.id,
            mode: j.mode,
            label: j.label,
            status: j.status,
            exitCode: j.exitCode,
            subResults: (j.subResults || []).map(sr => ({
              agent: sr.agent,
              agentSource: sr.agentSource,
              task: sr.task,
              step: sr.step,
              status: sr.status,
              exitCode: sr.exitCode,
              stopReason: sr.stopReason,
              errorMessage: sr.errorMessage,
              finalOutput: sr.finalOutput,
              messages: sr.messages,
              model: sr.model,
              usage: sr.usage,
            })),
            usage: j.usage,
            model: j.model,
            elapsed: ((j.endTime || Date.now()) - j.startTime) / 1000,
          })),
        },
      };
    },

    renderCall(args, theme) {
      if (args.jobs && args.jobs.length > 0) {
        const text = theme.fg("toolTitle", theme.bold("await_subagent ")) +
          theme.fg("accent", args.jobs.join(", "));
        return new Text(text, 0, 0);
      }
      return new Text(theme.fg("toolTitle", theme.bold("await_subagent ")) + theme.fg("muted", "(all running)"), 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details;
      if (!details || !details.jobs || details.jobs.length === 0) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
      }

      // Single job with single sub-result — use the rich single display
      if (details.jobs.length === 1 && details.jobs[0].mode === "single" && details.jobs[0].subResults?.length === 1) {
        const j = details.jobs[0];
        const sr = j.subResults[0];
        return renderSingleResult({ ...sr, id: j.id }, expanded, theme);
      }

      // Multiple jobs or parallel/chain — render each job with its sub-results
      const container = expanded ? new Container() : null;
      let collapsedText = "";

      const totalJobs = details.jobs.length;
      const totalSuccess = details.jobs.filter(j => j.exitCode === 0).length;
      const headerIcon = totalSuccess === totalJobs ? theme.fg("success", "✓") : theme.fg("warning", "◐");
      const headerText = `${headerIcon} ${theme.fg("toolTitle", theme.bold("await_subagent "))}${theme.fg("accent", `${totalSuccess}/${totalJobs} jobs`)}`;

      if (expanded) {
        container.addChild(new Text(headerText, 0, 0));
      } else {
        collapsedText = headerText;
      }

      for (const j of details.jobs) {
        if (j.mode === "single" && j.subResults?.length === 1) {
          const sr = j.subResults[0];
          if (expanded) {
            container.addChild(new Spacer(1));
            container.addChild(renderSingleResult({ ...sr, id: j.id }, true, theme));
          } else {
            const rIcon = sr.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
            const displayItems = getDisplayItems(sr.messages || []);
            collapsedText += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", sr.agent)} ${rIcon} ${theme.fg("dim", j.id)}`;
            if (displayItems.length === 0) collapsedText += `\n${theme.fg("muted", "(no output)")}`;
            else collapsedText += `\n${renderDisplayItemsText(displayItems, theme, false, 5)}`;
          }
        } else {
          // Parallel or chain job
          const subResults = j.subResults || [];
          const subSuccess = subResults.filter(r => r.status === "completed").length;
          const jIcon = subSuccess === subResults.length ? theme.fg("success", "✓") : theme.fg("warning", "◐");
          const jHeader = `${jIcon} ${theme.fg("toolTitle", theme.bold(j.mode + " "))}${theme.fg("accent", `${subSuccess}/${subResults.length}`)} ${theme.fg("dim", j.id)}`;

          if (expanded) {
            container.addChild(new Spacer(1));
            container.addChild(new Text(jHeader, 0, 0));
            for (const sr of subResults) {
              container.addChild(new Spacer(1));
              container.addChild(renderSingleResult(sr, true, theme));
            }
          } else {
            collapsedText += `\n\n${jHeader}`;
            for (const sr of subResults) {
              const srIcon = sr.status === "completed" ? theme.fg("success", "✓") :
                             sr.status === "running" ? theme.fg("warning", "⏳") : theme.fg("error", "✗");
              const displayItems = getDisplayItems(sr.messages || []);
              collapsedText += `\n  ${theme.fg("accent", sr.agent)} ${srIcon}`;
              if (sr.step) collapsedText += theme.fg("muted", ` step ${sr.step}`);
              if (displayItems.length === 0) collapsedText += ` ${theme.fg("muted", "(no output)")}`;
              else collapsedText += `\n${renderDisplayItemsText(displayItems, theme, false, 3)}`;
            }
          }
        }
      }

      // Total usage across all jobs
      const totalUsage = aggregateUsage(details.jobs.map(j => ({ usage: j.usage })));
      const totalStr = formatUsageStats(totalUsage);
      if (totalStr) {
        if (expanded) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("dim", `Total: ${totalStr}`), 0, 0));
        } else {
          collapsedText += `\n\n${theme.fg("dim", `Total: ${totalStr}`)}`;
        }
      }

      if (expanded) return container;
      collapsedText += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
      return new Text(collapsedText, 0, 0);
    },
  });

  // ── /subagent-jobs command ─────────────────────────────────────────────

  pi.registerCommand("subagent-jobs", {
    description: "Show running and recent subagent background jobs",
    handler: async () => {
      const all = [...jobs.values()].sort((a, b) => b.startTime - a.startTime);
      if (all.length === 0) {
        pi.sendMessage({
          customType: "subagent_jobs_list",
          content: "No subagent jobs.",
          display: true,
        });
        return;
      }

      const running = all.filter(j => j.status === "running");
      const completed = all.filter(j => j.status !== "running");

      const lines = ["## Subagent Jobs"];
      if (running.length > 0) {
        lines.push("", "### Running");
        for (const j of running) {
          const elapsed = ((Date.now() - j.startTime) / 1000).toFixed(0);
          lines.push(`- **${j.id}** — ${j.label} (${elapsed}s)`);
        }
      }
      if (completed.length > 0) {
        lines.push("", "### Recent");
        for (const j of completed.slice(0, 10)) {
          const elapsed = ((j.endTime - j.startTime) / 1000).toFixed(1);
          lines.push(`- **${j.id}** — ${j.label} (${j.status}, ${elapsed}s)`);
        }
      }

      pi.sendMessage({
        customType: "subagent_jobs_list",
        content: lines.join("\n"),
        display: true,
      });
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function killJobProcesses(job) {
  if (job.subResults) {
    for (const sr of job.subResults) {
      if (sr._proc) {
        try { sr._proc.kill("SIGTERM"); } catch {}
      }
    }
  }
}
