import * as vscode from "vscode";
import { GsdWebviewProvider } from "./webview-provider";
import { startUpdateChecker } from "./update-checker";
import { runHealthCheck } from "./health-check";

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
    })
  );

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gsd")) {
        output.appendLine("GSD configuration changed");
        provider.onConfigChanged();
      }
    })
  );

  // Run startup health check (non-blocking)
  runHealthCheck(output);

  // Check for updates from GitHub Releases
  startUpdateChecker(context, provider);

  output.appendLine("GSD extension activated");
}

export function deactivate(): void {
  provider?.dispose();
  statusBarItem?.dispose();
  outputChannel?.dispose();
}
