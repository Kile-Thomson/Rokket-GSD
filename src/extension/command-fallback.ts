/**
 * GSD command fallback logic — handles the workaround for /gsd commands
 * that don't trigger an agent turn via RPC (interactive wizard limitation).
 *
 * Extracted from webview-provider.ts (S01/T03).
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import type { GsdRpcClient } from "./rpc-client";
import type { SessionState } from "./session-state";
import type { ExtensionToWebviewMessage } from "../shared/types";
import { toErrorMessage } from "../shared/errors";
import { COMMAND_FALLBACK_DELAY_MS } from "../shared/constants";

// ── Regexes ─────────────────────────────────────────────────────────────

/** Matches `/gsd` with optional recognised subcommand. */
export const GSD_COMMAND_RE =
  /^\/gsd(?:\s+(auto|next|stop|pause|status|queue|quick|mode|help|forensics|doctor|discuss|visualize|capture|steer|knowledge|config|prefs|migrate|remote|changelog|triage|dispatch|history|undo|skip|cleanup|hooks|run-hook|skill-health|init|setup|inspect|new-milestone|parallel|park|unpark|start|templates|extensions|export|keys|logs|rate))?(?:\s|$)/;

/** Matches TUI-only slash commands that need direct fallback (no timer). */
export const TUI_ONLY_COMMAND_RE =
  /^\/ollama(?:\s|$)/i;

/**
 * Subcommands that work natively in RPC mode — they don't need fallbacks.
 * This includes commands handled by gsd-pi's slash-command system that
 * produce their own agent_start event or interactive UI.
 */
export const GSD_NATIVE_SUBCOMMANDS =
  /^\s*\/gsd\s+(auto|stop|pause|next|status|steer|remote|prefs|parallel|park|unpark|config|keys|setup|doctor|extensions|changelog|knowledge|templates|hooks|run-hook|skill-health|inspect|logs|init|triage|forensics|queue|history|discuss|capture|visualize|help|update|mode|rate)\b/i;

// ── Context interface ───────────────────────────────────────────────────

export interface CommandFallbackContext {
  getSession(sessionId: string): SessionState;
  postToWebview(webview: vscode.Webview, message: ExtensionToWebviewMessage | Record<string, unknown>): void;
  output: vscode.OutputChannel;
}

// ── Exported functions ──────────────────────────────────────────────────

/**
 * Arm the /gsd fallback probe — reset turn-started flag and cancel any
 * existing fallback timer. Must be called BEFORE prompt() so agent_start
 * events during the RPC await don't get clobbered.
 */
export function armGsdFallbackProbe(
  ctx: CommandFallbackContext,
  message: string,
  sessionId: string,
  _webview: vscode.Webview,
): void {
  if (!GSD_COMMAND_RE.test(message)) return;
  const existingTimer = ctx.getSession(sessionId).gsdFallbackTimer;
  if (existingTimer) {
    clearTimeout(existingTimer);
    ctx.getSession(sessionId).gsdFallbackTimer = null;
  }
  ctx.getSession(sessionId).gsdTurnStarted = false;
}

/**
 * Start the /gsd fallback timer — if no agent_start arrived within 500ms,
 * fire the workaround prompt. Must be called AFTER prompt() resolves.
 *
 * Subcommands that work natively in RPC mode (auto, stop, pause, next,
 * status, steer, remote, prefs, parallel) are excluded — they don't need fallbacks.
 */
export function startGsdFallbackTimer(
  ctx: CommandFallbackContext,
  message: string,
  sessionId: string,
  webview: vscode.Webview,
): void {
  if (!GSD_COMMAND_RE.test(message)) return;
  // Skip fallback for subcommands that work natively in RPC mode
  if (GSD_NATIVE_SUBCOMMANDS.test(message)) return;
  const fallbackTimer = setTimeout(async () => {
    if (ctx.getSession(sessionId).gsdFallbackTimer !== fallbackTimer) return;
    ctx.getSession(sessionId).gsdFallbackTimer = null;
    const started = ctx.getSession(sessionId).gsdTurnStarted;
    ctx.getSession(sessionId).gsdTurnStarted = false;
    const client = ctx.getSession(sessionId).client;
    if (!client?.isRunning) return;
    if (!started) {
      ctx.output.appendLine(`[${sessionId}] /gsd command produced no agent turn — applying workaround`);
      await handleGsdAutoFallback(ctx, client, webview, sessionId, message);
    }
  }, COMMAND_FALLBACK_DELAY_MS);
  ctx.getSession(sessionId).gsdFallbackTimer = fallbackTimer;
}

/**
 * Handle a /gsd command that failed to trigger an agent turn — build a
 * context-aware fallback prompt and send it as a regular LLM prompt.
 */
