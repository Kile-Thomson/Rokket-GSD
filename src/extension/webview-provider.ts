import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GsdRpcClient } from "./rpc-client";
import { fetchReleaseNotes } from "./update-checker";
import { parseGsdWorkflowState } from "./state-parser";
import { AutoProgressPoller } from "./auto-progress";
import { createSessionState, cleanupSessionState, type SessionState } from "./session-state";
import type {
  ExtensionToWebviewMessage,
  SessionStats,
  RpcCommandsResult,
  RpcStateResult,
} from "../shared/types";
import { toGsdState } from "../shared/types";
import {
  clearPromptWatchdog,
  stopActivityMonitor,
  type WatchdogContext,
} from "./watchdogs";
import type { CommandFallbackContext } from "./command-fallback";
import {
  handleRpcEvent,
  type RpcEventContext,
} from "./rpc-events";
import type { FileOpsContext } from "./file-ops";
import { handleWebviewMessage, type MessageDispatchContext } from "./message-dispatch";

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

    const ctx: MessageDispatchContext = {
      getSession: (id) => this.getSession(id),
      postToWebview: (wv, msg) => this.postToWebview(wv, msg),
      output: this.output,
      emitStatus: (u) => this.emitStatus(u),
      launchGsd: (wv, sid, cwd) => this.launchGsd(wv, sid, cwd),
      applySessionCostFloor: (sid, stats) => this.applySessionCostFloor(sid, stats),
      extensionContext: this.context,
      gsdVersion: this.gsdVersion,
      getUseCtrlEnter: () => this.getUseCtrlEnter(),
      getTheme: () => this.getTheme(),
      checkWhatsNew: (wv) => this.checkWhatsNew(wv),
      cleanupTempFiles: () => this.cleanupTempFiles(),
      cleanupSession: (sid) => this.cleanupSession(sid),
      watchdogCtx: this.watchdogCtx,
      commandFallbackCtx: this.commandFallbackCtx,
      fileOpsCtx: this.fileOpsCtx,
    };

    const disposable = webview.onDidReceiveMessage(async (msg) => {
      await handleWebviewMessage(ctx, webview, sessionId, msg);
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
