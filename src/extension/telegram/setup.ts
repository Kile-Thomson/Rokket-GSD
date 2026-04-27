import * as vscode from "vscode";
import { TelegramApi, redactToken } from "./api";
import type { TelegramConfig } from "./config";
import { saveTelegramConfig, loadTelegramConfig } from "./config";

async function showStepModal(
  step: number,
  totalSteps: number,
  title: string,
  detail: string,
): Promise<boolean> {
  const result = await vscode.window.showInformationMessage(
    `[Step ${step}/${totalSteps}] ${title}`,
    { modal: true, detail },
    "Continue",
  );
  return result === "Continue";
}

export async function runTelegramSetup(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("GSD", { log: true });
  output.appendLine("[telegram-setup] Starting Telegram setup wizard");

  const totalSteps = 3;

  // --- Step 1: Bot Token ---
  const step1 = await showStepModal(
    1,
    totalSteps,
    "Create a Telegram Bot",
    "First, you need a Telegram bot token from @BotFather.\n\n" +
      "How to get one:\n" +
      "1. Open Telegram on your phone or desktop\n" +
      "2. Search for @BotFather (the official Telegram bot manager)\n" +
      "3. Start a chat and send: /newbot\n" +
      "4. BotFather will ask for a display name — enter anything (e.g. \"My GSD Bot\")\n" +
      "5. Then it asks for a username — must end in \"bot\" (e.g. \"my_gsd_bot\")\n" +
      "6. BotFather will reply with a token like: 123456789:ABCdefGHI...\n" +
      "7. Copy that token — you'll paste it in the next step\n\n" +
      "If you already have a bot token, just click Continue.",
  );
  if (!step1) return;

  const token = await vscode.window.showInputBox({
    title: "Step 1/3 — Paste your bot token",
    prompt: "Paste the bot token from @BotFather",
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

  // --- Step 2: Link the group ---
  const step2 = await showStepModal(
    2,
    totalSteps,
    "Link Your Telegram Group",
    `Your bot @${me.username ?? me.first_name} is valid!\n\n` +
      "Now you need to connect it to a Telegram group:\n\n" +
      "1. CREATE A GROUP: Open Telegram → New Group → add your bot as a member → name it anything\n" +
      "2. MAKE IT A SUPERGROUP: Open group info → Edit → toggle \"Chat History for New Members\" to ON. " +
      "This upgrades the group to a supergroup, which is required for full bot functionality.\n" +
      "3. MAKE THE BOT AN ADMIN:\n" +
      "   • Mobile: Open group info → tap \"Administrators\" → \"Add Admin\" → select your bot\n" +
      "   • Desktop: Open group info → click \"Administrators\" → \"Add Admin\" → select your bot\n" +
      "4. SEND A MESSAGE: Type anything in the group (this is how the extension detects the group)\n\n" +
      "After you click Continue, the extension will listen for 3 minutes " +
      "for a message in the group. Take your time — there's no rush.",
  );
  if (!step2) return;

  const chatResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Waiting for a message in your Telegram group... (up to 3 minutes)",
      cancellable: true,
    },
    async (progress, cancellation) => {
      const deadline = Date.now() + 180_000;
      let updateOffset: number | undefined;

      while (Date.now() < deadline) {
        if (cancellation.isCancellationRequested) {
          output.appendLine("[telegram-setup] User cancelled group detection");
          return null;
        }

        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        progress.report({
          message: `Send a message in your group... (${remaining}s remaining)`,
        });

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
      title: "Group detection timed out",
      prompt:
        "No message was detected. Enter the group chat ID manually, or press Escape to cancel. " +
        "(Tip: add @RawDataBot to your group temporarily — it will show you the chat ID.)",
      placeHolder: "-1001234567890",
      ignoreFocusOut: true,
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
  // --- Step 3: Verify & Save ---
  output.appendLine("[telegram-setup] Verifying bot admin permissions...");
  try {
    const member = await api.getChatMember(chatId, me.id);
    if (member.status !== "administrator" && member.status !== "creator") {
      output.appendLine(`[telegram-setup] Bot status is "${member.status}" — not admin`);
      await vscode.window.showWarningMessage(
        `Your bot is "${member.status}" in the group. It needs administrator permissions for full functionality.\n\n` +
          "To fix this:\n" +
          "• Mobile: Open group info → Administrators → Add Admin → select your bot\n" +
          "• Desktop: Open group info → Administrators → Add Admin → select your bot\n\n" +
          "If you can't find the Administrators option, make sure your group is a supergroup " +
          "(open group info → Edit → enable \"Chat History for New Members\").",
        { modal: true },
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

  const groupLabel = chatTitle ? ` "${chatTitle}"` : "";
  const voiceChoice = await vscode.window.showInformationMessage(
    `Telegram setup complete! Bot is connected to${groupLabel}.`,
    {
      modal: true,
      detail:
        "You can now stream GSD sessions to Telegram.\n\n" +
        "Optional: Set up voice transcription so you can send voice messages " +
        "from Telegram and have them transcribed automatically.\n\n" +
        "This requires an OpenAI API key and a small amount of credit " +
        "(Whisper costs ~$0.006 per minute of audio — extremely cheap). " +
        "You can get an API key at platform.openai.com.",
    },
    "Set Up Voice Now",
    "Skip for Now",
  );

  if (voiceChoice === "Set Up Voice Now") {
    await vscode.commands.executeCommand("gsd.setOpenAiApiKey");
  }
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