export async function handleGsdAutoFallback(
  ctx: CommandFallbackContext,
  client: GsdRpcClient,
  webview: vscode.Webview,
  sessionId: string,
  originalCommand: string,
): Promise<void> {
  try {
    // Read STATE.md to understand project status
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let stateContent = "";
    if (cwd) {
      const statePath = path.join(cwd, ".gsd", "STATE.md");
      try {
        stateContent = await fs.promises.readFile(statePath, "utf8");
      } catch {
        // No STATE.md — project has no GSD setup yet
      }
    }

    let fallbackPrompt: string;
    let fallbackNotice: string;
    const cmdParts = originalCommand.trim().split(/\s+/);
    const subcommand = cmdParts[1] || "";

    if (!stateContent) {
      switch (subcommand) {
        case "auto":
          fallbackNotice = "ℹ️ The /gsd interactive menu isn't available yet — entering auto-mode...";
          fallbackPrompt = `The user ran "${originalCommand}" but there is no .gsd/STATE.md yet. Enter auto-mode and guide the user through first-time GSD setup — understand what the project is and help them define their first milestone.`;
          break;
        case "stop":
          fallbackNotice = "ℹ️ Auto-mode isn't active.";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet, so there is no active GSD workflow to stop. Tell the user that clearly and wait for the next instruction.`;
          break;
        case "status":
        case "visualize":
          fallbackNotice = "ℹ️ Reading project status...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that GSD has not been initialised in this project. Do not execute new work.`;
          break;
        case "queue":
          fallbackNotice = "ℹ️ Reading milestone queue...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there is no queue because GSD has not been initialised. Do not execute new work.`;
          break;
        case "quick":
          fallbackNotice = "ℹ️ Starting quick task...";
          fallbackPrompt = `The user ran "${originalCommand}". Execute it as a quick task with GSD guarantees (atomic commits, state tracking). Ask the user what task they want to accomplish, then plan and execute it.`;
          break;
        case "help":
          fallbackNotice = "ℹ️ Loading command reference...";
          fallbackPrompt = `The user ran "${originalCommand}". Show a categorized reference of all available GSD commands with descriptions. Do not execute new work.`;
          break;
        case "forensics":
          fallbackNotice = "ℹ️ Running forensics...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet, so there is no auto-mode history to analyze. Report that GSD has not been initialised.`;
          break;
        case "doctor":
          fallbackNotice = "ℹ️ Running health checks...";
          fallbackPrompt = `The user ran "${originalCommand}". Run diagnostic health checks on the GSD installation and project state. Report any issues found and suggest fixes.`;
          break;
        case "mode":
          fallbackNotice = "ℹ️ Loading workflow modes...";
          fallbackPrompt = `The user ran "${originalCommand}". Show available workflow modes (solo, team) and let the user choose. Do not execute new work.`;
          break;
        case "changelog":
          fallbackNotice = "ℹ️ Fetching release notes...";
          fallbackPrompt = `The user ran "${originalCommand}". Fetch and display the recent GSD changelog / release notes. Do not execute new work.`;
          break;
        case "triage":
          fallbackNotice = "ℹ️ Triaging captures...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there are no captures to triage because GSD has not been initialised.`;
          break;
        case "dispatch":
          fallbackNotice = "ℹ️ Dispatching phase...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there is nothing to dispatch because GSD has not been initialised.`;
          break;
        case "history":
          fallbackNotice = "ℹ️ Loading execution history...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there is no execution history because GSD has not been initialised.`;
          break;
        case "undo":
          fallbackNotice = "ℹ️ Reverting last unit...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there is nothing to undo because GSD has not been initialised.`;
          break;
        case "skip":
          fallbackNotice = "ℹ️ Skipping unit...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there is nothing to skip because GSD has not been initialised.`;
          break;
        case "cleanup":
          fallbackNotice = "ℹ️ Running cleanup...";
          fallbackPrompt = `The user ran "${originalCommand}". Clean up merged GSD branches and old snapshots. Report what was cleaned up.`;
          break;
        case "hooks":
          fallbackNotice = "ℹ️ Loading hooks...";
          fallbackPrompt = `The user ran "${originalCommand}". Show configured post-unit and pre-dispatch hooks from GSD preferences.`;
          break;
        case "run-hook":
          fallbackNotice = "ℹ️ Running hook...";
          fallbackPrompt = `The user ran "${originalCommand}". Manually trigger a specific GSD hook. Show available hooks and let the user choose.`;
          break;
        case "skill-health":
          fallbackNotice = "ℹ️ Loading skill health...";
          fallbackPrompt = `The user ran "${originalCommand}". Show the skill lifecycle dashboard — which skills are installed, their status, and any issues.`;
          break;
        case "init":
          fallbackNotice = "ℹ️ Starting project init...";
          fallbackPrompt = `The user ran "${originalCommand}". Run the GSD project initialization wizard — detect project type, configure settings, and bootstrap the .gsd/ directory.`;
          break;
        case "setup":
          fallbackNotice = "ℹ️ Loading setup status...";
          fallbackPrompt = `The user ran "${originalCommand}". Show global GSD setup status and configuration — installed version, provider status, API keys.`;
          break;
        case "inspect":
          fallbackNotice = "ℹ️ Running DB inspection...";
          fallbackPrompt = `The user ran "${originalCommand}". Show SQLite database diagnostics for the .gsd/ project database.`;
          break;
        case "new-milestone":
          fallbackNotice = "ℹ️ Creating milestone...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Initialise GSD first, then help the user create their first milestone from a specification.`;
          break;
        case "park":
          fallbackNotice = "ℹ️ Parking milestone...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there is no active milestone to park because GSD has not been initialised.`;
          break;
        case "unpark":
          fallbackNotice = "ℹ️ Unparking milestone...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there are no parked milestones because GSD has not been initialised.`;
          break;
        case "start":
          fallbackNotice = "ℹ️ Starting workflow template...";
          fallbackPrompt = `The user ran "${originalCommand}". Show available workflow templates (bugfix, spike, feature, etc.) and help the user start one.`;
          break;
        case "templates":
          fallbackNotice = "ℹ️ Loading templates...";
          fallbackPrompt = `The user ran "${originalCommand}". List all available GSD workflow templates with descriptions. Do not execute new work.`;
          break;
        case "extensions":
          fallbackNotice = "ℹ️ Loading extensions...";
          fallbackPrompt = `The user ran "${originalCommand}". List installed GSD extensions and their status. Do not execute new work.`;
          break;
        case "export":
          fallbackNotice = "ℹ️ Exporting report...";
          fallbackPrompt = `The user ran "${originalCommand}". There is no .gsd/STATE.md yet. Report that there is nothing to export because GSD has not been initialised.`;
          break;
        case "logs":
          fallbackNotice = "ℹ️ Loading logs...";
          fallbackPrompt = `The user ran "${originalCommand}". Browse activity, debug, and metrics logs from .gsd/activity/ and .gsd/debug/. Report what's available.`;
          break;
        case "keys":
          fallbackNotice = "ℹ️ Loading API keys...";
          fallbackPrompt = `The user ran "${originalCommand}". Show the API key manager — list configured keys, their status, and available actions.`;
          break;
        default:
          fallbackNotice = "ℹ️ The /gsd interactive menu isn't available yet — reading project state and continuing automatically...";
          fallbackPrompt = `The user ran "${originalCommand}" but the interactive wizard couldn't display. There is no .gsd/STATE.md yet, so this project needs GSD initialization. Read the GSD workflow documentation and help the user set up their first milestone. Start by understanding what the project is and what they want to accomplish.`;
          break;
      }
    } else {
      const statePrefix = `The user ran "${originalCommand}" but the interactive wizard couldn't display (known RPC limitation). Here is the current .gsd/STATE.md:\n\n${stateContent}\n\n`;

      switch (subcommand) {
        case "auto":
          fallbackNotice = "ℹ️ The /gsd interactive menu isn't available yet — entering auto-mode...";
          fallbackPrompt = statePrefix + `You are now in auto-mode. Execute continuously without stopping to ask for confirmation between steps. Read the relevant .gsd/ files and:\n\n- If the phase is "complete" with no active work: start a new milestone. Ask the user what they want to build next.\n- If there's an active milestone with no roadmap: research and create the roadmap.\n- If there's a roadmap but no active slice: plan and begin the next slice.\n- If there's an active task: continue executing it.\n- If a slice is complete: run verification, write the summary, and move to the next slice.\n\nDo NOT just report status. Take action. Execute the work.`;
          break;
        case "stop":
          fallbackNotice = "ℹ️ Stopping auto-mode...";
          fallbackPrompt = statePrefix + `The user wants to stop auto-mode. Do NOT continue executing new work. Confirm that auto-mode has been stopped and wait for the next instruction.`;
          break;
        case "status":
        case "visualize":
          fallbackNotice = "ℹ️ Reading project status...";
          fallbackPrompt = statePrefix + `The user wants a status report. Read the relevant .gsd/ files and report the current state. Do NOT execute new work — just report what's in progress, what's complete, and what's next.`;
          break;
        case "queue":
          fallbackNotice = "ℹ️ Reading milestone queue...";
          fallbackPrompt = statePrefix + `The user wants to see the milestone queue. Read .gsd/QUEUE.md and any relevant state files, then report queued milestones. Do NOT execute new work.`;
          break;
        case "quick":
          fallbackNotice = "ℹ️ Starting quick task...";
          fallbackPrompt = statePrefix + `The user wants to run a quick task. Execute it with GSD guarantees (atomic commits, state tracking) without full milestone planning. Ask the user what task they want to accomplish if not specified, then plan and execute it.`;
          break;
        case "help":
          fallbackNotice = "ℹ️ Loading command reference...";
          fallbackPrompt = statePrefix + `Show a categorized reference of all available GSD commands with descriptions. Do not execute new work.`;
          break;
        case "forensics":
          fallbackNotice = "ℹ️ Running forensics...";
          fallbackPrompt = statePrefix + `Run a post-mortem investigation on the most recent auto-mode session. Read .gsd/activity/ logs, STATE.md, and any error artifacts to identify what went wrong and provide a structured root-cause analysis.`;
          break;
        case "doctor":
          fallbackNotice = "ℹ️ Running health checks...";
          fallbackPrompt = statePrefix + `Run diagnostic health checks on the GSD installation and project state. Check for state corruption, stale locks, orphaned worktrees, and other common issues. Report findings and auto-fix where safe.`;
          break;
        case "mode":
          fallbackNotice = "ℹ️ Loading workflow modes...";
          fallbackPrompt = statePrefix + `Show available workflow modes (solo, team) and the current mode. Let the user choose a mode if they want to switch.`;
          break;
        case "changelog":
          fallbackNotice = "ℹ️ Fetching release notes...";
          fallbackPrompt = statePrefix + `Fetch and display the recent GSD changelog / release notes. Do not execute new work.`;
          break;
        case "triage":
          fallbackNotice = "ℹ️ Triaging captures...";
          fallbackPrompt = statePrefix + `Manually trigger triage of pending captures. Read .gsd/captures/ and process any unresolved items. Report what was triaged.`;
          break;
        case "dispatch":
          fallbackNotice = "ℹ️ Dispatching phase...";
          fallbackPrompt = statePrefix + `The user wants to dispatch a specific phase directly. Determine the available phases and either dispatch the one specified or let the user choose.`;
          break;
        case "history":
          fallbackNotice = "ℹ️ Loading execution history...";
          fallbackPrompt = statePrefix + `Show the execution history. Read .gsd/activity/ logs and present a summary of recent units, their outcomes, costs, and durations.`;
          break;
        case "undo":
          fallbackNotice = "ℹ️ Reverting last unit...";
          fallbackPrompt = statePrefix + `The user wants to undo the last completed unit. Identify the most recent completed unit and revert it safely (git revert, state update). Confirm before acting.`;
          break;
        case "skip":
          fallbackNotice = "ℹ️ Skipping unit...";
          fallbackPrompt = statePrefix + `The user wants to skip a unit from auto-mode dispatch. Identify the current or next pending unit and mark it as skipped so auto-mode won't dispatch it.`;
          break;
        case "cleanup":
          fallbackNotice = "ℹ️ Running cleanup...";
          fallbackPrompt = statePrefix + `Clean up merged GSD branches and old snapshots. Report what was cleaned up.`;
          break;
        case "hooks":
          fallbackNotice = "ℹ️ Loading hooks...";
          fallbackPrompt = statePrefix + `Show configured post-unit and pre-dispatch hooks from GSD preferences. Read .gsd/preferences.md and report hook configuration.`;
          break;
        case "run-hook":
          fallbackNotice = "ℹ️ Running hook...";
          fallbackPrompt = statePrefix + `Manually trigger a specific GSD hook. Show available hooks and let the user choose which to run.`;
          break;
        case "skill-health":
          fallbackNotice = "ℹ️ Loading skill health...";
          fallbackPrompt = statePrefix + `Show the skill lifecycle dashboard — which skills are installed, their status, and any issues.`;
          break;
        case "init":
          fallbackNotice = "ℹ️ Starting project init...";
          fallbackPrompt = statePrefix + `Run the GSD project initialization wizard. Since .gsd/ already exists, check if reconfiguration is needed.`;
          break;
        case "setup":
          fallbackNotice = "ℹ️ Loading setup status...";
          fallbackPrompt = statePrefix + `Show global GSD setup status and configuration — installed version, provider status, API keys.`;
          break;
        case "inspect":
          fallbackNotice = "ℹ️ Running DB inspection...";
          fallbackPrompt = statePrefix + `Show SQLite database diagnostics for the .gsd/ project database. Report table counts, integrity, and any anomalies.`;
          break;
        case "new-milestone":
          fallbackNotice = "ℹ️ Creating milestone...";
          fallbackPrompt = statePrefix + `The user wants to create a new milestone from a specification. Help them provide context (a spec document or description) and create the milestone with proper GSD structure.`;
          break;
        case "park":
          fallbackNotice = "ℹ️ Parking milestone...";
          fallbackPrompt = statePrefix + `The user wants to park a milestone (skip without deleting). Identify the target milestone and park it with a reason.`;
          break;
        case "unpark":
          fallbackNotice = "ℹ️ Unparking milestone...";
          fallbackPrompt = statePrefix + `The user wants to reactivate a parked milestone. List parked milestones and let the user choose which to unpark.`;
          break;
        case "start":
          fallbackNotice = "ℹ️ Starting workflow template...";
          fallbackPrompt = statePrefix + `Show available workflow templates (bugfix, spike, feature, etc.) and help the user start one. Templates provide pre-configured milestone structure for common tasks.`;
          break;
        case "templates":
          fallbackNotice = "ℹ️ Loading templates...";
          fallbackPrompt = statePrefix + `List all available GSD workflow templates with descriptions. Do not execute new work.`;
          break;
        case "extensions":
          fallbackNotice = "ℹ️ Loading extensions...";
          fallbackPrompt = statePrefix + `List installed GSD extensions and their status (enabled/disabled). Show extension info. Do not execute new work.`;
          break;
        case "export":
          fallbackNotice = "ℹ️ Exporting report...";
          fallbackPrompt = statePrefix + `Export the current milestone as an HTML report. Generate a self-contained HTML file with metrics, progress, and timeline.`;
          break;
        case "logs":
          fallbackNotice = "ℹ️ Loading logs...";
          fallbackPrompt = statePrefix + `Browse activity, debug, and metrics logs from .gsd/activity/ and .gsd/debug/. Report recent activity summaries.`;
          break;
        case "keys":
          fallbackNotice = "ℹ️ Loading API keys...";
          fallbackPrompt = statePrefix + `Show the API key manager — list configured keys, their status, and available actions (add, remove, test, rotate).`;
          break;
        default:
          // /gsd or /gsd next — step mode
          fallbackNotice = "ℹ️ The /gsd interactive menu isn't available yet — reading project state and continuing automatically...";
          fallbackPrompt = statePrefix + `Based on this state, determine the appropriate next action and execute it. If the phase is "complete" and there are no active slices, check if there's a branch to squash-merge or if the user needs a new milestone. If there's active work, continue executing it. Read relevant .gsd/ files to understand the full context before proceeding. IMPORTANT: Always communicate your findings to the user — tell them what state the project is in and what you're doing (or why there's nothing to do).`;
          break;
      }
    }

    ctx.output.appendLine(`[${sessionId}] Sending fallback prompt for "${originalCommand}"`);
    ctx.postToWebview(webview, {
      type: "extension_ui_request",
      id: `gsd-fallback-${Date.now()}`,
      method: "notify",
      message: fallbackNotice,
      notifyType: "info",
    } as ExtensionToWebviewMessage);

    // Send as a regular prompt — this bypasses the extension command system
    // and goes straight to the LLM, which CAN work in RPC mode
    await client.prompt(fallbackPrompt);
  } catch (err: unknown) {
    ctx.output.appendLine(`[${sessionId}] GSD auto fallback failed: ${toErrorMessage(err)}`);
    ctx.postToWebview(webview, {
      type: "error",
      message: `The /gsd command couldn't complete. Try sending a plain text message describing what you want to do instead.`,
    } as ExtensionToWebviewMessage);
  }
}

