import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GsdRpcClient } from "./rpc-client";
import { listSessions, deleteSession } from "./session-list-service";
import { downloadAndInstallUpdate, dismissUpdateVersion, fetchReleaseNotes, fetchRecentReleases } from "./update-checker";
import { parseGsdWorkflowState } from "./state-parser";
import { buildDashboardData } from "./dashboard-parser";
import { loadMetricsLedger, buildMetricsData } from "./metrics-parser";
import { AutoProgressPoller } from "./auto-progress";
import { createSessionState, cleanupSessionState, type SessionState } from "./session-state";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  SessionStats,
  SessionListItem,
  RpcCommandsResult,
  RpcModelsResult,
  RpcThinkingResult,
  RpcStateResult,
  toGsdState,
  BashResult,
  AgentMessage,
} from "../shared/types";
import {
  startPromptWatchdog,
  clearPromptWatchdog,
  startSlashCommandWatchdog,
  startActivityMonitor,
  stopActivityMonitor,
  abortAndPrompt,
  type WatchdogContext,
} from "./watchdogs";
import {
  armGsdFallbackProbe,
  startGsdFallbackTimer,
  handleGsdAutoFallback,
  GSD_COMMAND_RE,
  GSD_NATIVE_SUBCOMMANDS,
  type CommandFallbackContext,
} from "./command-fallback";
import {
  handleRpcEvent,
  handleExtensionUiRequest,
  type RpcEventContext,
} from "./rpc-events";
import {
  handleOpenFile,
  handleOpenDiff,
  handleOpenUrl,
  handleExportHtml,
  handleSaveTempFile,
  handleCheckFileAccess,
  handleAttachFiles,
  handleCopyText,
  handleSetTheme,
  cleanStaleCrashLock,
  type FileOpsContext,
} from "./file-ops";

// ============================================================
// WebviewProvider — Manages one GSD session in a webview panel or sidebar
// ============================================================

export interface StatusBarUpdate {
  isStreaming: boolean;
  model?: string;
  cost?: number;
}

