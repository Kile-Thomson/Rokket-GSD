import { describe, it, expect, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { loadTelegramConfig, saveTelegramConfig, clearTelegramConfig, type TelegramConfig } from "./config";

function createMockSecretStorage() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    keys: async () => [...store.keys()],
    onDidChange: undefined as never,
  } as unknown as vscode.SecretStorage;
}

function createMockWorkspaceConfig(): vscode.WorkspaceConfiguration {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return values.has(key) ? (values.get(key) as T) : defaultValue;
    },
    has(key: string) { return values.has(key); },
    inspect() { return undefined; },
    async update(key: string, value: unknown, _target?: unknown) {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    },
  } as vscode.WorkspaceConfiguration;
}

const GLOBAL_TARGET = 1 as unknown as vscode.ConfigurationTarget;

const SAMPLE_CONFIG: TelegramConfig = {
  botToken: "123456:ABC-DEF",
  botUsername: "test_bot",
  chatId: -1001234567890,
  chatTitle: "Test Group",
  streamingGranularity: "throttled",
};

describe("TelegramConfig", () => {
  let secrets: vscode.SecretStorage;
  let config: vscode.WorkspaceConfiguration;

  beforeEach(() => {
    secrets = createMockSecretStorage();
    config = createMockWorkspaceConfig();
  });

  it("loadTelegramConfig returns null when no config exists", async () => {
    const result = await loadTelegramConfig(secrets, config);
    expect(result).toBeNull();
  });

  it("loadTelegramConfig returns null when token exists but no chatId", async () => {
    await secrets.store("gsd.telegramBotToken", "123:ABC");
    const result = await loadTelegramConfig(secrets, config);
    expect(result).toBeNull();
  });

  it("saveTelegramConfig persists token to secrets and fields to config", async () => {
    await saveTelegramConfig(secrets, config, SAMPLE_CONFIG, GLOBAL_TARGET);

    expect(await secrets.get("gsd.telegramBotToken")).toBe(SAMPLE_CONFIG.botToken);
    expect(config.get("telegramGroupId")).toBe(SAMPLE_CONFIG.chatId);
    expect(config.get("telegramChatTitle")).toBe(SAMPLE_CONFIG.chatTitle);
    expect(config.get("telegramBotUsername")).toBe(SAMPLE_CONFIG.botUsername);
  });

  it("load round-trips correctly after save", async () => {
    await saveTelegramConfig(secrets, config, SAMPLE_CONFIG, GLOBAL_TARGET);
    const loaded = await loadTelegramConfig(secrets, config);
    expect(loaded).toEqual(SAMPLE_CONFIG);
  });

  it("clearTelegramConfig removes all fields", async () => {
    await saveTelegramConfig(secrets, config, SAMPLE_CONFIG, GLOBAL_TARGET);
    await clearTelegramConfig(secrets, config, GLOBAL_TARGET);

    expect(await secrets.get("gsd.telegramBotToken")).toBeUndefined();
    expect(config.get("telegramGroupId")).toBeUndefined();
    expect(config.get("telegramChatTitle")).toBeUndefined();
    expect(config.get("telegramBotUsername")).toBeUndefined();
  });

  it("loadTelegramConfig returns null after clear", async () => {
    await saveTelegramConfig(secrets, config, SAMPLE_CONFIG, GLOBAL_TARGET);
    await clearTelegramConfig(secrets, config, GLOBAL_TARGET);
    const result = await loadTelegramConfig(secrets, config);
    expect(result).toBeNull();
  });

  it("bot token is never stored in workspace config", async () => {
    await saveTelegramConfig(secrets, config, SAMPLE_CONFIG, GLOBAL_TARGET);
    expect(config.get("telegramBotToken")).toBeUndefined();
    expect(config.get("botToken")).toBeUndefined();
  });
});