// ── TUI-only command fallback ───────────────────────────────────────────

const OLLAMA_HOST = "http://localhost:11434";

function ollamaGet(urlPath: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${OLLAMA_HOST}${urlPath}`, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function ollamaDelete(urlPath: string, payload: Record<string, unknown>, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(`${OLLAMA_HOST}${urlPath}`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "DELETE",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

function ollamaPost(urlPath: string, payload: Record<string, unknown>, timeoutMs = 120000): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(`${OLLAMA_HOST}${urlPath}`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(data);
    req.end();
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function sendSyntheticResponse(
  ctx: CommandFallbackContext,
  webview: vscode.Webview,
  markdown: string,
): void {
  const post = (msg: Record<string, unknown>) => ctx.postToWebview(webview, msg);
  post({ type: "agent_start" });
  post({ type: "message_start", message: { role: "assistant" } });
  post({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: markdown } });
  post({ type: "message_end", message: { role: "assistant" } });
  post({ type: "agent_end", messages: [] });
}

interface OllamaModelInfo {
  name: string;
  size: number;
  size_vram?: number;
  expires_at?: string;
  modified_at?: string;
  digest?: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

function vramBar(size: number, sizeVram: number): string {
  const pct = size > 0 ? Math.round((sizeVram / size) * 100) : 0;
  const filled = Math.round(pct / 10);
  const bar = "\u2593".repeat(filled) + "\u2591".repeat(10 - filled);
  return `\`${bar}\` ${pct}%`;
}

