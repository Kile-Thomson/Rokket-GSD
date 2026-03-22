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
  /^\/gsd(?:\s+(auto|next|stop|pause|status|queue|quick|mode|help|forensics|doctor|discuss|visualize|capture|steer|knowledge|config|prefs|migrate|remote|changelog|triage|dispatch|history|undo|skip|cleanup|hooks|run-hook|skill-health|init|setup|inspect|new-milestone|parallel|park|unpark|start|templates|extensions|export|keys|logs|rate))?(?:\s|$)/;

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
  } catch (err: any) {
    ctx.output.appendLine(`[${sessionId}] GSD auto fallback failed: ${err.message}`);
    ctx.postToWebview(webview, {
      type: "error",
      message: `The /gsd command couldn't complete. Try sending a plain text message describing what you want to do instead.`,
    } as ExtensionToWebviewMessage);
  }
}
