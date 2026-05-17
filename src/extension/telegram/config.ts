import type * as vscode from "vscode";

export interface TelegramConfig {
  botToken: string;
  botUsername: string;
  chatId: number;
  chatTitle: string;
  streamingGranularity: "off" | "throttled" | "final-only";
  ownerId: number;
  projectSearchDirs: string[];
}

const SECRET_KEY = "gsd.telegramBotToken";

export async function loadTelegramConfig(
  secrets: vscode.SecretStorage,
  config: vscode.WorkspaceConfiguration,
): Promise<TelegramConfig | null> {
  const botToken = await secrets.get(SECRET_KEY);
  if (!botToken) return null;

  const chatId = config.get<number>("telegramGroupId");
  if (chatId === undefined || chatId === 0) return null;

  return {
    botToken,
    botUsername: config.get<string>("telegramBotUsername", ""),
    chatId,
    chatTitle: config.get<string>("telegramChatTitle", ""),
    streamingGranularity: config.get<"off" | "throttled" | "final-only">("telegramStreamingGranularity", "throttled")!,
    ownerId: config.get<number>("telegramOwnerId", 0),
    projectSearchDirs: config.get<string[]>("telegramProjectDirs", []),
  };
}

export async function saveTelegramConfig(
  secrets: vscode.SecretStorage,
  config: vscode.WorkspaceConfiguration,
  telegramConfig: TelegramConfig,
  configTarget: vscode.ConfigurationTarget,
): Promise<void> {
  await secrets.store(SECRET_KEY, telegramConfig.botToken);
  await config.update("telegramGroupId", telegramConfig.chatId, configTarget);
  await config.update("telegramChatTitle", telegramConfig.chatTitle, configTarget);
  await config.update("telegramBotUsername", telegramConfig.botUsername, configTarget);
  await config.update("telegramStreamingGranularity", telegramConfig.streamingGranularity, configTarget);
  if (telegramConfig.ownerId) await config.update("telegramOwnerId", telegramConfig.ownerId, configTarget);
}

export async function clearTelegramConfig(
  secrets: vscode.SecretStorage,
  config: vscode.WorkspaceConfiguration,
  configTarget: vscode.ConfigurationTarget,
): Promise<void> {
  await secrets.delete(SECRET_KEY);
  await config.update("telegramGroupId", undefined, configTarget);
  await config.update("telegramChatTitle", undefined, configTarget);
  await config.update("telegramBotUsername", undefined, configTarget);
  await config.update("telegramStreamingGranularity", undefined, configTarget);
  await config.update("telegramOwnerId", undefined, configTarget);
}
