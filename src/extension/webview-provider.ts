import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GsdRpcClient } from "./rpc-client";
import { fetchReleaseNotes } from "./update-checker";
import { AutoProgressPoller } from "./auto-progress-poller";
import { createSessionState, cleanupSessionState, type SessionState } from "./session-state";
import type { ExtensionToWebviewMessage, RpcCommandsResult, RpcStateResult } from "../shared/types";
import { toGsdState } from "../shared/types";
import { clearPromptWatchdog, stopActivityMonitor, type WatchdogContext } from "./watchdogs";
import type { CommandFallbackContext } from "./command-fallback";
import { handleRpcEvent, type RpcEventContext } from "./rpc-events";
import type { FileOpsContext } from "./file-ops";
import { handleWebviewMessage, type MessageDispatchContext } from "./message-dispatch";
import { startStatsPolling, startHealthMonitoring, refreshWorkflowState, startWorkflowPolling, stopAllPolling, type PollingContext } from "./polling";
import { getWebviewHtml } from "./html-generator";

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
  private sidebarSessionId: string | null = null;
  private gsdVersion: string | undefined;
  private statusCallback?: (status: StatusBarUpdate) => void;
  private lastStatus: StatusBarUpdate = { isStreaming: false };
  private tempDir: string | null = null;

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
      refreshWorkflowState: (wv, sid) => refreshWorkflowState(this.pollingCtx, wv, sid),
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

  private get pollingCtx(): PollingContext {
    return {
      getSession: (id) => this.getSession(id),
      postToWebview: (wv, msg) => this.postToWebview(wv, msg),
      output: this.output,
      emitStatus: (update) => this.emitStatus(update),
      applySessionCostFloor: (sid, stats) => this.applySessionCostFloor(sid, stats),
    };
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.output = vscode.window.createOutputChannel("Rokket GSD");
    this.resolveGsdVersionAsync().then(v => { this.gsdVersion = v; });
  }

  private async resolveGsdVersionAsync(): Promise<string | undefined> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execSync } = require("child_process");
      const gsdPath = execSync(process.platform === "win32" ? "where gsd" : "which gsd", {
        encoding: "utf8", timeout: 5000, windowsHide: true,
      }).trim().split(/\r?\n/)[0];
      if (gsdPath) {
        let dir = path.dirname(gsdPath);
        for (let i = 0; i < 4; i++) {
          const pkgPath = path.join(dir, "node_modules", "gsd-pi", "package.json");
          if (fs.existsSync(pkgPath)) {
            const raw = await fs.promises.readFile(pkgPath, "utf8");
            return JSON.parse(raw).version;
          }
          dir = path.dirname(dir);
        }
      }
    } catch { /* version is nice-to-have */ }
    return undefined;
  }

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
      // Rebind ALL client listeners to reference the new webview (not just "event")
      existingClient.removeAllListeners("event");
      existingClient.removeAllListeners("exit");
      existingClient.removeAllListeners("error");
      existingClient.removeAllListeners("log");
      this.getSession(sessionId).webview = webviewView.webview;
      this.getSession(sessionId).autoProgressPoller?.rebindWebview(webviewView.webview);
      this._bindClientListeners(existingClient, webviewView.webview, sessionId);
      this.output.appendLine(`[${sessionId}] Sidebar re-resolved — reusing existing session, all listeners rebound`);
    } else {
      if (this.sidebarSessionId) this.cleanupSession(this.sidebarSessionId);
      sessionId = `sidebar-${++this.sessionCounter}`;
      this.sidebarSessionId = sessionId;
    }

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    webviewView.webview.html = getWebviewHtml(this.extensionUri, webviewView.webview, sessionId);
    this.setupWebviewMessageHandling(webviewView.webview, sessionId);
  }

  openInTab(): void {
    const sessionId = `panel-${++this.sessionCounter}`;
    const panel = vscode.window.createWebviewPanel(
      "gsdPanel", "Rokket GSD", vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      }
    );
    this.getSession(sessionId).panel = panel;
    panel.webview.html = getWebviewHtml(this.extensionUri, panel.webview, sessionId);
    this.setupWebviewMessageHandling(panel.webview, sessionId);
    panel.onDidDispose(() => {
      this.getSession(sessionId).panel = null;
      this.cleanupSession(sessionId);
    });
  }

  focus(): void {
    if (this.webviewView) this.webviewView.show(true);
    this.broadcastToAll({ type: "config", useCtrlEnterToSend: this.getUseCtrlEnter(), theme: this.getTheme() } as ExtensionToWebviewMessage);
  }

  onConfigChanged(): void {
    this.broadcastToAll({ type: "config", useCtrlEnterToSend: this.getUseCtrlEnter(), theme: this.getTheme() } as ExtensionToWebviewMessage);
  }

  async newConversation(): Promise<void> {
    for (const [, session] of this.sessions) {
      if (session.client?.isRunning) {
        try { await session.client.newSession(); }
        catch (err) { this.output.appendLine(`Error creating new session: ${err}`); }
      }
    }
  }

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

  onStatusUpdate(callback: (status: StatusBarUpdate) => void): void {
    this.statusCallback = callback;
  }

  private emitStatus(update: Partial<StatusBarUpdate>): void {
    this.lastStatus = { ...this.lastStatus, ...update };
    this.statusCallback?.(this.lastStatus);
  }

  /** Apply session-scoped cost floor — prevents compaction from lowering reported cost */
  private applySessionCostFloor(sessionId: string, stats: { cost?: number } | null | undefined): void {
    if (!stats) return;
    const sessionCost = this.getSession(sessionId).accumulatedCost;
    if (sessionCost > (stats.cost || 0)) stats.cost = sessionCost;
  }

  dispose(): void {
    for (const [, session] of this.sessions) {
      cleanupSessionState(session);
      if (session.panel) session.panel.dispose();
    }
    this.sessions.clear();
    this.output.dispose();
    this.cleanupTempFiles();
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      cleanupSessionState(session);
      this.sessions.delete(sessionId);
    }
  }

  private static readonly LAST_VERSION_KEY = "gsd.lastSeenVersion";

  private async checkWhatsNew(webview: vscode.Webview): Promise<void> {
    const ext = vscode.extensions.getExtension("rokketek.rokket-gsd");
    const currentVersion = ext?.packageJSON?.version;
    if (!currentVersion) return;
    const lastVersion = this.context.globalState.get<string>(GsdWebviewProvider.LAST_VERSION_KEY);
    await this.context.globalState.update(GsdWebviewProvider.LAST_VERSION_KEY, currentVersion);
    if (lastVersion === currentVersion) return;
    try {
      const notes = await fetchReleaseNotes(currentVersion);
      if (notes) {
        this.postToWebview(webview, { type: "whats_new", version: currentVersion, notes } as ExtensionToWebviewMessage);
      }
    } catch { /* best-effort */ }
  }

  private ensureTempDir(): string {
    if (!this.tempDir) {
      this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gsd-attach-"));
      this.output.appendLine(`Temp dir created: ${this.tempDir}`);
    }
    return this.tempDir;
  }

  private cleanupTempFiles(): void {
    if (this.tempDir) {
      try { fs.rmSync(this.tempDir, { recursive: true, force: true }); this.output.appendLine(`Temp dir cleaned: ${this.tempDir}`); }
      catch { /* best effort */ }
      this.tempDir = null;
    }
  }

  private setupWebviewMessageHandling(webview: vscode.Webview, sessionId: string): void {
    this.getSession(sessionId).webview = webview;
    const prevDisposable = this.getSession(sessionId).messageHandlerDisposable;
    if (prevDisposable) prevDisposable.dispose();

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

  private launchGsd(webview: vscode.Webview, sessionId: string, cwd?: string): Promise<void> {
    const existing = this.getSession(sessionId).launchPromise;
    if (existing) return existing;
    const promise = this._doLaunchGsd(webview, sessionId, cwd).finally(() => {
      this.getSession(sessionId).launchPromise = null;
    });
    this.getSession(sessionId).launchPromise = promise;
    return promise;
  }

  /**
   * Bind all 4 RPC client event listeners (event, log, exit, error) to the given webview.
   * Used both at initial launch and on sidebar re-resolve to ensure handlers reference
   * the current webview instance. Resolves webview via session state for long-lived handlers.
   */
  private _bindClientListeners(client: GsdRpcClient, webview: vscode.Webview, sessionId: string): void {
    client.on("event", (event: Record<string, unknown>) => {
      const currentWebview = this.getSession(sessionId).webview ?? webview;
      handleRpcEvent(this.rpcEventCtx, currentWebview, sessionId, event, client);
    });

    let stderrLineBuffer = "";
    client.on("log", (text: string) => {
      // Line-buffer stderr: chunks don't align with newline boundaries
      stderrLineBuffer += text;
      const parts = stderrLineBuffer.split("\n");
      stderrLineBuffer = parts.pop() || ""; // keep incomplete trailing line

      // Intercept async_subagent progress events from stderr
      const nonProgressLines: string[] = [];
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{\"__async_subagent_progress\":")) {
          try {
            const progress = JSON.parse(trimmed);
            if (progress.__async_subagent_progress && progress.toolCallId) {
              const currentWebview = this.getSession(sessionId).webview ?? webview;
              this.postToWebview(currentWebview, {
                type: "async_subagent_progress",
                toolCallId: progress.toolCallId,
                mode: progress.mode,
                results: progress.results,
              });
              continue;
            }
          } catch { /* not valid JSON, fall through */ }
        }
        if (trimmed) nonProgressLines.push(line);
      }
      if (nonProgressLines.length > 0) {
        this.output.appendLine(`[${sessionId}] stderr: ${nonProgressLines.join("\n")}`);
      }
    });

    client.on("exit", ({ code, signal, detail }: { code: number | null; signal: string | null; detail?: string }) => {
      this.output.appendLine(`[${sessionId}] Process exited: ${detail || `code=${code}, signal=${signal}`}`);
      const currentWebview = this.getSession(sessionId).webview ?? webview;
      this.postToWebview(currentWebview, { type: "process_exit", code, signal, detail });
      const isCleanExit = code === 0 || signal === "SIGTERM" || signal === "SIGKILL";
      this.postToWebview(currentWebview, { type: "process_status", status: isCleanExit ? "stopped" : "crashed" } as ExtensionToWebviewMessage);

      // Stop all monitoring timers and watchdogs
      this._cleanupTimersAndWatchdogs(sessionId);

      if (isCleanExit) {
        this.getSession(sessionId).client = null;
      } else {
        this.output.appendLine(`[${sessionId}] Unexpected exit — will auto-restart on next prompt`);
      }
    });

    client.on("error", (err: Error) => {
      this.output.appendLine(`[${sessionId}] Process error: ${err.message}`);
      const currentWebview = this.getSession(sessionId).webview ?? webview;
      this.postToWebview(currentWebview, { type: "process_exit", code: null, signal: null, detail: `Failed to start GSD: ${err.message}` });
      this.postToWebview(currentWebview, { type: "process_status", status: "crashed" } as ExtensionToWebviewMessage);

      // T05: Clean up timers on error too (mirrors exit handler)
      this._cleanupTimersAndWatchdogs(sessionId);
    });
  }

  /** Stop all monitoring timers, watchdogs, and reset streaming state for a session. */
  private _cleanupTimersAndWatchdogs(sessionId: string): void {
    stopAllPolling(this.pollingCtx, sessionId);
    this.getSession(sessionId).autoProgressPoller?.onProcessExit();
    this.getSession(sessionId).autoModeState = null;
    stopActivityMonitor(this.watchdogCtx, sessionId);
    this.getSession(sessionId).isStreaming = false;
    clearPromptWatchdog(this.watchdogCtx, sessionId);
    const slashWd = this.getSession(sessionId).slashWatchdog;
    if (slashWd) { clearTimeout(slashWd); this.getSession(sessionId).slashWatchdog = null; }
    this.getSession(sessionId).lastEventTime = 0;
    const gsdTimer = this.getSession(sessionId).gsdFallbackTimer;
    if (gsdTimer) { clearTimeout(gsdTimer); this.getSession(sessionId).gsdFallbackTimer = null; }
    this.getSession(sessionId).gsdTurnStarted = false;
  }

  private async _doLaunchGsd(webview: vscode.Webview, sessionId: string, cwd?: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workingDir = cwd || workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const config = vscode.workspace.getConfiguration("gsd");
    const processWrapper = config.get<string>("processWrapper", "");
    const envVars = config.get<Array<{ name: string; value: string }>>("environmentVariables", []);
    const env: Record<string, string> = {};
    for (const { name, value } of envVars) env[name] = value;

    this.postToWebview(webview, { type: "process_status", status: "starting" } as ExtensionToWebviewMessage);
    const client = new GsdRpcClient();

    this._bindClientListeners(client, webview, sessionId);

    try {
      await client.start({ cwd: workingDir, gsdPath: processWrapper || undefined, env });
      this.getSession(sessionId).client = client;
      this.output.appendLine(`[${sessionId}] GSD started in ${workingDir}`);

      // Negotiate v2 protocol — must complete before getState() since init must be first command.
      // Short timeout (3s) to avoid blocking launch if the process is slow to start.
      try {
        const v2Result = await client.initV2("rokket-gsd");
        if (v2Result) {
          this.output.appendLine(`[${sessionId}] RPC protocol v2 negotiated (session: ${v2Result.sessionId})`);
        } else {
          this.output.appendLine(`[${sessionId}] RPC protocol v1 (server does not support v2)`);
        }
      } catch (initErr: any) {
        this.output.appendLine(`[${sessionId}] v2 init failed (using v1): ${initErr.message}`);
      }

      const autoPoller = new AutoProgressPoller(
        sessionId, client, webview, () => workingDir, this.output,
        (oldModel, newModel) => {
          this.postToWebview(webview, { type: "model_routed", oldModel, newModel } as ExtensionToWebviewMessage);
        },
      );
      this.getSession(sessionId).autoProgressPoller = autoPoller;

      try {
        const rpcState = await client.getState() as RpcStateResult;
        this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
        this.postToWebview(webview, { type: "state", data: toGsdState(rpcState) } as ExtensionToWebviewMessage);
        if (rpcState?.model) this.emitStatus({ model: rpcState.model.id || rpcState.model.name });
      } catch (err: any) {
        this.output.appendLine(`[${sessionId}] Initial getState failed: ${err.message}`);
        this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
      }

      try {
        const cmdResult = await client.getCommands() as RpcCommandsResult;
        this.postToWebview(webview, { type: "commands", commands: cmdResult?.commands || [] });
      } catch (err: any) {
        this.output.appendLine(`[${sessionId}] Initial get_commands failed: ${err.message}`);
      }

      startStatsPolling(this.pollingCtx, webview, sessionId);
      startHealthMonitoring(this.pollingCtx, webview, sessionId);
      startWorkflowPolling(this.pollingCtx, webview, sessionId);
    } catch (err: any) {
      this.postToWebview(webview, {
        type: "process_exit", code: null, signal: null,
        detail: `Failed to start GSD: ${err.message}. Make sure 'gsd' is installed and in your PATH.`,
      });
      this.postToWebview(webview, { type: "process_status", status: "crashed" } as ExtensionToWebviewMessage);
    }
  }

  private postToWebview(webview: vscode.Webview, message: ExtensionToWebviewMessage | Record<string, unknown>): void {
    webview.postMessage(message);
  }

  /** Broadcast to all webview instances. Returns true if delivered to at least one. */
  public broadcast(message: ExtensionToWebviewMessage): boolean {
    return this.broadcastToAll(message);
  }

  private broadcastToAll(message: ExtensionToWebviewMessage): boolean {
    let delivered = false;
    if (this.webviewView) { this.webviewView.webview.postMessage(message); delivered = true; }
    for (const [, session] of this.sessions) {
      if (session.panel) { session.panel.webview.postMessage(message); delivered = true; }
    }
    return delivered;
  }

  private isWebviewVisible(sessionId: string): boolean {
    if (this.webviewView?.visible) return true;
    const panel = this.getSession(sessionId).panel;
    return panel?.visible ?? false;
  }

  private getUseCtrlEnter(): boolean {
    return vscode.workspace.getConfiguration("gsd").get<boolean>("useCtrlEnterToSend", false);
  }

  private getTheme(): string {
    return vscode.workspace.getConfiguration("gsd").get<string>("theme", "forge");
  }
}
