import * as vscode from "vscode";
import { GsdWebviewProvider } from "./webview-provider";
import { startUpdateChecker } from "./update-checker";
import { runHealthCheck } from "./health-check";
import { runTelegramSetup, updateTelegramStatusBar } from "./telegram/setup";
import { getOpenAiApiKey, setOpenAiApiKey } from "./openai/config";

// ============================================================
// Extension Entry Point
// ============================================================

let provider: GsdWebviewProvider;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("GSD");
  const output = outputChannel;
  output.appendLine("GSD extension activating...");

  provider = new GsdWebviewProvider(context.extensionUri, context);

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusBarItem.command = "gsd.open";
  statusBarItem.text = "$(rocket) Rokket GSD";
  statusBarItem.tooltip = "Open Rokket GSD";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Wire up status updates from the provider
  provider.onStatusUpdate((status) => {
    if (status.isStreaming) {
      statusBarItem.text = "$(loading~spin) Rokket GSD";
      statusBarItem.tooltip = `Rokket GSD: Working...${status.cost ? ` ($${status.cost.toFixed(3)})` : ""}`;
    } else if (status.model) {
      const costStr = status.cost ? ` • $${status.cost.toFixed(3)}` : "";
      statusBarItem.text = `$(rocket) Rokket GSD`;
      statusBarItem.tooltip = `Rokket GSD: ${status.model}${costStr}`;
    } else {
      statusBarItem.text = "$(rocket) Rokket GSD";
      statusBarItem.tooltip = "Open Rokket GSD";
    }
  });

  // Register sidebar webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GsdWebviewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("gsd.open", () => {
      const preferred = vscode.workspace
        .getConfiguration("gsd")
        .get<string>("preferredLocation", "panel");

      if (preferred === "sidebar") {
        vscode.commands.executeCommand("gsd.openInSidebar");
      } else {
        vscode.commands.executeCommand("gsd.openInTab");
      }
    }),

    vscode.commands.registerCommand("gsd.openInTab", () => {
      provider.openInTab();
    }),

    vscode.commands.registerCommand("gsd.openInSidebar", () => {
      vscode.commands.executeCommand("gsd-sidebar.focus");
    }),

    vscode.commands.registerCommand("gsd.newConversation", () => {
      provider.newConversation();
    }),

    vscode.commands.registerCommand("gsd.focus", () => {
      provider.focus();
    }),

    vscode.commands.registerCommand("gsd.exportReport", () => {
      provider.exportReport();
    }),

    vscode.commands.registerCommand("gsd.telegramSetup", () => runTelegramSetup(context)),

    vscode.commands.registerCommand("gsd.setOpenAiApiKey", async () => {
      const existing = await getOpenAiApiKey(context.secrets);
      const proceed = await vscode.window.showInformationMessage(
        existing ? "Replace OpenAI API Key" : "Set Up Voice Transcription",
        {
          modal: true,
          detail: existing
            ? "You already have an OpenAI API key stored. Enter a new key to replace it."
            : "Voice transcription lets you send voice messages from Telegram " +
              "and have them automatically transcribed using OpenAI Whisper.\n\n" +
              "You need an OpenAI API key with some credit on it:\n" +
              "1. Go to platform.openai.com and sign up (or log in)\n" +
              "2. Go to API keys and create a new key\n" +
              "3. Add credit to your account (even $5 will last a very long time)\n" +
              "4. Copy the key — you'll paste it in the next step\n\n" +
              "Cost: Whisper transcription costs approximately $0.006 per minute " +
              "of audio — a 1-minute voice message costs less than a cent.\n\n" +
              "The key is stored securely in your OS keychain and never leaves your machine.",
        },
        "Continue",
      );
      if (proceed !== "Continue") return;

      const key = await vscode.window.showInputBox({
        title: "Paste your OpenAI API key",
        prompt: "This key is stored securely in your OS keychain and never leaves your machine",
        placeHolder: "sk-...",
        password: true,
        ignoreFocusOut: true,
      });
      if (!key || !key.trim()) return;
      await setOpenAiApiKey(context.secrets, key.trim());
      vscode.window.showInformationMessage("OpenAI API key saved — voice transcription is ready!");
    })
  );

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gsd")) {
        output.appendLine("GSD configuration changed");
        provider.onConfigChanged();
        if (e.affectsConfiguration("gsd.telegram")) {
          updateTelegramStatusBar(statusBarItem, context);
        }
      }
    })
  );

  // Check Telegram config and update status bar
  updateTelegramStatusBar(statusBarItem, context);

  // Run startup health check (non-blocking)
  runHealthCheck(output);

  // Check for updates from GitHub Releases
  startUpdateChecker(context, provider);

  output.appendLine("GSD extension activated");
}

export async function deactivate(): Promise<void> {
  if (provider) {
    await provider.disposeAsync();
  }
  statusBarItem?.dispose();
  outputChannel?.dispose();
}
