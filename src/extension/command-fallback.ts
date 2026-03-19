/**
 * GSD command fallback logic — handles the workaround for /gsd commands
 * that don't trigger an agent turn via RPC (interactive wizard limitation).
 *
 * Extracted from webview-provider.ts (S01/T03).
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { GsdRpcClient } from "./rpc-client";
import type { SessionState } from "./session-state";
import type { ExtensionToWebviewMessage } from "../shared/types";

// ── Regexes ─────────────────────────────────────────────────────────────

/** Matches `/gsd` with optional recognised subcommand. */
export const GSD_COMMAND_RE =
  /^\/gsd(?:\s+(auto|next|stop|status|queue|quick|mode|help|forensics|doctor|discuss|visualize|capture|steer|knowledge|config|prefs|migrate|remote|do|note))?(?:\s|$)/;

/**
 * Subcommands that work natively in RPC mode (auto, stop, pause, next,
 * status, steer, remote, prefs, parallel) — they don't need fallbacks.
 */
export const GSD_NATIVE_SUBCOMMANDS =
  /^\s*\/gsd\s+(auto|stop|pause|next|status|steer|remote|prefs|parallel)\b/i;

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
  }, 500);
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
        stateContent = fs.readFileSync(statePath, "utf8");
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
  } catch (err: any) {
    ctx.output.appendLine(`[${sessionId}] GSD auto fallback failed: ${err.message}`);
    ctx.postToWebview(webview, {
      type: "error",
      message: `The /gsd command couldn't complete. Try sending a plain text message describing what you want to do instead.`,
    } as ExtensionToWebviewMessage);
  }
}