function ollamaBtn(action: "load" | "unload" | "pull" | "remove", model: string, label?: string): string {
  const labels: Record<string, string> = { load: "Load", unload: "Unload", pull: "Pull", remove: "Remove" };
  const display = label || labels[action] || action;
  return `<button class="gsd-ollama-btn gsd-ollama-btn--${action}" data-action="ollama_${action}" data-model="${model}" title="${display} ${model}">${display}</button>`;
}

function modelDetail(m: OllamaModelInfo): string {
  const parts: string[] = [];
  if (m.details?.parameter_size) parts.push(m.details.parameter_size);
  if (m.details?.quantization_level) parts.push(m.details.quantization_level);
  if (m.details?.family) parts.push(m.details.family);
  return parts.length ? parts.join(" · ") : "";
}

async function handleOllamaStatus(): Promise<string> {
  try {
    await ollamaGet("/");
  } catch {
    return "## \u{1F534} Ollama Offline\n\nThe Ollama server isn't responding at `localhost:11434`.\n\nStart it with `ollama serve` or launch the Ollama desktop app.";
  }

  const lines: string[] = ["## \u{1F7E2} Ollama Running\n"];

  try {
    const versionRaw = await ollamaGet("/api/version");
    const version = JSON.parse(versionRaw) as { version?: string };
    if (version.version) lines.push(`**Version:** \`${version.version}\`\n`);
  } catch { /* version endpoint optional */ }

  // Loaded models (in VRAM)
  let loadedNames: Set<string> | undefined;
  try {
    const psRaw = await ollamaGet("/api/ps");
    const ps = JSON.parse(psRaw) as { models?: OllamaModelInfo[] };
    if (ps.models?.length) {
      loadedNames = new Set(ps.models.map(m => m.name));
      lines.push("### Loaded in Memory\n");
      lines.push("| Model | Size | VRAM | Expires | |");
      lines.push("|-------|------|------|---------|---|");
      for (const m of ps.models) {
        const vram = m.size_vram != null ? vramBar(m.size, m.size_vram) : "\u2014";
        const expires = m.expires_at ? new Date(m.expires_at).toLocaleTimeString() : "\u2014";
        lines.push(`| \`${m.name}\` | ${formatBytes(m.size)} | ${vram} | ${expires} | ${ollamaBtn("unload", m.name)} |`);
      }
      lines.push("");
    } else {
      lines.push("*No models loaded in memory.*\n");
    }
  } catch { /* ps endpoint optional */ }

  // Available models (installed on disk)
  try {
    const tagsRaw = await ollamaGet("/api/tags");
    const tags = JSON.parse(tagsRaw) as { models?: OllamaModelInfo[] };
    if (tags.models?.length) {
      const unloaded = loadedNames ? tags.models.filter(m => !loadedNames!.has(m.name)) : tags.models;
      if (unloaded.length) {
        lines.push("### Available on Disk\n");
        lines.push("| Model | Size | Details | |");
        lines.push("|-------|------|---------|---|");
        for (const m of unloaded) {
          const detail = modelDetail(m) || "\u2014";
          lines.push(`| \`${m.name}\` | ${formatBytes(m.size)} | ${detail} | ${ollamaBtn("load", m.name)} ${ollamaBtn("remove", m.name)} |`);
        }
      }
      lines.push("");
      lines.push(`**${tags.models.length}** model${tags.models.length === 1 ? "" : "s"} installed \u00B7 ${loadedNames?.size ?? 0} loaded`);
    } else {
      lines.push("No models installed yet.\n\n**Get started:** `/ollama pull llama3.1:8b`");
    }
  } catch { /* tags endpoint optional */ }

  return lines.join("\n");
}

