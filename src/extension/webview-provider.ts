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
  BashResult,
  AgentMessage,
} from "../shared/types";

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
  private static readonly GSD_COMMAND_RE = /^\/gsd(?:\s+(auto|next|stop|status|queue|quick|mode|help|forensics|doctor|discuss|visualize|capture|steer|knowledge|config|prefs|migrate|remote|do|note))?(?:\s|$)/;
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
        this.handleRpcEvent(webviewView.webview, sessionId, event, existingClient);
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

  /**
   * Start a watchdog timer after a prompt is acked by pi.
   * If no agent_start event arrives within the timeout, retry once then error.
   */
  private startPromptWatchdog(
    webview: vscode.Webview,
    sessionId: string,
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>
  ): void {
    this.clearPromptWatchdog(sessionId);

    const WATCHDOG_TIMEOUT_MS = 8000;
    const nonce = ++this.promptWatchdogNonce;

    const timer = setTimeout(async () => {
      const watchdog = this.getSession(sessionId).promptWatchdog;
      // Stale callback — a newer watchdog has replaced this one
      if (!watchdog || watchdog.nonce !== nonce) return;

      const client = this.getSession(sessionId).client;
      if (!client?.isRunning) {
        this.clearPromptWatchdog(sessionId);
        return;
      }

      if (!watchdog.retried) {
        // First timeout — retry the prompt once
        this.output.appendLine(`[${sessionId}] Prompt watchdog: no agent_start after ${WATCHDOG_TIMEOUT_MS / 1000}s — retrying prompt`);
        watchdog.retried = true;

        try {
          // Start the final-chance watchdog BEFORE awaiting — if prompt()
          // hangs, we still need the timer to fire.
          watchdog.timer = setTimeout(() => {
            const finalCheck = this.getSession(sessionId).promptWatchdog;
            if (!finalCheck || finalCheck.nonce !== nonce) return;

            this.output.appendLine(`[${sessionId}] Prompt watchdog: retry also got no response — notifying user`);
            this.clearPromptWatchdog(sessionId);
            this.postToWebview(webview, {
              type: "error",
              message: "GSD accepted the command but didn't start processing. Try sending it again.",
            } as ExtensionToWebviewMessage);
          }, WATCHDOG_TIMEOUT_MS);

          await client.prompt(message, images);
          // Re-check nonce after await — a new prompt may have started during the retry
          const current = this.getSession(sessionId).promptWatchdog;
          if (!current || current.nonce !== nonce) return;
        } catch (err: any) {
          this.output.appendLine(`[${sessionId}] Prompt watchdog: retry failed — ${err.message}`);
          // Only clear if this watchdog is still current
          const current = this.getSession(sessionId).promptWatchdog;
          if (current?.nonce === nonce) {
            this.clearPromptWatchdog(sessionId);
          }
          // Don't show error — the prompt() catch block already handles this
        }
      }
    }, WATCHDOG_TIMEOUT_MS);

    this.getSession(sessionId).promptWatchdog = { timer, retried: false, nonce, message, images };
  }

  private clearPromptWatchdog(sessionId: string): void {
    const watchdog = this.getSession(sessionId).promptWatchdog;
    if (watchdog) {
      clearTimeout(watchdog.timer);
      this.getSession(sessionId).promptWatchdog = null;
    }
  }

  /**
   * Slash command watchdog — slash commands don't emit agent_start, so the
   * regular watchdog can't be used. Instead, watch for ANY event arriving
   * within the timeout. If nothing comes, retry once then notify the user.
   */
  private startSlashCommandWatchdog(
    webview: vscode.Webview,
    sessionId: string,
    message: string,
    images?: Array<{ type: "image"; data: string; mimeType: string }>
  ): void {
    // Clear any existing slash watchdog
    const existing = this.getSession(sessionId).slashWatchdog;
    if (existing) clearTimeout(existing);

    const TIMEOUT_MS = 10_000;
    const sentAt = Date.now();

    const timer = setTimeout(async () => {
      this.getSession(sessionId).slashWatchdog = null;

      // Check if any event arrived since we sent the command
      const lastEvent = this.getSession(sessionId).lastEventTime || 0;
      if (lastEvent > sentAt) {
        // Events are flowing — command is alive, no action needed
        return;
      }

      const client = this.getSession(sessionId).client;
      if (!client?.isRunning) return;

      // Retry once
      this.output.appendLine(`[${sessionId}] Slash watchdog: no events after ${TIMEOUT_MS / 1000}s for "${message}" — retrying`);
      try {
        const retrySentAt = Date.now();
        // Start the final-chance watchdog BEFORE awaiting — if prompt()
        // hangs, we still need the timer to fire.
        const retryTimer = setTimeout(() => {
          this.getSession(sessionId).slashWatchdog = null;
          const lastRetryEvent = this.getSession(sessionId).lastEventTime || 0;
          if (lastRetryEvent > retrySentAt) return; // events flowing since retry

          this.output.appendLine(`[${sessionId}] Slash watchdog: retry also got no response for "${message}"`);
          this.postToWebview(webview, {
            type: "error",
            message: `Command "${message}" was sent but got no response. Try sending it again.`,
          } as ExtensionToWebviewMessage);
        }, TIMEOUT_MS);
        this.getSession(sessionId).slashWatchdog = retryTimer;

        await client.prompt(message, images);
      } catch (err: any) {
        this.postToWebview(webview, { type: "error", message: err.message });
      }
    }, TIMEOUT_MS);

    this.getSession(sessionId).slashWatchdog = timer;
  }

  /**
   * Streaming activity monitor — uses health pings to detect truly stuck
   * processes during an active agent turn.
   *
   * Why ping-based, not event-based: Long-running tools (subagent, bg_shell)
   * may not emit ANY intermediate events through RPC for 5+ minutes while
   * doing real work. Event-based monitoring would abort healthy work.
   * Ping-based monitoring only fires when the GSD process itself is
   * unresponsive — meaning it can't even answer a get_state request.
   *
   * Escalation:
   *  1. First unresponsive ping → log, notify webview, keep monitoring
   *  2. Two consecutive unresponsive pings → abort
   *  3. Abort fails → force-kill
   */
  private startActivityMonitor(webview: vscode.Webview, sessionId: string, client: GsdRpcClient): void {
    this.stopActivityMonitor(sessionId);

    const CHECK_INTERVAL_MS = 30_000; // check every 30s
    const PING_TIMEOUT_MS = 15_000;   // individual ping timeout
    let consecutiveFailures = 0;

    const timer = setInterval(async () => {
      // Only act while streaming
      if (!this.getSession(sessionId).isStreaming) {
        this.stopActivityMonitor(sessionId);
        return;
      }

      if (!client.isRunning) {
        this.stopActivityMonitor(sessionId);
        return;
      }

      const isAlive = await client.ping(PING_TIMEOUT_MS);

      if (isAlive) {
        // Process is responsive — reset failure count
        if (consecutiveFailures > 0) {
          this.output.appendLine(`[${sessionId}] Activity monitor: process recovered after ${consecutiveFailures} failed ping(s)`);
          consecutiveFailures = 0;
        }
        return;
      }

      consecutiveFailures++;
      this.output.appendLine(`[${sessionId}] Activity monitor: ping failed (${consecutiveFailures} consecutive)`);

      if (consecutiveFailures === 1) {
        // First failure — warn but don't act yet (could be transient)
        this.postToWebview(webview, {
          type: "error",
          message: "GSD process is not responding — monitoring...",
        } as ExtensionToWebviewMessage);
        return;
      }

      // Two or more consecutive failures — process is truly stuck
      this.output.appendLine(`[${sessionId}] Activity monitor: ${consecutiveFailures} consecutive ping failures — aborting`);
      this.stopActivityMonitor(sessionId);

      this.postToWebview(webview, {
        type: "error",
        message: `GSD process unresponsive for ${consecutiveFailures * CHECK_INTERVAL_MS / 1000}s — aborting to recover.`,
      } as ExtensionToWebviewMessage);

      // Try graceful abort first
      try {
        await client.abort();
        // Wait a moment for agent_end to arrive naturally
        await new Promise(r => setTimeout(r, 3000));
        // If still streaming, force-push agent_end to unblock the webview
        if (this.getSession(sessionId).isStreaming) {
          this.output.appendLine(`[${sessionId}] Activity monitor: abort succeeded but no agent_end — forcing`);
          this.getSession(sessionId).isStreaming = false;
          this.emitStatus({ isStreaming: false });
          this.postToWebview(webview, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
        }
      } catch {
        // If abort fails, the process may be truly hung — force kill
        this.output.appendLine(`[${sessionId}] Activity monitor: abort failed, force-killing`);
        this.getSession(sessionId).isStreaming = false;
        this.emitStatus({ isStreaming: false });
        this.postToWebview(webview, { type: "agent_end", messages: [] } as ExtensionToWebviewMessage);
        client.forceKill();
      }
    }, CHECK_INTERVAL_MS);

    this.getSession(sessionId).activityTimer = timer;
  }

  private stopActivityMonitor(sessionId: string): void {
    const timer = this.getSession(sessionId).activityTimer;
    if (timer) {
      clearInterval(timer);
      this.getSession(sessionId).activityTimer = null;
    }
  }

  /**
   * Abort the current stream and re-send a slash command as a prompt.
   * Uses bounded retry to wait for the abort to settle before prompting.
   */
  private async abortAndPrompt(
    client: GsdRpcClient,
    webview: vscode.Webview,
    message: string,
    images?: Array<{ data: string; mimeType: string }>,
  ): Promise<void> {
    try { await client.abort(); } catch { /* may not be streaming */ }

    const imgs = images?.map((img) => ({
      type: "image" as const,
      data: img.data,
      mimeType: img.mimeType,
    }));

    // Bounded retry — wait for stream teardown before sending the command
    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 150;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await client.prompt(message, imgs);
        return;
      } catch (err: any) {
        if (err.message?.includes("streaming") && attempt < MAX_ATTEMPTS - 1) {
          this.output.appendLine(`[abortAndPrompt] Retry ${attempt + 1}/${MAX_ATTEMPTS - 1}: stream not yet settled`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        this.postToWebview(webview, { type: "error", message: err.message });
        return;
      }
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
              this.postToWebview(webview, { type: "state", data: rpcState } as ExtensionToWebviewMessage);
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
                this.startSlashCommandWatchdog(webview, sessionId, msg.message, images);
              } else {
                this.startPromptWatchdog(webview, sessionId, msg.message, images);
              }
              this.output.appendLine(`[${sessionId}] Sending prompt to RPC: "${msg.message.slice(0, 80)}"`);
              this.armGsdFallbackProbe(msg.message.trim(), sessionId, webview);

              await c.prompt(msg.message, images);
              this.output.appendLine(`[${sessionId}] Prompt RPC resolved for: "${msg.message.slice(0, 80)}"`);
              this.startGsdFallbackTimer(msg.message.trim(), sessionId, webview);
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
                    this.startSlashCommandWatchdog(webview, sessionId, msg.message, imgs);
                    this.armGsdFallbackProbe(msg.message.trim(), sessionId, webview);
                    await this.abortAndPrompt(c, webview, msg.message, msg.images);
                    this.startGsdFallbackTimer(msg.message.trim(), sessionId, webview);
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
            try {
              // Extension commands (slash commands) can't be steered — they need to run
              // as prompts. Abort the current stream first, then send as a prompt.
              if (msg.message.startsWith("/")) {
                await this.abortAndPrompt(client, webview, msg.message, msg.images);
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
              this.stopActivityMonitor(sessionId);
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
          try {
            const contentHtml = (msg as any).html as string || "<p>No conversation content</p>";
            const pageCss = (msg as any).css as string || "";
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const extVersion = vscode.extensions.getExtension("rokketek.rokket-gsd")?.packageJSON?.version || "?";
            const exportOverrides = `
    /* VS Code CSS variable fallbacks for standalone browser */
    :root {
      color-scheme: dark;
      --vscode-foreground: #cccccc;
      --vscode-editor-background: #1e1e1e;
      --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --vscode-editor-fontFamily: 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace;
      --vscode-input-background: #2d2d30;
      --vscode-input-foreground: #cccccc;
      --vscode-input-placeholderForeground: #6e6e6e;
      --vscode-panel-border: #2d2d30;
      --vscode-button-background: #0e639c;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #1177bb;
      --vscode-badge-background: #4d4d4d;
      --vscode-badge-foreground: #ffffff;
      --vscode-descriptionForeground: #9e9e9e;
      --vscode-scrollbarSlider-background: rgba(121,121,121,0.4);
      --vscode-scrollbarSlider-hoverBackground: rgba(100,100,100,0.7);
      --vscode-editor-selectionForeground: #ffffff;
    }
    /* Export overrides */
    body { background: #1e1e1e; color: #cccccc; max-width: 880px; margin: 0 auto; padding: 32px 24px; }
    .gsd-welcome, .gsd-scroll-fab, .gsd-slash-menu, .gsd-model-picker, .gsd-thinking-picker,
    .gsd-session-history, .gsd-copy-response-btn, .gsd-fork-btn, .gsd-retry-btn,
    .gsd-turn-actions, .gsd-input-area, .gsd-header, .gsd-footer,
    .gsd-overlay-indicators, .gsd-context-bar-container { display: none !important; }
    .gsd-messages { padding: 0; }
`;
            const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rokket GSD — Export ${timestamp}</title>
  <style>
${pageCss}
${exportOverrides}
  </style>
</head>
<body>
  <h1 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #2a2a2e;">🚀 Rokket GSD — Conversation Export</h1>
  <div class="gsd-messages">${contentHtml}</div>
  <footer style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #2a2a2e; color: #555; font-size: 12px;">
    Exported ${new Date().toLocaleString()} — Rokket GSD v${extVersion}
  </footer>
</body>
</html>`;
            const fs = await import("fs");
            // Show save dialog defaulting to Downloads
            const defaultUri = vscode.Uri.file(
              (process.env.USERPROFILE || process.env.HOME || "") + `\\Downloads\\gsd-export-${timestamp}.html`
            );
            const uri = await vscode.window.showSaveDialog({
              defaultUri,
              filters: { "HTML": ["html"] },
              title: "Export Conversation",
            });
            if (!uri) break; // user cancelled
            const exportPath = uri.fsPath;
            fs.writeFileSync(exportPath, fullHtml, "utf-8");
            // Open in default browser (cross-platform)
            vscode.env.openExternal(vscode.Uri.file(exportPath));
            vscode.window.showInformationMessage(`Exported to ${exportPath}`);
          } catch (err: any) {
            this.postToWebview(webview, { type: "error", message: `Export failed: ${err.message}` });
          }
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
          const results = await Promise.all(
            msg.paths.map(async (p: string) => {
              try {
                await fs.promises.access(p, fs.constants.R_OK);
                return { path: p, readable: true };
              } catch {
                return { path: p, readable: false };
              }
            })
          );
          this.postToWebview(webview, { type: "file_access_result", results });
          break;
        }

        case "save_temp_file": {
          try {
            const dir = this.ensureTempDir();
            // Sanitize filename — strip path separators
            const safeName = msg.name.replace(/[/\\]/g, "_");
            const filePath = path.join(dir, safeName);
            fs.writeFileSync(filePath, Buffer.from(msg.data, "base64"));
            this.postToWebview(webview, { type: "temp_file_saved", path: filePath, name: safeName });
          } catch (err: any) {
            this.postToWebview(webview, { type: "error", message: `Failed to save file: ${err.message}` });
          }
          break;
        }

        case "attach_files": {
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: "Attach to GSD",
            filters: { "All Files": ["*"] },
          });
          if (uris && uris.length > 0) {
            const paths = uris.map(u => u.fsPath);
            this.postToWebview(webview, { type: "files_attached", paths });
          }
          break;
        }

        case "copy_text": {
          await vscode.env.clipboard.writeText(msg.text);
          break;
        }

        case "set_theme": {
          await vscode.workspace.getConfiguration("gsd").update("theme", msg.theme, vscode.ConfigurationTarget.Global);
          break;
        }

        case "open_file": {
          try {
            // Security: only open files within the workspace (resolves symlinks)
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
              this.output.appendLine(`[${sessionId}] Blocked open_file: no workspace open`);
              break;
            }
            const realFile = fs.realpathSync(path.resolve(msg.path));
            const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
            if (!realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
              this.output.appendLine(`[${sessionId}] Blocked open_file outside workspace: ${realFile}`);
              break;
            }
            const doc = await vscode.workspace.openTextDocument(realFile);
            await vscode.window.showTextDocument(doc);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
          }
          break;
        }

        case "open_url": {
          // Security: only allow http/https URLs
          const url = String(msg.url || "");
          if (/^https?:\/\//i.test(url)) {
            vscode.env.openExternal(vscode.Uri.parse(url));
          } else {
            this.output.appendLine(`[${sessionId}] Blocked non-http URL: ${url}`);
          }
          break;
        }

        case "open_diff": {
          try {
            // Security: only open files within the workspace (resolves symlinks)
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
              this.output.appendLine(`[${sessionId}] Blocked open_diff: no workspace open`);
              break;
            }
            const realRoot = fs.realpathSync(path.resolve(workspaceRoot));
            const realLeft = fs.realpathSync(path.resolve(msg.leftPath));
            const realRight = fs.realpathSync(path.resolve(msg.rightPath));
            const rootPrefix = realRoot + path.sep;
            if (!realLeft.startsWith(rootPrefix) || !realRight.startsWith(rootPrefix)) {
              this.output.appendLine(`[${sessionId}] Blocked open_diff outside workspace`);
              break;
            }
            const left = vscode.Uri.file(realLeft);
            const right = vscode.Uri.file(realRight);
            await vscode.commands.executeCommand("vscode.diff", left, right);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open diff: ${err.message}`);
          }
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
      this.handleRpcEvent(webview, sessionId, event, client);
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
      this.stopActivityMonitor(sessionId);
      this.getSession(sessionId).isStreaming = false;
      this.clearPromptWatchdog(sessionId);
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
      // Pre-launch: remove stale crash locks that cause infinite wizard loops
      // when there's no active work to resume (idle state with leftover auto.lock)
      const { cleanStaleCrashLock } = await import("./file-ops");
      cleanStaleCrashLock(workingDir, this.output);

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
        this.postToWebview(webview, { type: "state", data: rpcState } as ExtensionToWebviewMessage);
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

  // --- RPC Event → Webview / VS Code Native ---

  private handleRpcEvent(
    webview: vscode.Webview,
    sessionId: string,
    event: Record<string, unknown>,
    client: GsdRpcClient
  ): void {
    const eventType = event.type as string;

    // Track event arrival — used by slash command watchdog
    this.getSession(sessionId).lastEventTime = Date.now();

    // Clear slash command watchdog on any event — command is alive
    const slashTimer = this.getSession(sessionId).slashWatchdog;
    if (slashTimer) {
      clearTimeout(slashTimer);
      this.getSession(sessionId).slashWatchdog = null;
    }

    if (eventType === "extension_ui_request") {
      this.handleExtensionUiRequest(webview, sessionId, event, client);
      return;
    }

    // Log extension errors to the output panel
    if (eventType === "extension_error") {
      const extPath = event.extensionPath as string || "unknown";
      const extEvent = event.event as string || "unknown";
      const extError = event.error as string || "unknown error";
      this.output.appendLine(`[${sessionId}] Extension error (${extPath}, ${extEvent}): ${extError}`);
    }

    // Update status bar based on event type
    if (eventType === "agent_start") {
      this.clearPromptWatchdog(sessionId);
      this.emitStatus({ isStreaming: true });
      this.getSession(sessionId).isStreaming = true;
      this.startActivityMonitor(webview, sessionId, client);
      // Mark that a real agent turn started (used by /gsd fallback detection)
      this.getSession(sessionId).gsdTurnStarted = true;
    } else if (eventType === "agent_end") {
      this.emitStatus({ isStreaming: false });
      this.getSession(sessionId).isStreaming = false;
      this.stopActivityMonitor(sessionId);
      // Cancel /gsd fallback — the command completed (even without agent_start)
      const gsdTimer = this.getSession(sessionId).gsdFallbackTimer;
      if (gsdTimer) {
        clearTimeout(gsdTimer);
        this.getSession(sessionId).gsdFallbackTimer = null;
      }
      // Refresh workflow state after each agent turn
      this.refreshWorkflowState(webview, sessionId);
    } else if (eventType === "message_end") {
      const msg = event.message;
      const usage = msg?.usage as { cost?: { total?: number } } | undefined;
      if (msg?.role === "assistant" && usage?.cost?.total) {
        this.emitStatus({ cost: (this.lastStatus.cost || 0) + usage.cost.total });
      }
    } else if (eventType === "fallback_provider_switch") {
      const to = (event as any).to as string || "";
      if (to) this.emitStatus({ model: to });
    } else if (eventType === "session_shutdown") {
      this.emitStatus({ isStreaming: false });
      this.getSession(sessionId).isStreaming = false;
      this.stopActivityMonitor(sessionId);
    }

    // Forward all other events directly to the webview
    this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
  }

  /**
   * Workaround for gsd-pi ctx.ui.custom() returning undefined in RPC mode.
   * When /gsd or /gsd auto silently produces no events, read the project
   * STATE.md and send a plain-text prompt that achieves the same effect
   * without needing the broken interactive wizard.
   *
   * Forward-compatible: when gsd-pi fixes ctx.ui.custom(), the 5-second
   * timer that calls this method won't fire because real events will arrive.
   */
  /**
   * Arm the /gsd fallback probe — reset turn-started flag and cancel any
   * existing fallback timer. Must be called BEFORE prompt() so agent_start
   * events during the RPC await don't get clobbered.
   */
  private armGsdFallbackProbe(message: string, sessionId: string, _webview: vscode.Webview): void {
    if (!GsdWebviewProvider.GSD_COMMAND_RE.test(message)) return;
    const existingTimer = this.getSession(sessionId).gsdFallbackTimer;
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.getSession(sessionId).gsdFallbackTimer = null;
    }
    this.getSession(sessionId).gsdTurnStarted = false;
  }

  /**
   * Start the /gsd fallback timer — if no agent_start arrived within 500ms,
   * fire the workaround prompt. Must be called AFTER prompt() resolves.
   * 
   * Subcommands that work natively in RPC mode (auto, stop, pause, next,
   * status, steer, remote, prefs, parallel) are excluded — they don't need fallbacks.
   */
  private static GSD_NATIVE_SUBCOMMANDS = /^\s*\/gsd\s+(auto|stop|pause|next|status|steer|remote|prefs|parallel)\b/i;

  private startGsdFallbackTimer(message: string, sessionId: string, webview: vscode.Webview): void {
    if (!GsdWebviewProvider.GSD_COMMAND_RE.test(message)) return;
    // Skip fallback for subcommands that work natively in RPC mode
    if (GsdWebviewProvider.GSD_NATIVE_SUBCOMMANDS.test(message)) return;
    const fallbackTimer = setTimeout(async () => {
      if (this.getSession(sessionId).gsdFallbackTimer !== fallbackTimer) return;
      this.getSession(sessionId).gsdFallbackTimer = null;
      const started = this.getSession(sessionId).gsdTurnStarted;
      this.getSession(sessionId).gsdTurnStarted = false;
      const client = this.getSession(sessionId).client;
      if (!client?.isRunning) return;
      if (!started) {
        this.output.appendLine(`[${sessionId}] /gsd command produced no agent turn — applying workaround`);
        await this.handleGsdAutoFallback(client, webview, sessionId, message);
      }
    }, 500);
    this.getSession(sessionId).gsdFallbackTimer = fallbackTimer;
  }

  private async handleGsdAutoFallback(
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

      this.output.appendLine(`[${sessionId}] Sending fallback prompt for "${originalCommand}"`);
      this.postToWebview(webview, {
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
      this.output.appendLine(`[${sessionId}] GSD auto fallback failed: ${err.message}`);
      this.postToWebview(webview, {
        type: "error",
        message: `The /gsd command couldn't complete. Try sending a plain text message describing what you want to do instead.`,
      } as ExtensionToWebviewMessage);
    }
  }

  private async handleExtensionUiRequest(
    webview: vscode.Webview,
    sessionId: string,
    event: Record<string, unknown>,
    client: GsdRpcClient
  ): Promise<void> {
    const id = event.id as string;
    const method = event.method as string;

    switch (method) {
      case "select":
      case "confirm":
      case "input": {
        // Forward to webview for inline rendering
        this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);

        // Show a native VS Code notification so the user knows they need to respond,
        // but only if the webview isn't currently visible. Avoids notification spam
        // when the user is already looking at the GSD panel.
        const isWebviewVisible = this.isWebviewVisible(sessionId);
        if (!isWebviewVisible) {
          const title = event.title as string || event.message as string || "GSD needs your input";
          const truncatedTitle = title.length > 80 ? title.slice(0, 77) + "…" : title;
          vscode.window.showInformationMessage(
            `🚀 GSD: ${truncatedTitle}`,
            "Open GSD"
          ).then((action) => {
            if (action === "Open GSD") {
              // Bring the GSD panel/sidebar into view
              if (this.webviewView) {
                this.webviewView.show(true);
              }
              const panel = this.getSession(sessionId).panel;
              if (panel) {
                panel.reveal();
              }
            }
          });
        }
        break;
      }

      case "editor": {
        const title = event.title as string || "GSD";
        const prefill = event.prefill as string || "";

        const doc = await vscode.workspace.openTextDocument({
          content: prefill,
          language: "markdown",
        });

        await vscode.window.showTextDocument(doc, {
          preview: true,
          viewColumn: vscode.ViewColumn.Beside,
        });

        const result = await vscode.window.showInformationMessage(
          `${title}\n\nEdit the document and click Submit when done.`,
          "Submit",
          "Cancel"
        );

        const text = doc.getText();
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

        if (result === "Submit") {
          client.sendExtensionUiResponse({ type: "extension_ui_response", id, value: text });
        } else {
          client.sendExtensionUiResponse({ type: "extension_ui_response", id, cancelled: true });
        }
        break;
      }

      case "notify": {
        const message = event.message as string || "";
        const notifyType = event.notifyType as string || "info";

        // Suppress noisy startup info about optional tools/keys — not actionable for most users
        const isStartupNoise = notifyType === "info" && (
          /No \w+_API_KEY set/i.test(message) ||
          /\bfree tier\b/i.test(message) ||
          /\b(MCPorter|Web search)\b.*\b(ready|loaded)\b/i.test(message)
        );
        if (isStartupNoise) {
          this.output.appendLine(`[${sessionId}] [suppressed] ${message}`);
          break;
        }

        // Forward to webview — chat is the primary notification surface
        this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
        break;
      }

      case "setStatus": {
        // Track auto-mode status for workflow badge
        if (event.statusKey === "gsd-auto") {
          const autoMode = event.statusText as string | undefined;
          this.getSession(sessionId).autoModeState = autoMode || null;
          this.refreshWorkflowState(webview, sessionId);
          // Cancel /gsd fallback — setStatus proves the command is working
          const gsdTimer = this.getSession(sessionId).gsdFallbackTimer;
          if (gsdTimer) {
            clearTimeout(gsdTimer);
            this.getSession(sessionId).gsdFallbackTimer = null;
          }
          // Forward to auto-progress poller
          const poller = this.getSession(sessionId).autoProgressPoller;
          if (poller) {
            poller.onAutoModeChanged(autoMode);
          }
        }
        this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
        break;
      }
      case "setWidget":
      case "set_editor_text": {
        this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
        break;
      }

      case "setTitle": {
        const title = event.title as string;
        const sessionPanel = this.getSession(sessionId).panel;
        if (sessionPanel && title) {
          sessionPanel.title = title;
        }
        break;
      }

      default: {
        this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
        this.output.appendLine(`[${sessionId}] Unknown extension_ui method: ${method}`);
        break;
      }
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
