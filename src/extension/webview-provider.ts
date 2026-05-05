import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { GsdRpcClient } from "./rpc-client";
import { fetchReleaseNotes } from "./update-checker";
import { AutoProgressPoller } from "./auto-progress-poller";
import { createSessionState, cleanupSessionState, type SessionState } from "./session-state";
import { toErrorMessage } from "../shared/errors";
import type { ExtensionToWebviewMessage, RpcCommandsResult, RpcStateResult } from "../shared/types";
import { toGsdState } from "../shared/types";
import { clearPromptWatchdog, stopActivityMonitor, type WatchdogContext } from "./watchdogs";
import type { CommandFallbackContext } from "./command-fallback";
import { handleRpcEvent, type RpcEventContext } from "./rpc-events";
import type { FileOpsContext } from "./file-ops";
import { handleWebviewMessage, type MessageDispatchContext } from "./message-dispatch";
import { TopicManager, type TopicManagerLogger } from "./telegram/topicManager";
import { TelegramApi, redactToken } from "./telegram/api";
import { loadTelegramConfig } from "./telegram/config";
import { TelegramBridge } from "./telegram/bridge";
import { TranscriptionError } from "./openai/transcribe";
import { transcribeWithProvider, validateApiKey, type TranscriptionProvider } from "./transcription/providers";
import { getTranscriptionApiKey, setTranscriptionApiKey, getVoiceProvider, getAzureRegion } from "./transcription/config";
import { AudioRecorder } from "./transcription/recorder";
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
  private topicManager: TopicManager | null = null;
  private bridge: TelegramBridge | null = null;
  private recorder = new AudioRecorder();

  private async getOrCreateTopicManager(): Promise<TopicManager> {
    if (this.topicManager) return this.topicManager;

    const config = vscode.workspace.getConfiguration("gsd");
    const telegramConfig = await loadTelegramConfig(this.context.secrets, config);
    if (!telegramConfig) {
      throw new Error("Telegram not configured. Run /telegram setup first.");
    }

    const api = new TelegramApi(telegramConfig.botToken);
    const logger: TopicManagerLogger = {
      info: (msg: string) => this.output.appendLine(`[telegram-topic] ${msg}`),
      warn: (msg: string) => this.output.appendLine(`[telegram-topic] WARN: ${msg}`),
    };
    this.topicManager = new TopicManager(api, telegramConfig.chatId, vscode.env.machineId, logger, this.context.globalState);

    const bridgeLogger: TopicManagerLogger = {
      info: (msg: string) => this.output.appendLine(`[telegram-bridge] ${msg}`),
      warn: (msg: string) => this.output.appendLine(`[telegram-bridge] WARN: ${msg}`),
    };
    this.bridge = new TelegramBridge(
      api,
      this.topicManager,
      (sessionId: string) => {
        const s = this.sessions.get(sessionId);
        if (!s) return undefined;
        return { client: s.client, isStreaming: s.isStreaming };
      },
      bridgeLogger,
      telegramConfig.botToken,
      telegramConfig.chatId,
      async (audioBuffer: Buffer) => {
        const config = vscode.workspace.getConfiguration("gsd");
        const provider = getVoiceProvider(config);
        const apiKey = await getTranscriptionApiKey(this.context.secrets, provider);
        if (!apiKey) throw new TranscriptionError(`No API key set for voice provider "${provider}"`);
        const azureRegion = getAzureRegion(config);
        return transcribeWithProvider({ provider, apiKey, azureRegion }, audioBuffer, "voice.ogg");
      },
    );
    this.bridge.setStreamingGranularity(telegramConfig.streamingGranularity);
    this.bridge.setOnInboundMessage((sessionId, text, images) => {
      const session = this.sessions.get(sessionId);
      const webview = session?.webview;
      if (webview) {
        this.postToWebview(webview, {
          type: "telegram_user_message",
          text,
          images: images?.map(img => ({ type: "image" as const, data: img.data, mimeType: img.mimeType })),
        });
      }
    });

    return this.topicManager;
  }

  async handleTelegramSyncToggle(sessionId: string, webview: vscode.Webview): Promise<void> {
    let tm: TopicManager;
    try {
      tm = await this.getOrCreateTopicManager();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[telegram-sync] Config error: ${msg}`);
      vscode.window.showInformationMessage(msg);
      return;
    }

    const existing = tm.getTopicForSession(sessionId);
    try {
      if (existing !== undefined) {
        await tm.syncOff(sessionId);
        this.postToWebview(webview, { type: "state", data: { telegramSyncActive: false } } as any);
        this.output.appendLine(`[telegram-sync] Sync off for session ${sessionId}`);
        if (this.bridge && tm.activeSessions.length === 0) {
          this.bridge.stopPolling();
        }
      } else {
        const folderName = vscode.workspace.workspaceFolders?.[0]?.name ?? "Untitled";
        await tm.syncOn(sessionId, folderName);
        this.postToWebview(webview, { type: "state", data: { telegramSyncActive: true } } as any);
        this.output.appendLine(`[telegram-sync] Sync on for session ${sessionId}`);
        if (this.bridge) {
          this.bridge.startPolling();
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const config = vscode.workspace.getConfiguration("gsd");
      const telegramConfig = await loadTelegramConfig(this.context.secrets, config);
      const redacted = telegramConfig ? redactToken(msg, telegramConfig.botToken) : msg;
      this.output.appendLine(`[telegram-sync] Error: ${redacted}`);
    }
  }

  private async handleVoiceTranscription(audioBuffer: Buffer, webview: vscode.Webview): Promise<void> {
    try {
      const config = vscode.workspace.getConfiguration("gsd");
      const provider = getVoiceProvider(config);
      const apiKey = await getTranscriptionApiKey(this.context.secrets, provider);
      if (!apiKey) {
        this.postToWebview(webview, { type: "voice_error", message: `No API key set for ${provider}. Open voice settings to configure.` } as any);
        return;
      }
      const text = await transcribeWithProvider(
        { provider, apiKey, azureRegion: getAzureRegion(config) },
        audioBuffer,
      );
      this.postToWebview(webview, { type: "voice_transcription", text } as any);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[voice] Transcription error: ${msg}`);
      this.postToWebview(webview, { type: "voice_error", message: msg } as any);
    }
  }

  private async handleStartRecording(webview: vscode.Webview): Promise<void> {
    try {
      await this.recorder.start();
      this.postToWebview(webview, { type: "voice_recording_started" } as any);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[voice] Recording start error: ${msg}`);
      this.postToWebview(webview, { type: "voice_error", message: msg } as any);
    }
  }

  private async handleStopRecording(webview: vscode.Webview): Promise<void> {
    try {
      this.postToWebview(webview, { type: "voice_recording_stopped" } as any);
      const audioBuffer = await this.recorder.stop();
      await this.handleVoiceTranscription(audioBuffer, webview);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[voice] Recording stop error: ${msg}`);
      this.postToWebview(webview, { type: "voice_error", message: msg } as any);
    }
  }

  private async sendVoiceConfig(webview: vscode.Webview): Promise<void> {
    const config = vscode.workspace.getConfiguration("gsd");
    const provider = getVoiceProvider(config);
    const azureRegion = getAzureRegion(config);
    const [openaiKey, azureKey, xaiKey] = await Promise.all([
      getTranscriptionApiKey(this.context.secrets, "openai"),
      getTranscriptionApiKey(this.context.secrets, "azure"),
      getTranscriptionApiKey(this.context.secrets, "xai"),
    ]);
    this.postToWebview(webview, {
      type: "voice_config",
      provider,
      hasOpenaiKey: !!openaiKey,
      hasAzureKey: !!azureKey,
      hasXaiKey: !!xaiKey,
      azureRegion,
    } as any);
    const validations = await Promise.all([
      openaiKey ? validateApiKey("openai", openaiKey).catch(() => false) : Promise.resolve(undefined),
      azureKey ? validateApiKey("azure", azureKey, { azureRegion }).catch(() => false) : Promise.resolve(undefined),
      xaiKey ? validateApiKey("xai", xaiKey).catch(() => false) : Promise.resolve(undefined),
    ]);
    this.postToWebview(webview, {
      type: "voice_config",
      provider,
      hasOpenaiKey: !!openaiKey,
      hasAzureKey: !!azureKey,
      hasXaiKey: !!xaiKey,
      openaiKeyVerified: validations[0] as boolean | undefined,
      azureKeyVerified: validations[1] as boolean | undefined,
      xaiKeyVerified: validations[2] as boolean | undefined,
      azureRegion,
    } as any);
  }

  private async setVoiceProviderConfig(provider: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("gsd");
    await config.update("voiceTranscriptionProvider", provider, vscode.ConfigurationTarget.Global);
  }

  private async setVoiceApiKeyConfig(provider: string, key: string): Promise<void> {
    await setTranscriptionApiKey(this.context.secrets, provider as TranscriptionProvider, key);
  }

  private async setVoiceRegionConfig(regionType: "azure", value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) { return; }
    const config = vscode.workspace.getConfiguration("gsd");
    await config.update("azureSpeechRegion", trimmed, vscode.ConfigurationTarget.Global);
  }

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
      onAssistantMessage: (sessionId, text) => this.bridge?.handleAssistantMessage(sessionId, text),
      onStreamingChunk: (sessionId, delta) => this.bridge?.handleStreamingChunk(sessionId, delta),
      onStreamEnd: (sessionId, text) => this.bridge?.handleStreamEnd(sessionId, text),
      forwardQuestionToTelegram: (sessionId, requestId, title, options) =>
        this.bridge?.sendQuestion(sessionId, requestId, title, options) ?? Promise.resolve(null),
      cancelTelegramQuestion: (requestId) => this.bridge?.cancelQuestion(requestId),
      onToolStart: (sessionId, toolCallId, toolName, args) =>
        this.bridge?.handleToolStart(sessionId, toolCallId, toolName, args),
      onToolEnd: (_sessionId, toolCallId, isError, durationMs) =>
        this.bridge?.handleToolEnd(toolCallId, isError, durationMs),
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
      const { execFile } = require("child_process");
      const gsdPath = await new Promise<string>((resolve, reject) => {
        const bin = process.platform === "win32" ? "where" : "which";
        execFile(bin, ["gsd"], { encoding: "utf8", timeout: 5000, windowsHide: true },
          (err: Error | null, stdout: string) => { if (err) reject(err); else resolve(stdout); });
      }).then((out: string) => out.trim().split(/\r?\n/)[0]);
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

  async disposeAsync(): Promise<void> {
    this.bridge?.stopPolling();
    if (this.topicManager) {
      const DISPOSE_TIMEOUT_MS = 4000;
      try {
        await Promise.race([
          this.topicManager.disposeAll(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("disposeAll timed out")), DISPOSE_TIMEOUT_MS),
          ),
        ]);
      } catch (err) {
        this.output.appendLine(`[telegram-sync] dispose error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    for (const [, session] of this.sessions) {
      cleanupSessionState(session);
      if (session.panel) session.panel.dispose();
    }
    this.sessions.clear();
    this.output.dispose();
    this.cleanupTempFiles();
  }

  dispose(): void {
    // Capture the log message before disposeAsync() disposes this.output
    const logErr = (err: unknown) =>
      console.error(`[gsd] dispose error: ${err instanceof Error ? err.message : String(err)}`);
    this.disposeAsync().catch(logErr);
  }

  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.bridge?.clearStreamingState(sessionId);
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
      telegramSyncToggle: (sid, wv) => this.handleTelegramSyncToggle(sid, wv),
      cancelTelegramQuestion: (requestId) => this.bridge?.cancelQuestion(requestId),
      transcribeAudio: (buf, wv) => this.handleVoiceTranscription(buf, wv),
      startRecording: (wv) => this.handleStartRecording(wv),
      stopRecording: (wv) => this.handleStopRecording(wv),
      cancelRecording: () => this.recorder.cancel(),
      getVoiceConfig: (wv) => this.sendVoiceConfig(wv),
      setVoiceProvider: (p) => this.setVoiceProviderConfig(p),
      setVoiceApiKey: (p, k) => this.setVoiceApiKeyConfig(p, k),
      setVoiceRegion: (t, v) => this.setVoiceRegionConfig(t, v),
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

      const nonEmptyLines = parts.filter(line => line.trim());
      if (nonEmptyLines.length > 0) {
        this.output.appendLine(`[${sessionId}] stderr: ${nonEmptyLines.join("\n")}`);
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
      this.output.appendLine(`[${sessionId}] Process error: ${toErrorMessage(err)}`);
      const currentWebview = this.getSession(sessionId).webview ?? webview;
      this.postToWebview(currentWebview, { type: "process_exit", code: null, signal: null, detail: `Failed to start GSD: ${toErrorMessage(err)}` });
      this.postToWebview(currentWebview, { type: "process_status", status: "crashed" } as ExtensionToWebviewMessage);

      // T05: Clean up timers on error too (mirrors exit handler)
      this._cleanupTimersAndWatchdogs(sessionId);
    });
  }

  /** Stop all monitoring timers, watchdogs, and reset streaming state for a session. */
  private _cleanupTimersAndWatchdogs(sessionId: string): void {
    stopAllPolling(this.pollingCtx, sessionId);
    this.bridge?.clearStreamingState(sessionId);
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
    const env: Record<string, string> = {
      // Skip Claude Code permission gates — prompts in the IDE context are surfaced
      // through the GSD webview, but the elicitation flow is unreliable. Bypass
      // permissions entirely so tools are never silently denied.
      GSD_CLAUDE_CODE_PERMISSION_MODE: "bypassPermissions",
    };
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
      } catch (initErr: unknown) {
        this.output.appendLine(`[${sessionId}] v2 init failed (using v1): ${toErrorMessage(initErr)}`);
      }

      const autoPoller = new AutoProgressPoller(
        sessionId, client, webview, () => workingDir, this.output,
        (oldModel, newModel) => {
          const currentWebview = this.getSession(sessionId).webview ?? webview;
          this.postToWebview(currentWebview, { type: "model_routed", oldModel, newModel } as ExtensionToWebviewMessage);
        },
      );
      this.getSession(sessionId).autoProgressPoller = autoPoller;

      try {
        const rpcState = await client.getState() as RpcStateResult;
        this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
        const gsdState = toGsdState(rpcState);
        gsdState.telegramSyncActive = this.topicManager?.getTopicForSession(sessionId) !== undefined;
        this.postToWebview(webview, { type: "state", data: gsdState } as ExtensionToWebviewMessage);
        if (rpcState?.model) this.emitStatus({ model: rpcState.model.id || rpcState.model.name });
      } catch (err: unknown) {
        this.output.appendLine(`[${sessionId}] Initial getState failed: ${toErrorMessage(err)}`);
        this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);
      }

      try {
        const cmdResult = await client.getCommands() as RpcCommandsResult;
        this.postToWebview(webview, { type: "commands", commands: cmdResult?.commands || [] });
      } catch (err: unknown) {
        this.output.appendLine(`[${sessionId}] Initial get_commands failed: ${toErrorMessage(err)}`);
      }

      startStatsPolling(this.pollingCtx, webview, sessionId);
      startHealthMonitoring(this.pollingCtx, webview, sessionId);
      startWorkflowPolling(this.pollingCtx, webview, sessionId);
    } catch (err: unknown) {
      this.postToWebview(webview, {
        type: "process_exit", code: null, signal: null,
        detail: `Failed to start GSD: ${toErrorMessage(err)}. Make sure 'gsd' is installed and in your PATH.`,
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