async function handleOllamaList(): Promise<string> {
  try {
    const tagsRaw = await ollamaGet("/api/tags");
    const tags = JSON.parse(tagsRaw) as { models?: OllamaModelInfo[] };
    if (!tags.models?.length) return "## Ollama Models\n\nNo models installed yet.\n\n**Popular models:** `llama3.1:8b` \u00B7 `qwen2.5-coder:7b` \u00B7 `deepseek-r1:8b` \u00B7 `codestral:22b`\n\n**Install:** `/ollama pull llama3.1:8b`";

    // Check which models are loaded to show appropriate actions
    let loadedNames: Set<string> | undefined;
    try {
      const psRaw = await ollamaGet("/api/ps");
      const ps = JSON.parse(psRaw) as { models?: OllamaModelInfo[] };
      if (ps.models?.length) loadedNames = new Set(ps.models.map(m => m.name));
    } catch { /* ps optional */ }

    let totalSize = 0;
    const lines = ["## Ollama Models\n", "| Model | Size | Details | |", "|-------|------|---------|---|"];
    for (const m of tags.models) {
      totalSize += m.size;
      const detail = modelDetail(m) || "\u2014";
      const isLoaded = loadedNames?.has(m.name);
      const actions = isLoaded
        ? ollamaBtn("unload", m.name)
        : `${ollamaBtn("load", m.name)} ${ollamaBtn("remove", m.name)}`;
      lines.push(`| \`${m.name}\` | ${formatBytes(m.size)} | ${detail} | ${actions} |`);
    }
    lines.push("");
    lines.push(`**${tags.models.length}** model${tags.models.length === 1 ? "" : "s"} \u00B7 ${formatBytes(totalSize)} total`);
    return lines.join("\n");
  } catch {
    return "## \u{1F534} Ollama Offline\n\nStart it with `ollama serve` or launch the Ollama desktop app.";
  }
}

