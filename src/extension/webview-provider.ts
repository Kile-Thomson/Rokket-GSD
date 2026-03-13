import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { GsdRpcClient } from "./rpc-client";
import { listSessions, deleteSession } from "./session-list-service";
import { downloadAndInstallUpdate, dismissUpdateVersion } from "./update-checker";
import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
  SessionStats,
  SessionListItem,
  RpcCommandsResult,
  RpcModelsResult,
  RpcThinkingResult,
  RpcExportResult,
  RpcStateResult,
  BashResult,
  AgentMessage,
  ProcessHealthStatus,
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
  private panels: Map<string, vscode.WebviewPanel> = new Map();
  private rpcClients: Map<string, GsdRpcClient> = new Map();
  private statsTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private healthTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private healthState: Map<string, ProcessHealthStatus> = new Map();
  private sessionWebviews: Map<string, vscode.Webview> = new Map();
  private output: vscode.OutputChannel;
  private sessionCounter = 0;
  private gsdVersion: string | undefined;
  private statusCallback?: (status: StatusBarUpdate) => void;
  private lastStatus: StatusBarUpdate = { isStreaming: false };

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
    const sessionId = `sidebar-${++this.sessionCounter}`;

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

    this.panels.set(sessionId, panel);

    panel.webview.html = this.getWebviewHtml(panel.webview, sessionId);
    this.setupWebviewMessageHandling(panel.webview, sessionId);

    panel.onDidDispose(() => {
      this.panels.delete(sessionId);
      this.cleanupSession(sessionId);
    });
  }

  // --- Focus ---

  focus(): void {
    if (this.webviewView) {
      this.webviewView.show(true);
    }
    this.broadcastToAll({ type: "config", useCtrlEnterToSend: this.getUseCtrlEnter() } as ExtensionToWebviewMessage);
  }

  // --- New conversation ---

  async newConversation(): Promise<void> {
    for (const [sessionId, client] of this.rpcClients) {
      if (client.isRunning) {
        try {
          await client.newSession();
        } catch (err) {
          this.output.appendLine(`Error creating new session: ${err}`);
        }
      }
    }
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
    for (const [_, timer] of this.statsTimers) {
      clearInterval(timer);
    }
    this.statsTimers.clear();
    for (const [_, timer] of this.healthTimers) {
      clearInterval(timer);
    }
    this.healthTimers.clear();
    for (const [_, client] of this.rpcClients) {
      client.stop();
    }
    this.rpcClients.clear();
    for (const [_, panel] of this.panels) {
      panel.dispose();
    }
    this.panels.clear();
    this.output.dispose();
  }

  private cleanupSession(sessionId: string): void {
    const timer = this.statsTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.statsTimers.delete(sessionId);
    }
    const healthTimer = this.healthTimers.get(sessionId);
    if (healthTimer) {
      clearInterval(healthTimer);
      this.healthTimers.delete(sessionId);
    }
    this.healthState.delete(sessionId);
    const client = this.rpcClients.get(sessionId);
    if (client) {
      client.stop();
      this.rpcClients.delete(sessionId);
    }
    this.sessionWebviews.delete(sessionId);
  }

  // --- Session stats polling ---

  private startStatsPolling(webview: vscode.Webview, sessionId: string): void {
    // Clear any existing timer
    const existing = this.statsTimers.get(sessionId);
    if (existing) clearInterval(existing);

    const poll = async () => {
      const client = this.rpcClients.get(sessionId);
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
    this.statsTimers.set(sessionId, timer);

    // Immediate first poll
    poll();
  }

  // --- Health Monitoring ---

  private startHealthMonitoring(webview: vscode.Webview, sessionId: string): void {
    // Clear any existing timer
    const existing = this.healthTimers.get(sessionId);
    if (existing) clearInterval(existing);

    this.healthState.set(sessionId, "responsive");

    const check = async () => {
      const client = this.rpcClients.get(sessionId);
      if (!client?.isRunning) return;

      // Only health-check while streaming (tool execution in progress)
      // During idle, the process is just waiting for input — no need to ping
      const isHealthy = await client.ping(10000);
      const previousState = this.healthState.get(sessionId) || "responsive";

      if (!isHealthy && previousState === "responsive") {
        // Process became unresponsive
        this.healthState.set(sessionId, "unresponsive");
        this.output.appendLine(`[${sessionId}] Health check: UNRESPONSIVE (ping timed out)`);
        this.postToWebview(webview, { type: "process_health", status: "unresponsive" } as ExtensionToWebviewMessage);
      } else if (isHealthy && previousState === "unresponsive") {
        // Process recovered
        this.healthState.set(sessionId, "recovered");
        this.output.appendLine(`[${sessionId}] Health check: recovered`);
        this.postToWebview(webview, { type: "process_health", status: "recovered" } as ExtensionToWebviewMessage);
        // Reset to responsive after emitting recovered
        this.healthState.set(sessionId, "responsive");
      }
    };

    // Check every 30 seconds
    const timer = setInterval(check, 30000);
    this.healthTimers.set(sessionId, timer);
  }

  // --- Message handling ---

  private setupWebviewMessageHandling(webview: vscode.Webview, sessionId: string): void {
    this.sessionWebviews.set(sessionId, webview);

    webview.onDidReceiveMessage(async (msg: WebviewToExtensionMessage) => {
      this.output.appendLine(`[${sessionId}] Webview -> Extension: ${msg.type}`);

      switch (msg.type) {
        case "ready": {
          const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
          this.postToWebview(webview, {
            type: "config",
            useCtrlEnterToSend: this.getUseCtrlEnter(),
            cwd,
            version: this.gsdVersion,
          });
          break;
        }

        case "launch_gsd": {
          await this.launchGsd(webview, sessionId, msg.cwd);
          break;
        }

        case "prompt": {
          let client = this.rpcClients.get(sessionId);

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
                  } catch {}
                } else {
                  this.rpcClients.delete(sessionId);
                  await this.launchGsd(webview, sessionId);
                }
              } catch (restartErr: any) {
                this.output.appendLine(`[${sessionId}] Restart failed: ${restartErr.message}`);
                this.rpcClients.delete(sessionId);
                await this.launchGsd(webview, sessionId);
              }
            } else {
              await this.launchGsd(webview, sessionId);
            }
          }

          const c = this.rpcClients.get(sessionId);
          if (c?.isRunning) {
            try {
              const images = msg.images?.map((img) => ({
                type: "image" as const,
                data: img.data,
                mimeType: img.mimeType,
              }));
              await c.prompt(msg.message, images);
            } catch (err: any) {
              if (err.message?.includes("streaming")) {
                try {
                  await c.steer(msg.message, msg.images?.map((img) => ({
                    type: "image" as const,
                    data: img.data,
                    mimeType: img.mimeType,
                  })));
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
          const client = this.rpcClients.get(sessionId);
          if (client) {
            try {
              await client.steer(msg.message, msg.images?.map((img) => ({
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

        case "follow_up": {
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
          if (client) {
            try {
              await client.abort();
            } catch {}
          }
          break;
        }

        case "new_conversation": {
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
          if (client) {
            try {
              await client.setThinkingLevel(msg.level);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "get_state": {
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
          if (client?.isRunning) {
            try {
              const stats = await client.getSessionStats() as SessionStats | null;
              if (stats) {
                this.postToWebview(webview, { type: "session_stats", data: stats } as ExtensionToWebviewMessage);
              }
            } catch {}
          }
          break;
        }

        case "get_commands": {
          const client = this.rpcClients.get(sessionId);
          if (client?.isRunning) {
            try {
              const result = await client.getCommands() as RpcCommandsResult;
              this.postToWebview(webview, { type: "commands", commands: result?.commands || [] });
            } catch {}
          }
          break;
        }

        case "get_available_models": {
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
          if (client?.isRunning) {
            try {
              const result = await client.exportHtml() as RpcExportResult;
              if (result?.path) {
                const doc = await vscode.workspace.openTextDocument(result.path);
                await vscode.window.showTextDocument(doc, { preview: true });
                vscode.window.showInformationMessage(`Conversation exported to ${result.path}`);
              }
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: `Export failed: ${err.message}` });
            }
          }
          break;
        }

        case "run_bash": {
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
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
          const client = this.rpcClients.get(sessionId);
          if (client?.isRunning) {
            try {
              await client.setAutoCompaction(msg.enabled);
            } catch (err: any) {
              this.postToWebview(webview, { type: "error", message: err.message });
            }
          }
          break;
        }

        case "force_kill": {
          const client = this.rpcClients.get(sessionId);
          if (client) {
            this.output.appendLine(`[${sessionId}] Force-killing GSD process (PID: ${client.pid})`);
            client.forceKill();
          }
          break;
        }

        case "force_restart": {
          const client = this.rpcClients.get(sessionId);
          if (client) {
            this.output.appendLine(`[${sessionId}] Force-restarting GSD process`);
            client.forceKill();
            // Clean up existing timers before restart
            this.cleanupSession(sessionId);
            // Wait a moment for cleanup, then re-launch from scratch
            setTimeout(async () => {
              try {
                this.rpcClients.delete(sessionId);
                await this.launchGsd(webview, sessionId);
                this.output.appendLine(`[${sessionId}] GSD re-launched after force-kill`);
              } catch (err: any) {
                this.output.appendLine(`[${sessionId}] Force-restart failed: ${err.message}`);
                this.postToWebview(webview, { type: "error", message: `Force-restart failed: ${err.message}` });
              }
            }, 1000);
          }
          break;
        }

        case "update_install": {
          await downloadAndInstallUpdate(msg.downloadUrl, this.context);
          break;
        }

        case "update_dismiss": {
          await dismissUpdateVersion(msg.version, this.context);
          break;
        }

        case "update_view_release": {
          vscode.env.openExternal(vscode.Uri.parse(msg.htmlUrl));
          break;
        }

        case "extension_ui_response": {
          const client = this.rpcClients.get(sessionId);
          if (client) {
            client.sendExtensionUiResponse({
              type: "extension_ui_response",
              id: msg.id,
              value: msg.value,
              confirmed: msg.confirmed,
              cancelled: msg.cancelled,
            });
          }
          break;
        }

        case "copy_text": {
          await vscode.env.clipboard.writeText(msg.text);
          break;
        }

        case "open_file": {
          try {
            const doc = await vscode.workspace.openTextDocument(msg.path);
            await vscode.window.showTextDocument(doc);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
          }
          break;
        }

        case "open_url": {
          vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;
        }

        case "open_diff": {
          try {
            const left = vscode.Uri.file(msg.leftPath);
            const right = vscode.Uri.file(msg.rightPath);
            await vscode.commands.executeCommand("vscode.diff", left, right);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open diff: ${err.message}`);
          }
          break;
        }
      }
    });
  }

  // --- GSD Process Management ---

  private async launchGsd(webview: vscode.Webview, sessionId: string, cwd?: string): Promise<void> {
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
      this.postToWebview(webview, { type: "process_status", status: "crashed" } as ExtensionToWebviewMessage);

      // Stop stats polling and health monitoring
      const timer = this.statsTimers.get(sessionId);
      if (timer) {
        clearInterval(timer);
        this.statsTimers.delete(sessionId);
      }
      const healthTimer = this.healthTimers.get(sessionId);
      if (healthTimer) {
        clearInterval(healthTimer);
        this.healthTimers.delete(sessionId);
      }
      this.healthState.delete(sessionId);

      if (signal !== "SIGTERM" && signal !== "SIGKILL") {
        this.output.appendLine(`[${sessionId}] Unexpected exit — will auto-restart on next prompt`);
      } else {
        this.rpcClients.delete(sessionId);
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

      this.rpcClients.set(sessionId, client);
      this.output.appendLine(`[${sessionId}] GSD started in ${workingDir}`);

      this.postToWebview(webview, { type: "process_status", status: "running" } as ExtensionToWebviewMessage);

      // Get initial state
      try {
        const rpcState = await client.getState() as RpcStateResult;
        this.postToWebview(webview, { type: "state", data: rpcState } as ExtensionToWebviewMessage);
        if (rpcState?.model) {
          this.emitStatus({ model: rpcState.model.id || rpcState.model.name });
        }
      } catch {}

      // Start stats polling and health monitoring
      this.startStatsPolling(webview, sessionId);
      this.startHealthMonitoring(webview, sessionId);
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
      this.emitStatus({ isStreaming: true });
    } else if (eventType === "agent_end") {
      this.emitStatus({ isStreaming: false });
    } else if (eventType === "message_end") {
      const msg = event.message;
      const usage = msg?.usage as { cost?: { total?: number } } | undefined;
      if (msg?.role === "assistant" && usage?.cost?.total) {
        this.emitStatus({ cost: (this.lastStatus.cost || 0) + usage.cost.total });
      }
    }

    // Forward all other events directly to the webview
    this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
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

        // Forward to webview — chat is the primary notification surface
        this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
        break;
      }

      case "setStatus":
      case "setWidget":
      case "set_editor_text": {
        this.postToWebview(webview, event as unknown as ExtensionToWebviewMessage);
        break;
      }

      case "setTitle": {
        const title = event.title as string;
        for (const [sid, panel] of this.panels) {
          if (sid === sessionId && title) {
            panel.title = title;
          }
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
    for (const [_, panel] of this.panels) {
      panel.webview.postMessage(message);
      delivered = true;
    }
    return delivered;
  }

  private getUseCtrlEnter(): boolean {
    return vscode.workspace.getConfiguration("gsd").get<boolean>("useCtrlEnterToSend", false);
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
    window.GSD_SESSION_ID = "${sessionId}";
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