export class GsdWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gsd.sidebarView";

  private webviewView?: vscode.WebviewView;
  private sessions: Map<string, SessionState> = new Map();
  private promptWatchdogNonce = 0;
  private output: vscode.OutputChannel;
  private sessionCounter = 0;
  /** The session ID of the current sidebar, for reuse on re-resolve */
  private sidebarSessionId: string | null = null;
  private gsdVersion: string | undefined;
  private statusCallback?: (status: StatusBarUpdate) => void;
  private lastStatus: StatusBarUpdate = { isStreaming: false };
  private tempDir: string | null = null;

  /** Get or create session state for a session ID */
  private getSession(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = createSessionState();
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  // --- Context adapters for extracted modules ---

  private get watchdogCtx(): WatchdogContext {
    return {
      getSession: (id) => this.getSession(id),
      postToWebview: (wv, msg) => this.postToWebview(wv, msg),
      output: this.output,
      emitStatus: (update) => this.emitStatus(update),
      nextPromptWatchdogNonce: () => ++this.promptWatchdogNonce,
    };
  }

  private get commandFallbackCtx(): CommandFallbackContext {
    return {
      getSession: (id) => this.getSession(id),
      postToWebview: (wv, msg) => this.postToWebview(wv, msg),
      output: this.output,
    };
  }

  private get rpcEventCtx(): RpcEventContext {
    return {
      getSession: (id) => this.getSession(id),
      postToWebview: (wv, msg) => this.postToWebview(wv, msg),
      emitStatus: (update) => this.emitStatus(update),
      lastStatus: this.lastStatus,
      output: this.output,
      watchdogCtx: this.watchdogCtx,
      refreshWorkflowState: (wv, sid) => this.refreshWorkflowState(wv, sid),
      isWebviewVisible: (sid) => this.isWebviewVisible(sid),
      webviewView: this.webviewView,
    };
  }

  private get fileOpsCtx(): FileOpsContext {
    return {
      postToWebview: (wv, msg) => this.postToWebview(wv, msg),
      output: this.output,
      ensureTempDir: () => this.ensureTempDir(),
    };
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.output = vscode.window.createOutputChannel("Rokket GSD");
    this.gsdVersion = this.resolveGsdVersion();
  }

  private resolveGsdVersion(): string | undefined {
    try {
      // Try to find gsd-pi package.json near the gsd binary
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execSync } = require("child_process");
      const gsdPath = execSync(process.platform === "win32" ? "where gsd" : "which gsd", {
        encoding: "utf8",
        timeout: 5000,
      }).trim().split(/\r?\n/)[0];
      if (gsdPath) {
        // gsd binary is typically at <prefix>/gsd or <prefix>/node_modules/.bin/gsd
        // Walk up to find gsd-pi/package.json
        let dir = path.dirname(gsdPath);
        for (let i = 0; i < 4; i++) {
          const pkgPath = path.join(dir, "node_modules", "gsd-pi", "package.json");
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            return pkg.version;
          }
          dir = path.dirname(dir);
        }
      }
    } catch {
      // Ignore — version is nice-to-have
    }
    return undefined;
  }

  // --- Sidebar webview ---

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView;

    // Reuse the existing sidebar session if there's a live RPC client.
    // VS Code calls resolveWebviewView every time the sidebar becomes visible
    // after being hidden — creating a new session each time would orphan the
    // old GSD process and leave events bound to a stale webview reference.
    let sessionId: string;
    const existingClient = this.sidebarSessionId ? this.getSession(this.sidebarSessionId).client : null;
    if (this.sidebarSessionId && existingClient?.isRunning) {
      sessionId = this.sidebarSessionId;
      // Re-bind the client's event listener to the new webview reference
      existingClient.removeAllListeners("event");
      existingClient.on("event", (event: Record<string, unknown>) => {
        handleRpcEvent(this.rpcEventCtx, webviewView.webview, sessionId, event, existingClient);
      });
      this.getSession(sessionId).webview = webviewView.webview;
      this.output.appendLine(`[${sessionId}] Sidebar re-resolved — reusing existing session`);
    } else {
      // Clean up any stale sidebar session
      if (this.sidebarSessionId) {
        this.cleanupSession(this.sidebarSessionId);
      }
      sessionId = `sidebar-${++this.sessionCounter}`;
      this.sidebarSessionId = sessionId;
    }

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview, sessionId);
    this.setupWebviewMessageHandling(webviewView.webview, sessionId);
  }

  // --- Panel (tab) webview ---

  openInTab(): void {
    const sessionId = `panel-${++this.sessionCounter}`;

    const panel = vscode.window.createWebviewPanel(
      "gsdPanel",
      "Rokket GSD",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      }
    );

    this.getSession(sessionId).panel = panel;

    panel.webview.html = this.getWebviewHtml(panel.webview, sessionId);
    this.setupWebviewMessageHandling(panel.webview, sessionId);

    panel.onDidDispose(() => {
      this.getSession(sessionId).panel = null;
      this.cleanupSession(sessionId);
    });
  }

  // --- Focus ---

  focus(): void {
    if (this.webviewView) {
      this.webviewView.show(true);
    }
    this.broadcastToAll({ type: "config", useCtrlEnterToSend: this.getUseCtrlEnter(), theme: this.getTheme() } as ExtensionToWebviewMessage);
  }

  onConfigChanged(): void {
    this.broadcastToAll({ type: "config", useCtrlEnterToSend: this.getUseCtrlEnter(), theme: this.getTheme() } as ExtensionToWebviewMessage);
  }

  // --- New conversation ---

  async newConversation(): Promise<void> {
    for (const [, session] of this.sessions) {
      if (session.client?.isRunning) {
        try {
          await session.client.newSession();
        } catch (err) {
          this.output.appendLine(`Error creating new session: ${err}`);
        }
      }
    }
  }

  // --- Export report ---

  async exportReport(): Promise<void> {
    this.focus();
    for (const [, session] of this.sessions) {
      if (session.client?.isRunning) {
        try {
          await session.client.prompt("/gsd export --html --all");
        } catch (err) {
          this.output.appendLine(`Error exporting report: ${err}`);
          vscode.window.showErrorMessage("Failed to export milestone report.");
        }
        return;
      }
    }
    vscode.window.showInformationMessage("Start a GSD session first to export a milestone report.");
  }

  // --- Status bar ---

  onStatusUpdate(callback: (status: StatusBarUpdate) => void): void {
    this.statusCallback = callback;
  }

  private emitStatus(update: Partial<StatusBarUpdate>): void {
    this.lastStatus = { ...this.lastStatus, ...update };
    this.statusCallback?.(this.lastStatus);
  }

  /** Apply session-scoped cost floor to stats — prevents compaction from lowering reported cost */
  private applySessionCostFloor(sessionId: string, stats: { cost?: number } | null | undefined): void {
    if (!stats) return;
    const sessionCost = this.getSession(sessionId).accumulatedCost;
    if (sessionCost > (stats.cost || 0)) {
      stats.cost = sessionCost;
    }
  }

  // --- Cleanup ---

  dispose(): void {
    for (const [, session] of this.sessions) {
      cleanupSessionState(session);
      if (session.panel) {
        session.panel.dispose();
      }
    }
    this.sessions.clear();
    this.output.dispose();
    this.cleanupTempFiles();
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      cleanupSessionState(session);
    }
  }

  // --- What's New on first launch after update ---

  private static readonly LAST_VERSION_KEY = "gsd.lastSeenVersion";

  private async checkWhatsNew(webview: vscode.Webview): Promise<void> {
    const ext = vscode.extensions.getExtension("rokketek.rokket-gsd");
    const currentVersion = ext?.packageJSON?.version;
    if (!currentVersion) return;

    const lastVersion = this.context.globalState.get<string>(GsdWebviewProvider.LAST_VERSION_KEY);

    // Always update stored version
    await this.context.globalState.update(GsdWebviewProvider.LAST_VERSION_KEY, currentVersion);

    // Same version — skip
    if (lastVersion === currentVersion) return;

    // Version changed (or first launch with this feature) — fetch release notes
    try {
      const notes = await fetchReleaseNotes(currentVersion);
      if (notes) {
        this.postToWebview(webview, {
          type: "whats_new",
          version: currentVersion,
          notes,
        } as ExtensionToWebviewMessage);
      }
    } catch {
      // Best-effort — don't block launch
    }
  }

  // --- Temp file management ---

  private ensureTempDir(): string {
    if (!this.tempDir) {
      this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-attach-"));
      this.output.appendLine(`Temp dir created: ${this.tempDir}`);
    }
    return this.tempDir;
  }

  private cleanupTempFiles(): void {
    if (this.tempDir) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
        this.output.appendLine(`Temp dir cleaned: ${this.tempDir}`);
      } catch {
        // Best effort
      }
      this.tempDir = null;
    }
  }

  // --- Session stats polling ---

  private startStatsPolling(webview: vscode.Webview, sessionId: string): void {
    // Clear any existing timer
    const existing = this.getSession(sessionId).statsTimer;
    if (existing) clearInterval(existing);

    const poll = async () => {
      const client = this.getSession(sessionId).client;
      if (!client?.isRunning) return;
      try {
        const stats = await client.getSessionStats() as SessionStats | null;
        if (stats) {
          this.applySessionCostFloor(sessionId, stats);
          this.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
        }
      } catch {
        // Silently ignore — stats are best-effort
      }
    };

    // Poll every 5 seconds
    const timer = setInterval(poll, 5000);
    this.getSession(sessionId).statsTimer = timer;

    // Immediate first poll
    poll();
  }

  // --- Health Monitoring ---

  private startHealthMonitoring(webview: vscode.Webview, sessionId: string): void {
    // Clear any existing timer
    const existing = this.getSession(sessionId).healthTimer;
    if (existing) clearInterval(existing);

    this.getSession(sessionId).healthState = "responsive";

    const check = async () => {
      const client = this.getSession(sessionId).client;
      if (!client?.isRunning) return;

      // Only health-check while streaming (tool execution in progress)
      // During idle, the process is just waiting for input — no need to ping
      const isHealthy = await client.ping(10000);
      const previousState = this.getSession(sessionId).healthState || "responsive";

      if (!isHealthy && previousState === "responsive") {
        // Process became unresponsive
        this.getSession(sessionId).healthState = "unresponsive";
        this.output.appendLine(`[${sessionId}] Health check: UNRESPONSIVE (ping timed out)`);
        this.postToWebview(webview, { type: "process_health", status: "unresponsive" } as ExtensionToWebviewMessage);
      } else if (isHealthy && previousState === "unresponsive") {
        // Process recovered
        this.getSession(sessionId).healthState = "recovered";
        this.output.appendLine(`[${sessionId}] Health check: recovered`);
        this.postToWebview(webview, { type: "process_health", status: "recovered" } as ExtensionToWebviewMessage);
        // Reset to responsive after emitting recovered
        this.getSession(sessionId).healthState = "responsive";
      }
    };

    // Check every 30 seconds
    const timer = setInterval(check, 30000);
    this.getSession(sessionId).healthTimer = timer;
  }

  // --- Workflow state ---

  private async refreshWorkflowState(webview: vscode.Webview, sessionId: string): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const state = await parseGsdWorkflowState(cwd);
    if (state) {
      state.autoMode = this.getSession(sessionId).autoModeState || null;
    }
    this.postToWebview(webview, { type: "workflow_state", state } as ExtensionToWebviewMessage);
  }

  private startWorkflowPolling(webview: vscode.Webview, sessionId: string): void {
    const existing = this.getSession(sessionId).workflowTimer;
    if (existing) clearInterval(existing);

    // Initial refresh
    this.refreshWorkflowState(webview, sessionId);

    // Poll every 30 seconds
    const timer = setInterval(() => this.refreshWorkflowState(webview, sessionId), 30000);
    this.getSession(sessionId).workflowTimer = timer;
  }

  // --- Message handling ---

  private setupWebviewMessageHandling(webview: vscode.Webview, sessionId: string): void {
    this.getSession(sessionId).webview = webview;

    // Dispose previous handler for this session to prevent duplicate message processing
    const prevDisposable = this.getSession(sessionId).messageHandlerDisposable;
    if (prevDisposable) {
      prevDisposable.dispose();
    }

    const disposable = webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      try {
      this.output.appendLine(`[${sessionId}] Webview -> Extension: ${msg.type}`);

      switch (msg.type) {
        case "ready": {
          const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
          const extVersion = vscode.extensions.getExtension("rokketek.rokket-gsd")?.packageJSON?.version;
          this.postToWebview(webview, {
            type: "config",
            useCtrlEnterToSend: this.getUseCtrlEnter(),
            theme: this.getTheme(),
            cwd,
            version: this.gsdVersion,
            extensionVersion: extVersion,
          });

          // Check if this is a first launch after an update — show "What's New"
          this.checkWhatsNew(webview).catch(() => {});
          break;
        }

        case "launch_gsd": {
          // Guard: don't launch a second process if one already exists for this session
          const existingLaunch = this.getSession(sessionId).client;
          if (existingLaunch?.isRunning) {
            this.output.appendLine(`[${sessionId}] launch_gsd: process already running (PID ${existingLaunch.pid}) — skipping`);
            // Re-push state so the webview knows it's running
            this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
            try {
              const rpcState = await existingLaunch.getState();
              this.postToWebview(webview, { type: "state", data: toGsdState(rpcState as RpcStateResult) } as ExtensionToWebviewMessage);
            } catch { /* best effort */ }
          } else {
            await this.launchGsd(webview, sessionId, msg.cwd);
          }
          break;
        }

        case "prompt": {
          const client = this.getSession(sessionId).client;

          if (!client?.isRunning) {
            if (client && !client.isRunning) {
              this.output.appendLine(`[${sessionId}] GSD process not running — restarting...`);
              this.postToWebview(webview, { type: "process_status", status: "restarting" } as ExtensionToWebviewMessage);
              try {
                const restarted = await client.restart();
                if (restarted) {
                  this.output.appendLine(`[${sessionId}] GSD restarted successfully`);
                  try {
                    const state = await client.getState();
                    this.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
                    this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
                    // Re-fetch commands after restart
                    const cmdResult = await client.getCommands() as RpcCommandsResult;
                    this.postToWebview(webview, { type: "commands", commands: cmdResult?.commands || [] });
                  } catch { /* ignored */ }
                } else {
                  this.getSession(sessionId).client = null;
                  await this.launchGsd(webview, sessionId);
                }
              } catch (restartErr: any) {
                this.output.appendLine(`[${sessionId}] Restart failed: ${restartErr.message}`);
                this.getSession(sessionId).client = null;
                await this.launchGsd(webview, sessionId);
              }
            } else {
              await this.launchGsd(webview, sessionId);
            }
          }

          const c = this.getSession(sessionId).client;
          if (c?.isRunning) {
            try {
              const images = msg.images?.map((img) => ({
                type: "image" as const,
                data: img.data,
                mimeType: img.mimeType,
              }));
              // Start watchdog BEFORE awaiting prompt — if pi never acks the
              // RPC the await hangs forever and the watchdog would never start.
              if (msg.message.startsWith("/")) {
                startSlashCommandWatchdog(this.watchdogCtx, webview, sessionId, msg.message, images);
              } else {
                startPromptWatchdog(this.watchdogCtx, webview, sessionId, msg.message, images);
              }
              this.output.appendLine(`[${sessionId}] Sending prompt to RPC: "${msg.message.slice(0, 80)}"`);
              armGsdFallbackProbe(this.commandFallbackCtx, msg.message.trim(), sessionId, webview);
              this.getSession(sessionId).lastUserActionTime = Date.now();

              await c.prompt(msg.message, images);
              this.output.appendLine(`[${sessionId}] Prompt RPC resolved for: "${msg.message.slice(0, 80)}"`);
              startGsdFallbackTimer(this.commandFallbackCtx, msg.message.trim(), sessionId, webview);
            } catch (err: any) {
              if (err.message?.includes("streaming")) {
                const isSlash = msg.message.trimStart().startsWith("/");
                try {
                  const imgs = msg.images?.map((img) => ({
                    type: "image" as const,
                    data: img.data,
                    mimeType: img.mimeType,
                  }));
                  if (isSlash) {
                    startSlashCommandWatchdog(this.watchdogCtx, webview, sessionId, msg.message, imgs);
                    armGsdFallbackProbe(this.commandFallbackCtx, msg.message.trim(), sessionId, webview);
                    await abortAndPrompt(this.watchdogCtx, c, webview, msg.message, msg.images);
                    startGsdFallbackTimer(this.commandFallbackCtx, msg.message.trim(), sessionId, webview);
                  } else {
                    await c.steer(msg.message, imgs);
                  }
                } catch (steerErr: any) {
                  this.postToWebview(webview, { type: "error", message: steerErr.message });
                }
              } else if (err.message?.includes("process exited")) {
                this.postToWebview(webview, {
                  type: "error",
                  message: "GSD process exited unexpectedly. Try sending your message again to auto-restart.",
                });
              } else {
                this.postToWebview(webview, { type: "error", message: err.message });
              }
            }
          } else {
            this.postToWebview(webview, {
              type: "error",
              message: "Failed to start GSD. Check the Output panel (GSD) for details.",
            });
          }
          break;
        }

        case "steer": {
          const client = this.getSession(sessionId).client;
          if (client) {
            this.getSession(sessionId).lastUserActionTime = Date.now();
            try {
              // Extension commands (slash commands) can't be steered — they need to run
              // as prompts. Abort the current stream first, then send as a prompt.
              if (msg.message.startsWith("/")) {
                await abortAndPrompt(this.watchdogCtx, client, webview, msg.message, msg.images);
              } else {
                await client.steer(msg.message, msg.images?.map((img) => ({
                  type: "image" as const,
                  data: img.data,
                  mimeType: img.mimeType,
                })));
              }
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "follow_up": {
          const client = this.getSession(sessionId).client;
          if (client) {
            this.getSession(sessionId).lastUserActionTime = Date.now();
            try {
              await client.followUp(msg.message, msg.images?.map((img) => ({
                type: "image" as const,
                data: img.data,
                mimeType: img.mimeType,
              })));
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "interrupt":
        case "cancel_request": {
          const client = this.getSession(sessionId).client;
          if (client) {
            try {
              await client.abort();
            } catch (err: any) {
              this.output.appendLine(`[${sessionId}] Interrupt/abort failed: ${err.message}`);
              // If abort fails, force-clear streaming state on the webview side
              // so the user isn't stuck
              this.getSession(sessionId).isStreaming = false;
              stopActivityMonitor(this.watchdogCtx, sessionId);
              this.emitStatus({ isStreaming: false });
              // Notify webview so its state is consistent
              const wv = this.getSession(sessionId).webview;
              if (wv) {
                this.postToWebview(wv, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
              }
            }
          }
          break;
        }

        case "new_conversation": {
          this.cleanupTempFiles();
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.newSession();
              this.getSession(sessionId).accumulatedCost = 0;
              this.emitStatus({ cost: 0 });
              const state = await client.getState();
              this.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_model": {
          const client = this.getSession(sessionId).client;
          if (client) {
            try {
              await client.setModel(msg.provider, msg.modelId);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_thinking_level": {
          const client = this.getSession(sessionId).client;
          if (client) {
            try {
              await client.setThinkingLevel(msg.level);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "get_dashboard": {
          const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
          try {
            const data = await buildDashboardData(cwd);
            // Merge session stats if available
            if (data) {
              const client = this.getSession(sessionId).client;
              if (client?.isRunning) {
                try {
                  const statsResult = await client.getSessionStats() as Record<string, unknown> | null;
                  if (statsResult) {
                    data.stats = {
                      cost: statsResult.cost as number | undefined,
                      tokens: statsResult.tokens as { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | undefined,
                      toolCalls: statsResult.toolCalls as number | undefined,
                      userMessages: statsResult.userMessages as number | undefined,
                    };
                    this.applySessionCostFloor(sessionId, data.stats);
                  }
                } catch {
                  // Stats not available — that's fine
                }
              }
            }
            // Merge metrics data if available
            if (data) {
              try {
                const ledger = loadMetricsLedger(cwd);
                if (ledger && ledger.units.length > 0) {
                  // Count remaining slices from roadmap
                  const remainingSlices = data.slices.filter(s => !s.done).length;
                  data.metrics = buildMetricsData(ledger, remainingSlices);
                }
              } catch {
                // Metrics not available — that's fine
              }
            }
            this.postToWebview(webview, { type: "dashboard_data", data } as ExtensionToWebviewMessage);
          } catch (_err: unknown) {
            this.postToWebview(webview, { type: "dashboard_data", data: null } as ExtensionToWebviewMessage);
          }
          break;
        }

        case "get_changelog": {
          this.output.appendLine(`[${sessionId}] Fetching changelog...`);
          try {
            const entries = await fetchRecentReleases(15);
            this.output.appendLine(`[${sessionId}] Changelog fetched: ${entries.length} entries`);
            this.postToWebview(webview, { type: "changelog", entries } as ExtensionToWebviewMessage);
          } catch (err: any) {
            this.output.appendLine(`[${sessionId}] Changelog fetch error: ${err?.message}`);
            this.postToWebview(webview, { type: "changelog", entries: [] } as ExtensionToWebviewMessage);
          }
          break;
        }

        case "get_state": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const state = await client.getState();
              this.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "get_session_stats": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const stats = await client.getSessionStats() as SessionStats | null;
              if (stats) {
                this.applySessionCostFloor(sessionId, stats);
                this.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
              }
            } catch { /* ignored */ }
          }
          break;
        }

        case "get_commands": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.getCommands() as RpcCommandsResult;
              this.postToWebview(webview, { type: "commands", commands: result?.commands || [] });
            } catch (err: any) {
              this.output.appendLine(`[${sessionId}] get_commands error: ${err.message}`);
              // Send empty commands so the webview at least marks commandsLoaded
              // and doesn't keep retrying on every keystroke
              this.postToWebview(webview, { type: "commands", commands: [] });
            }
          } else {
            // Process not running yet — queue a retry after a short delay.
            // This handles the race where the webview requests commands before
            // the GSD process has fully started.
            this.output.appendLine(`[${sessionId}] get_commands: client not running, will retry in 2s`);
            setTimeout(async () => {
              const retryClient = this.getSession(sessionId).client;
              if (retryClient?.isRunning) {
                try {
                  const result = await retryClient.getCommands() as RpcCommandsResult;
                  this.postToWebview(webview, { type: "commands", commands: result?.commands || [] });
                } catch (err: any) {
                  this.output.appendLine(`[${sessionId}] get_commands retry error: ${err.message}`);
                  this.postToWebview(webview, { type: "commands", commands: [] });
                }
              }
            }, 2000);
          }
          break;
        }

        case "get_available_models": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.getAvailableModels() as RpcModelsResult;
              this.postToWebview(webview, { type: "available_models", models: result?.models || [] });
            } catch (err: any) {
              this.output.appendLine(`[${sessionId}] get_available_models error: ${err.message}`);
            }
          }
          break;
        }

        case "cycle_thinking_level": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.cycleThinkingLevel() as RpcThinkingResult;
              if (result?.level) {
                this.postToWebview(webview, { type: "thinking_level_changed", level: result.level });
              }
              // Refresh full state
              const state = await client.getState();
              this.postToWebview(webview, { type: "state", data: state } as ExtensionToWebviewMessage);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "compact_context": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              this.postToWebview(webview, { type: "auto_compaction_start", reason: "manual" } as ExtensionToWebviewMessage);
              await client.compact();
              this.postToWebview(webview, { type: "auto_compaction_end", result: {}, aborted: false } as ExtensionToWebviewMessage);
              // Refresh stats
              const stats = await client.getSessionStats() as SessionStats | null;
              if (stats) {
                this.applySessionCostFloor(sessionId, stats);
                this.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
              }
            } catch (err: any) {
              this.postToWebview(webview, { type: "auto_compaction_end", result: {}, aborted: true } as ExtensionToWebviewMessage);
              this.postToWebview(webview, { type: "error", message: `Compact failed: ${err.message}` });
            }
          }
          break;
        }

        case "export_html": {
          await handleExportHtml(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "run_bash": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.executeBash(msg.command) as BashResult;
              this.postToWebview(webview, { type: "bash_result", result });
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: `Bash error: ${err.message}` });
            }
          }
          break;
        }

        case "fork_conversation": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.fork(msg.entryId);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "get_session_list": {
          const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
          try {
            const sessions = await listSessions(cwd);
            const items: SessionListItem[] = sessions.map((s) => ({
              path: s.path,
              id: s.id,
              name: s.name,
              firstMessage: s.firstMessage,
              created: s.created.toISOString(),
              modified: s.modified.toISOString(),
              messageCount: s.messageCount,
            }));
            this.output.appendLine(`[${sessionId}] Listed ${items.length} sessions`);
            this.postToWebview(webview, { type: "session_list", sessions: items });
          } catch (err: any) {
            this.output.appendLine(`[${sessionId}] Session list error: ${err.message}`);
            this.postToWebview(webview, { type: "session_list_error", message: err.message });
          }
          break;
        }

        case "switch_session": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              const result = await client.switchSession(msg.path) as { cancelled?: boolean } | null;
              if (result?.cancelled) {
                this.output.appendLine(`[${sessionId}] Session switch cancelled`);
                break;
              }
              this.getSession(sessionId).accumulatedCost = 0;
              this.emitStatus({ cost: 0 });
              // Get the new state and messages after switch
              const state = await client.getState() as RpcStateResult;
              const messagesResult = await client.getMessages() as { messages?: AgentMessage[] } | null;
              this.output.appendLine(`[${sessionId}] Switched session, ${messagesResult?.messages?.length || 0} messages`);
              const gsdState = {
                model: state?.model || null,
                thinkingLevel: (state?.thinkingLevel || "off") as import("../shared/types").ThinkingLevel,
                isStreaming: state?.isStreaming || false,
                isCompacting: state?.isCompacting || false,
                sessionFile: (state?.sessionFile as string) || null,
                sessionId: (state?.sessionId as string) || null,
                messageCount: (state?.messageCount as number) || 0,
                autoCompactionEnabled: state?.autoCompactionEnabled || false,
              };
              this.postToWebview(webview, {
                type: "session_switched",
                state: gsdState,
                messages: messagesResult?.messages || [],
              });
              // Update status bar
              if (state?.model) {
                this.emitStatus({ model: (state.model as any).id || (state.model as any).name });
              }
            } catch (err: any) {
              this.output.appendLine(`[${sessionId}] Session switch error: ${err.message}`);
              this.postToWebview(webview, { type: "error", message: `Failed to switch session: ${err.message}` });
            }
          }
          break;
        }

        case "rename_session": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setSessionName(msg.name);
              this.output.appendLine(`[${sessionId}] Session renamed to: ${msg.name}`);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: `Failed to rename session: ${err.message}` });
            }
          }
          break;
        }

        case "delete_session": {
          try {
            await deleteSession(msg.path);
            this.output.appendLine(`[${sessionId}] Deleted session: ${msg.path}`);
            // Refresh the session list
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const sessions = await listSessions(cwd);
            const items: SessionListItem[] = sessions.map((s) => ({
              path: s.path,
              id: s.id,
              name: s.name,
              firstMessage: s.firstMessage,
              created: s.created.toISOString(),
              modified: s.modified.toISOString(),
              messageCount: s.messageCount,
            }));
            this.postToWebview(webview, { type: "session_list", sessions: items });
          } catch (err: any) {
            this.output.appendLine(`[${sessionId}] Delete session error: ${err.message}`);
            this.postToWebview(webview, { type: "error", message: `Failed to delete session: ${err.message}` });
          }
          break;
        }

        case "set_auto_compaction": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setAutoCompaction(msg.enabled);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_steering_mode": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setSteeringMode(msg.mode);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "set_follow_up_mode": {
          const client = this.getSession(sessionId).client;
          if (client?.isRunning) {
            try {
              await client.setFollowUpMode(msg.mode);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "resume_last_session": {
          const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!cwd) {
            this.postToWebview(webview, { type: "error", message: "No workspace folder open" });
            break;
          }
          try {
            const sessions = await listSessions(cwd);
            if (sessions.length === 0) {
              this.postToWebview(webview, { type: "error", message: "No previous sessions found" });
              break;
            }
            // Sessions are sorted most-recent first
            const latest = sessions[0];
            const client = this.getSession(sessionId).client;
            if (client?.isRunning) {
              const result = await client.switchSession(latest.path) as { cancelled?: boolean } | null;
              if (result?.cancelled) {
                this.output.appendLine(`[${sessionId}] Resume cancelled`);
                break;
              }
              this.getSession(sessionId).accumulatedCost = 0;
              this.emitStatus({ cost: 0 });
              const state = await client.getState() as RpcStateResult;
              const messagesResult = await client.getMessages() as { messages?: AgentMessage[] } | null;
              this.output.appendLine(`[${sessionId}] Resumed last session: ${latest.name || latest.id} (${messagesResult?.messages?.length || 0} messages)`);
              const gsdState = {
                model: state?.model || null,
                thinkingLevel: (state?.thinkingLevel || "off") as import("../shared/types").ThinkingLevel,
                isStreaming: state?.isStreaming || false,
                isCompacting: state?.isCompacting || false,
                sessionFile: (state?.sessionFile as string) || null,
                sessionId: (state?.sessionId as string) || null,
                messageCount: (state?.messageCount as number) || 0,
                autoCompactionEnabled: state?.autoCompactionEnabled || false,
              };
              this.postToWebview(webview, {
                type: "session_switched",
                state: gsdState,
                messages: messagesResult?.messages || [],
              });
              if (state?.model) {
                this.emitStatus({ model: (state.model as any).id || (state.model as any).name });
              }
            }
          } catch (err: any) {
            this.output.appendLine(`[${sessionId}] Resume error: ${err.message}`);
            this.postToWebview(webview, { type: "error", message: `Failed to resume: ${err.message}` });
          }
          break;
        }

        case "force_kill": {
          const client = this.getSession(sessionId).client;
          if (client) {
            this.output.appendLine(`[${sessionId}] Force-killing GSD process (PID: ${client.pid})`);
            client.forceKill();
          }
          break;
        }

        case "force_restart": {
          if (this.getSession(sessionId).isRestarting) {
            this.output.appendLine(`[${sessionId}] Force-restart already in progress — ignoring`);
            break;
          }
          const client = this.getSession(sessionId).client;
          if (client) {
            this.getSession(sessionId).isRestarting = true;
            this.output.appendLine(`[${sessionId}] Force-restarting GSD process`);
            client.forceKill();
            // Clean up existing timers before restart
            this.cleanupSession(sessionId);
            // Wait a moment for cleanup, then re-launch from scratch
            setTimeout(async () => {
              try {
                this.getSession(sessionId).client = null;
                await this.launchGsd(webview, sessionId);
                this.output.appendLine(`[${sessionId}] GSD re-launched after force-kill`);
              } catch (err: any) {
                this.output.appendLine(`[${sessionId}] Force-restart failed: ${err.message}`);
                this.postToWebview(webview, { type: "error", message: `[GSD-ERR-030] Force-restart failed: ${err.message}` });
              } finally {
                this.getSession(sessionId).isRestarting = false;
              }
            }, 1000);
          }
          break;
        }

        case "update_install": {
          // Security: only allow downloads from GitHub API
          const dlUrl = String(msg.downloadUrl || "");
          if (!dlUrl.startsWith("https://api.github.com/") && !dlUrl.startsWith("https://github.com/")) {
            this.output.appendLine(`[${sessionId}] Blocked update download from untrusted URL: ${dlUrl}`);
            this.postToWebview(webview, { type: "error", message: "Update blocked: download URL is not from GitHub." });
            break;
          }
          await downloadAndInstallUpdate(dlUrl, this.context);
          break;
        }

        case "update_dismiss": {
          await dismissUpdateVersion(msg.version, this.context);
          break;
        }

        case "update_view_release": {
          const releaseUrl = String(msg.htmlUrl || "");
          if (/^https?:\/\//i.test(releaseUrl)) {
            vscode.env.openExternal(vscode.Uri.parse(releaseUrl));
          }
          break;
        }

        case "extension_ui_response": {
          const client = this.getSession(sessionId).client;
          if (client) {
            client.sendExtensionUiResponse({
              type: "extension_ui_response",
              id: msg.id,
              value: msg.value,
              values: msg.values,
              confirmed: msg.confirmed,
              cancelled: msg.cancelled,
            });
          }
          break;
        }

        case "check_file_access": {
          await handleCheckFileAccess(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "save_temp_file": {
          handleSaveTempFile(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "attach_files": {
          await handleAttachFiles(this.fileOpsCtx, webview, sessionId);
          break;
        }

        case "copy_text": {
          await handleCopyText(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "set_theme": {
          await handleSetTheme(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "open_file": {
          handleOpenFile(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "open_url": {
          handleOpenUrl(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }

        case "open_diff": {
          handleOpenDiff(this.fileOpsCtx, webview, sessionId, msg as any);
          break;
        }
      }

      } catch (err: any) {
        const errorId = `ERR-${Date.now().toString(36)}`;
        this.output.appendLine(`[${sessionId}] [${errorId}] Unhandled error in message handler for "${msg.type}": ${err.message}`);
        this.output.appendLine(`[${sessionId}] [${errorId}] Stack: ${err.stack || "no stack"}`);
        this.postToWebview(webview, {
          type: "error",
          message: `[${errorId}] Internal error processing "${msg.type}". Check Output panel (Rokket GSD) for details.`,
        });
      }
    });

    this.getSession(sessionId).messageHandlerDisposable = disposable;
  }

  // --- GSD Process Management ---

  private launchGsd(webview: vscode.Webview, sessionId: string, cwd?: string): Promise<void> {
    // Deduplicate concurrent launches for the same session — if a launch is
    // already in progress (e.g. webview sent launch_gsd and then an immediate
    // prompt), piggyback on the existing promise instead of spawning a second process.
    const existing = this.getSession(sessionId).launchPromise;
    if (existing) return existing;

    const promise = this._doLaunchGsd(webview, sessionId, cwd).finally(() => {
      this.getSession(sessionId).launchPromise = null;
    });
    this.getSession(sessionId).launchPromise = promise;
    return promise;
  }

  private async _doLaunchGsd(webview: vscode.Webview, sessionId: string, cwd?: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workingDir = cwd || workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    const config = vscode.workspace.getConfiguration("gsd");
    const processWrapper = config.get<string>("processWrapper", "");
    const envVars = config.get<Array<{ name: string; value: string }>>("environmentVariables", []);

    const env: Record<string, string> = {};
    for (const { name, value } of envVars) {
      env[name] = value;
    }

    // Notify webview that we're starting
    this.postToWebview(webview, { type: "process_status", status: "starting" } as ExtensionToWebviewMessage);

    const client = new GsdRpcClient();

    client.on("event", (event: Record<string, unknown>) => {
      handleRpcEvent(this.rpcEventCtx, webview, sessionId, event, client);
    });

    client.on("log", (text: string) => {
      this.output.appendLine(`[${sessionId}] stderr: ${text}`);
    });

    client.on("exit", ({ code, signal, detail }: { code: number | null; signal: string | null; detail?: string }) => {
      this.output.appendLine(`[${sessionId}] Process exited: ${detail || `code=${code}, signal=${signal}`}`);
      this.postToWebview(webview, { type: "process_exit", code, signal, detail });
      // Clean exit (code 0 or SIGTERM/SIGKILL) → stopped; anything else → crashed
      const isCleanExit = code === 0 || signal === "SIGTERM" || signal === "SIGKILL";
      this.postToWebview(webview, { type: "process_status", status: isCleanExit ? "stopped" : "crashed" } as ExtensionToWebviewMessage);

      // Stop all monitoring timers and watchdogs
      const timer = this.getSession(sessionId).statsTimer;
      if (timer) {
        clearInterval(timer);
        this.getSession(sessionId).statsTimer = null;
      }
      const healthTimer = this.getSession(sessionId).healthTimer;
      if (healthTimer) {
        clearInterval(healthTimer);
        this.getSession(sessionId).healthTimer = null;
      }
      this.getSession(sessionId).healthState = "responsive";
      const workflowTimer = this.getSession(sessionId).workflowTimer;
      if (workflowTimer) {
        clearInterval(workflowTimer);
        this.getSession(sessionId).workflowTimer = null;
      }
      this.getSession(sessionId).autoModeState = null;
      stopActivityMonitor(this.watchdogCtx, sessionId);
      this.getSession(sessionId).isStreaming = false;
      clearPromptWatchdog(this.watchdogCtx, sessionId);
      const slashWd = this.getSession(sessionId).slashWatchdog;
      if (slashWd) {
        clearTimeout(slashWd);
        this.getSession(sessionId).slashWatchdog = null;
      }
      this.getSession(sessionId).lastEventTime = 0;
      const gsdTimer = this.getSession(sessionId).gsdFallbackTimer;
      if (gsdTimer) {
        clearTimeout(gsdTimer);
        this.getSession(sessionId).gsdFallbackTimer = null;
      }
      this.getSession(sessionId).gsdTurnStarted = false;

      if (isCleanExit) {
        this.getSession(sessionId).client = null;
      } else {
        this.output.appendLine(`[${sessionId}] Unexpected exit — will auto-restart on next prompt`);
      }
    });

    client.on("error", (err: Error) => {
      this.output.appendLine(`[${sessionId}] Process error: ${err.message}`);
      this.postToWebview(webview, {
        type: "process_exit",
        code: null,
        signal: null,
        detail: `Failed to start GSD: ${err.message}`,
      });
      this.postToWebview(webview, { type: "process_status", status: "crashed" } as ExtensionToWebviewMessage);
    });

    try {
      await client.start({
        cwd: workingDir,
        gsdPath: processWrapper || undefined,
        env,
      });

      this.getSession(sessionId).client = client;
      this.output.appendLine(`[${sessionId}] GSD started in ${workingDir}`);

      // Create auto-progress poller for this session
      const autoPoller = new AutoProgressPoller(
        sessionId,
        client,
        webview,
        () => workingDir,
        this.output,
        (oldModel, newModel) => {
          // Forward model routing changes to webview
          this.postToWebview(webview, {
            type: "model_routed",
            oldModel,
            newModel,
          } as ExtensionToWebviewMessage);
        },
      );
      this.getSession(sessionId).autoProgressPoller = autoPoller;

      // Get initial state — this blocks until the process is actually ready
      // (extensions loaded, input handler attached). Only then do we announce "running".
      try {
        const rpcState = await client.getState() as RpcStateResult;
        this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
        this.postToWebview(webview, { type: "state", data: toGsdState(rpcState) } as ExtensionToWebviewMessage);
        if (rpcState?.model) {
          this.emitStatus({ model: rpcState.model.id || rpcState.model.name });
        }
      } catch (err: any) {
        // Process started but isn't responding — still announce running
        // so the webview can at least try to interact
        this.output.appendLine(`[${sessionId}] Initial getState failed: ${err.message}`);
        this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
      }

      // Eagerly fetch commands now that the process is ready, and push them
      // to the webview. This avoids the race where the webview requests commands
      // before extensions have loaded.
      try {
        const cmdResult = await client.getCommands() as RpcCommandsResult;
        this.postToWebview(webview, { type: "commands", commands: cmdResult?.commands || [] });
      } catch (err: any) {
        this.output.appendLine(`[${sessionId}] Initial get_commands failed: ${err.message}`);
      }

      // Start stats polling, health monitoring, and workflow state
      this.startStatsPolling(webview, sessionId);
      this.startHealthMonitoring(webview, sessionId);
      this.startWorkflowPolling(webview, sessionId);
    } catch (err: any) {
      this.postToWebview(webview, {
        type: "process_exit",
        code: null,
        signal: null,
        detail: `Failed to start GSD: ${err.message}. Make sure 'gsd' is installed and in your PATH.`,
      });
      this.postToWebview(webview, { type: "process_status", status: "crashed" } as ExtensionToWebviewMessage);
    }
  }


  // --- Helpers ---

  private postToWebview(webview: vscode.Webview, message: ExtensionToWebviewMessage | Record<string, unknown>): void {
    webview.postMessage(message);
  }

  /**
   * Public broadcast — used by update checker and health check
   * to push messages to all webview instances.
   * Returns true if the message was delivered to at least one webview.
   */
  public broadcast(message: ExtensionToWebviewMessage): boolean {
    return this.broadcastToAll(message);
  }

  private broadcastToAll(message: ExtensionToWebviewMessage): boolean {
    let delivered = false;
    if (this.webviewView) {
      this.webviewView.webview.postMessage(message);
      delivered = true;
    }
    for (const [, session] of this.sessions) {
      if (session.panel) {
        session.panel.webview.postMessage(message);
        delivered = true;
      }
    }
    return delivered;
  }

  /**
   * Check if the webview for a session is currently visible to the user.
   * Used to avoid spamming native notifications when they're already looking at GSD.
   */
  private isWebviewVisible(sessionId: string): boolean {
    // Check sidebar visibility
    if (this.webviewView?.visible) return true;
    // Check panel visibility
    const panel = this.getSession(sessionId).panel;
    if (panel?.visible) return true;
    return false;
  }

  private getUseCtrlEnter(): boolean {
    return vscode.workspace.getConfiguration("gsd").get<boolean>("useCtrlEnterToSend", false);
  }

  private getTheme(): string {
    return vscode.workspace.getConfiguration("gsd").get<string>("theme", "forge");
  }

  // --- Webview HTML ---

  getWebviewHtml(webview: vscode.Webview, sessionId: string): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.css")
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Rokket GSD</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.GSD_SESSION_ID = ${JSON.stringify(sessionId)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return nonce;
}