async function handleOllamaPs(): Promise<string> {
  try {
    const psRaw = await ollamaGet("/api/ps");
    const ps = JSON.parse(psRaw) as { models?: OllamaModelInfo[] };
    if (!ps.models?.length) return "## Loaded Models\n\n*No models currently loaded in memory.*\n\nLoad one with `/ollama pull <model>` then use it in a prompt.";

    const lines = ["## Loaded Models\n", "| Model | Size | VRAM | Expires | |", "|-------|------|------|---------|---|"];
    for (const m of ps.models) {
      const vram = m.size_vram != null ? vramBar(m.size, m.size_vram) : "\u2014";
      const expires = m.expires_at ? new Date(m.expires_at).toLocaleTimeString() : "\u2014";
      lines.push(`| \`${m.name}\` | ${formatBytes(m.size)} | ${vram} | ${expires} | ${ollamaBtn("unload", m.name)} |`);
    }
    return lines.join("\n");
  } catch {
    return "## \u{1F534} Ollama Offline\n\nStart it with `ollama serve` or launch the Ollama desktop app.";
  }
}

async function handleOllamaPull(model: string): Promise<string> {
  if (!model) return "## Pull Model\n\n**Usage:** `/ollama pull <model>`\n\n**Popular models:** `llama3.1:8b` \u00B7 `qwen2.5-coder:7b` \u00B7 `deepseek-r1:8b` \u00B7 `codestral:22b`";

  try {
    const raw = await ollamaPost("/api/pull", { name: model, stream: false });
    const result = JSON.parse(raw) as { status?: string; error?: string };
    if (result.error) return `## \u274C Pull Failed\n\n\`${model}\`: ${result.error}`;
    return `## \u2705 Pulled \`${model}\`\n\nStatus: ${result.status || "complete"}\n\nRun \`/ollama list\` to see all installed models.`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "timeout") return `## \u23F3 Pull In Progress\n\n\`${model}\` is still downloading in the background.\n\nCheck progress with \`/ollama list\`.`;
    return `## \u274C Pull Failed\n\n\`${model}\`: ${msg}\n\nMake sure Ollama is running (\`ollama serve\`).`;
  }
}

