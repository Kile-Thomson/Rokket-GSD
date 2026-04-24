import * as vscode from "vscode";
import { TelegramApi, redactToken } from "./api";
import type { TelegramConfig } from "./config";
import { saveTelegramConfig, loadTelegramConfig } from "./config";

export async function runTelegramSetup(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("GSD", { log: true });
  output.appendLine("[telegram-setup] Starting Telegram setup wizard");

  const token = await vscode.window.showInputBox({
    prompt: "Enter your Telegram bot token from @BotFather",
    placeHolder: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ",
    password: true,
    ignoreFocusOut: true,
  });

  if (!token) {
    output.appendLine("[telegram-setup] User cancelled token input");
    return;
  }

  const api = new TelegramApi(token);

  const me = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Validating bot token..." },
    async () => {
      try {
        return await api.getMe();
      } catch (err: unknown) {
        const msg = err instanceof Error ? redactToken(err.message, token) : "Unknown error";
        output.appendLine(`[telegram-setup] Token validation failed: ${msg}`);
        vscode.window.showErrorMessage(`Telegram setup failed: ${msg}`);
        return null;
      }
    },
  );

  if (!me) return;

  output.appendLine(`[telegram-setup] Bot authenticated: @${me.username ?? me.first_name}`);

  vscode.window.showInformationMessage(
    "Bot token valid! Now send any message in your Telegram group so the bot can detect it.",
  );

  const chatResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Waiting for a message in your Telegram group...",
      cancellable: true,
    },
    async (progress, cancellation) => {
      const deadline = Date.now() + 60_000;
      let updateOffset: number | undefined;

      while (Date.now() < deadline) {
        if (cancellation.isCancellationRequested) {
          output.appendLine("[telegram-setup] User cancelled group detection");
          return null;
        }

        try {
          const updates = await api.getUpdates(updateOffset);
          for (const update of updates) {
            updateOffset = update.update_id + 1;
            if (update.message?.chat) {
              return {
                chatId: update.message.chat.id,
                chatTitle: update.message.chat.title ?? "",
              };
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? redactToken(err.message, token) : "Unknown error";
          output.appendLine(`[telegram-setup] getUpdates error: ${msg}`);
        }

        await new Promise((r) => setTimeout(r, 2_000));
      }

      return null;
    },
  );

  if (!chatResult) {
    output.appendLine("[telegram-setup] Group detection timed out or cancelled");

    const manualId = await vscode.window.showInputBox({
      prompt: "Group detection timed out. Enter the group chat ID manually, or press Escape to cancel.",
      placeHolder: "-1001234567890",
    });

    if (!manualId) return;

    const parsed = parseInt(manualId, 10);
    if (isNaN(parsed)) {
      vscode.window.showErrorMessage("Invalid group ID. Please run setup again.");
      return;
    }

    await finishSetup(context, output, api, token, me, parsed, "");
    return;
  }

  output.appendLine(`[telegram-setup] Detected chat: "${chatResult.chatTitle}" (${chatResult.chatId})`);
  await finishSetup(context, output, api, token, me, chatResult.chatId, chatResult.chatTitle);
}

async function finishSetup(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  api: TelegramApi,
  token: string,
  me: { id: number; username?: string; first_name: string },
  chatId: number,
  chatTitle: string,
): Promise<void> {
  output.appendLine("[telegram-setup] Verifying bot admin permissions...");
  try {
    const member = await api.getChatMember(chatId, me.id);
    if (member.status !== "administrator" && member.status !== "creator") {
      output.appendLine(`[telegram-setup] Bot status is "${member.status}" — not admin`);
      await vscode.window.showWarningMessage(
        `Bot is "${member.status}" in the group — it may need administrator permissions for full functionality.`,
      );
    } else {
      output.appendLine("[telegram-setup] Bot has admin permissions");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? redactToken(err.message, token) : "Unknown error";
    output.appendLine(`[telegram-setup] Admin check failed: ${msg}`);
  }

  output.appendLine("[telegram-setup] Sending test message...");
  try {
    await api.sendMessage(chatId, "✅ GSD Telegram bot connected!");
  } catch (err: unknown) {
    const msg = err instanceof Error ? redactToken(err.message, token) : "Unknown error";
    output.appendLine(`[telegram-setup] Test message failed: ${msg}`);
  }

  const config = vscode.workspace.getConfiguration("gsd");
  const telegramCfg: TelegramConfig = {
    botToken: token,
    botUsername: me.username ?? me.first_name,
    chatId,
    chatTitle,
    streamingGranularity: "throttled",
  };
  await saveTelegramConfig(
    context.secrets,
    config,
    telegramCfg,
    vscode.ConfigurationTarget.Global,
  );

  output.appendLine("[telegram-setup] Config saved successfully");
  vscode.window.showInformationMessage("Telegram setup complete! Bot is connected.");
}

export async function updateTelegramStatusBar(
  statusBarItem: vscode.StatusBarItem,
  context: vscode.ExtensionContext,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("gsd");
  const telegramConfig = await loadTelegramConfig(context.secrets, config);
  if (telegramConfig) {
    statusBarItem.tooltip = `${statusBarItem.tooltip ?? "Rokket GSD"}\n$(comment-discussion) Telegram: Connected`;
  }
}