async function handleOllamaLoad(model: string): Promise<string> {
  if (!model) return "## Load Model\n\n**Usage:** `/ollama load <model>`\n\nRun `/ollama list` to see installed models.";

  try {
    const raw = await ollamaPost("/api/generate", { model, keep_alive: "10m" }, 300000);
    const result = JSON.parse(raw) as { error?: string };
    if (result.error) return `## \u274C Load Failed\n\n\`${model}\`: ${result.error}`;
    return `## \u2705 Loaded \`${model}\`\n\nModel is now in VRAM and ready to use.\n\nRun \`/ollama ps\` to see loaded models.`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "timeout") return `## \u23F3 Loading \`${model}\`\n\nStill loading into VRAM — large models take a moment.\n\nCheck with \`/ollama ps\`.`;
    return `## \u274C Load Failed\n\n\`${model}\`: ${msg}`;
  }
}

async function handleOllamaUnload(model: string): Promise<string> {
  if (!model) return "## Unload Model\n\n**Usage:** `/ollama unload <model>`\n\nRun `/ollama ps` to see loaded models.";

  try {
    const raw = await ollamaPost("/api/generate", { model, keep_alive: 0 });
    const result = JSON.parse(raw) as { error?: string };
    if (result.error) return `## \u274C Unload Failed\n\n\`${model}\`: ${result.error}`;
    return `## \u2705 Unloaded \`${model}\`\n\nModel has been released from VRAM.\n\nRun \`/ollama ps\` to verify.`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `## \u274C Unload Failed\n\n\`${model}\`: ${msg}`;
  }
}

async function handleOllamaRemove(model: string): Promise<string> {
  if (!model) return "## Remove Model\n\n**Usage:** `/ollama remove <model>`\n\nRun `/ollama list` to see installed models.";

  try {
    const raw = await ollamaDelete("/api/delete", { name: model });
    if (!raw || raw.trim() === "") return `## \u2705 Removed \`${model}\`\n\nRun \`/ollama list\` to see remaining models.`;
    const result = JSON.parse(raw) as { error?: string };
    if (result.error) return `## \u274C Remove Failed\n\n\`${model}\`: ${result.error}`;
    return `## \u2705 Removed \`${model}\``;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `## \u274C Remove Failed\n\n\`${model}\`: ${msg}`;
  }
}

/**
 * Handle TUI-only slash commands (e.g. /ollama) that use ctx.ui.custom()
 * and cannot render through RPC. Calls APIs directly and sends synthetic
 * assistant responses to the webview.
 */
export async function handleTuiOnlyFallback(
  ctx: CommandFallbackContext,
  _client: GsdRpcClient,
  webview: vscode.Webview,
  sessionId: string,
  originalCommand: string,
): Promise<void> {
  const trimmed = originalCommand.trim();
  const parts = trimmed.split(/\s+/);
  const command = parts[0]!.replace(/^\//, "").toLowerCase();

  try {
    let result: string;

    if (command === "ollama") {
      const subcommand = parts[1] || "status";
      const modelArg = parts.slice(2).join(" ");

      switch (subcommand) {
        case "status":
          result = await handleOllamaStatus();
          break;
        case "list":
        case "ls":
          result = await handleOllamaList();
          break;
        case "ps":
          result = await handleOllamaPs();
          break;
        case "pull":
          result = await handleOllamaPull(modelArg);
          break;
        case "load":
          result = await handleOllamaLoad(modelArg);
          break;
        case "unload":
          result = await handleOllamaUnload(modelArg);
          break;
        case "remove":
        case "rm":
        case "delete":
          result = await handleOllamaRemove(modelArg);
          break;
        default:
          result = [
            "## Ollama Commands\n",
            "| Command | Description |",
            "|---------|-------------|",
            "| `/ollama` | Server status, version, loaded & available models |",
            "| `/ollama list` | All installed models with size and details |",
            "| `/ollama ps` | Models loaded in VRAM with utilization |",
            "| `/ollama pull <model>` | Download a model |",
            "| `/ollama remove <model>` | Delete a model from disk |",
            "",
            "**Popular models:** `llama3.1:8b` \u00B7 `qwen2.5-coder:7b` \u00B7 `deepseek-r1:8b` \u00B7 `codestral:22b`",
          ].join("\n");
          break;
      }
    } else {
      result = `The \`/${command}\` command is only available in the terminal. Try describing what you want to do in plain text.`;
    }

    ctx.output.appendLine(`[${sessionId}] TUI-only fallback for "${originalCommand}" — direct API`);
    sendSyntheticResponse(ctx, webview, result);
  } catch (err: unknown) {
    ctx.output.appendLine(`[${sessionId}] TUI-only fallback failed: ${toErrorMessage(err)}`);
    ctx.postToWebview(webview, {
      type: "error",
      message: `The ${command} command couldn't complete. Try describing what you want to do in plain text.`,
    } as ExtensionToWebviewMessage);
  }
}

export async function handleOllamaAction(
  ctx: CommandFallbackContext,
  webview: vscode.Webview,
  sessionId: string,
  action: "load" | "unload" | "pull" | "remove",
  model: string,
): Promise<void> {
  ctx.output.appendLine(`[${sessionId}] Ollama action: ${action} ${model}`);
  try {
    let result: string;
    switch (action) {
      case "load":
        result = await handleOllamaLoad(model);
        break;
      case "unload":
        result = await handleOllamaUnload(model);
        break;
      case "pull":
        result = await handleOllamaPull(model);
        break;
      case "remove":
        result = await handleOllamaRemove(model);
        break;
    }
    sendSyntheticResponse(ctx, webview, result);
  } catch (err: unknown) {
    ctx.output.appendLine(`[${sessionId}] Ollama action failed: ${toErrorMessage(err)}`);
    ctx.postToWebview(webview, {
      type: "error",
      message: `Ollama ${action} failed for ${model}. Check the Output panel for details.`,
    } as ExtensionToWebviewMessage);
  }
}
