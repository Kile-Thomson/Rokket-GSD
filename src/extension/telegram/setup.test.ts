import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import type { TelegramConfig } from "./config";

const TOKEN = "123456:ABC-DEF";
const BOT_USER = { id: 999, is_bot: true, first_name: "TestBot", username: "testbot" };
const CHAT = { id: -1001234, title: "Test Group" };

// --- Mocks ---

let inputBoxQueue: (string | undefined)[] = [];
let savedConfig: TelegramConfig | null = null;
let secretStore: Map<string, string>;
let configStore: Map<string, unknown>;

function createMockSecretStorage() {
  secretStore = new Map();
  return {
    get: async (key: string) => secretStore.get(key),
    store: async (key: string, value: string) => { secretStore.set(key, value); },
    delete: async (key: string) => { secretStore.delete(key); },
    keys: async () => [...secretStore.keys()],
    onDidChange: undefined as never,
  } as unknown as vscode.SecretStorage;
}

function createMockWorkspaceConfig(): vscode.WorkspaceConfiguration {
  configStore = new Map();
  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return configStore.has(key) ? (configStore.get(key) as T) : defaultValue;
    },
    has(key: string) { return configStore.has(key); },
    inspect() { return undefined; },
    async update(key: string, value: unknown) {
      if (value === undefined) configStore.delete(key);
      else configStore.set(key, value);
    },
  } as vscode.WorkspaceConfiguration;
}

// Mock vscode module
const mockOutputChannel = {
  appendLine: vi.fn(),
  dispose: vi.fn(),
};

const mockShowInputBox = vi.fn(async (..._args: unknown[]) => inputBoxQueue.shift());
const mockShowInfoMessage = vi.fn(async (..._args: unknown[]) => undefined);
const mockShowErrorMessage = vi.fn(async (..._args: unknown[]) => undefined);
const mockShowWarningMessage = vi.fn(async (..._args: unknown[]) => undefined);
const mockWithProgress = vi.fn(async (_opts: unknown, task: (progress: unknown, cancel: vscode.CancellationToken) => Promise<unknown>) => {
  const cancelToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken;
  return task({}, cancelToken);
});

const mockSecrets = createMockSecretStorage();
const mockConfig = createMockWorkspaceConfig();

vi.mock("vscode", () => ({
  window: {
    createOutputChannel: () => mockOutputChannel,
    showInputBox: (...args: unknown[]) => mockShowInputBox(...(args as [unknown])),
    showInformationMessage: (...args: unknown[]) => mockShowInfoMessage(...(args as [unknown])),
    showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...(args as [unknown])),
    showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...(args as [unknown])),
    withProgress: (...args: unknown[]) => mockWithProgress(args[0], args[1] as never),
  },
  workspace: {
    getConfiguration: () => mockConfig,
  },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
}));

// Mock TelegramApi
const mockGetMe = vi.fn();
const mockGetUpdates = vi.fn();
const mockGetChatMember = vi.fn();
const mockSendMessage = vi.fn();

vi.mock("./api", () => ({
  TelegramApi: vi.fn(function (this: Record<string, unknown>) {
    Object.assign(this, {
      getMe: mockGetMe,
      getUpdates: mockGetUpdates,
      getChatMember: mockGetChatMember,
      sendMessage: mockSendMessage,
    });
    return this;
  }),
  redactToken: (msg: string, token: string) => msg.replaceAll(token, "bot***"),
}));

// Mock config module
vi.mock("./config", () => ({
  saveTelegramConfig: vi.fn(async (_s: unknown, _c: unknown, cfg: TelegramConfig, _target: unknown) => {
    savedConfig = cfg;
  }),
  loadTelegramConfig: vi.fn(async () => savedConfig),
}));

import { runTelegramSetup, updateTelegramStatusBar } from "./setup";

function mockContext(): vscode.ExtensionContext {
  return { secrets: mockSecrets } as unknown as vscode.ExtensionContext;
}

beforeEach(() => {
  mockGetMe.mockReset();
  mockGetUpdates.mockReset();
  mockGetChatMember.mockReset();
  mockSendMessage.mockReset();
  mockShowInputBox.mockReset();
  mockShowInfoMessage.mockReset();
  mockShowErrorMessage.mockReset();
  mockShowWarningMessage.mockReset();
  mockWithProgress.mockReset();
  mockOutputChannel.appendLine.mockReset();
  inputBoxQueue = [];
  savedConfig = null;
  secretStore = new Map();
  configStore = new Map();

  // Re-set withProgress default
  mockWithProgress.mockImplementation(async (_opts: unknown, task: (progress: unknown, cancel: vscode.CancellationToken) => Promise<unknown>) => {
    const cancelToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken;
    return task({}, cancelToken);
  });

  // Re-set showInputBox default
  mockShowInputBox.mockImplementation(async () => inputBoxQueue.shift());
});

describe("runTelegramSetup", () => {
  it("completes happy path: token valid, group detected, admin confirmed", async () => {
    inputBoxQueue = [TOKEN];
    mockGetMe.mockResolvedValue(BOT_USER);
    mockGetUpdates.mockResolvedValue([
      { update_id: 1, message: { message_id: 1, chat: { id: CHAT.id, title: CHAT.title, type: "supergroup" } } },
    ]);
    mockGetChatMember.mockResolvedValue({ status: "administrator", user: BOT_USER });
    mockSendMessage.mockResolvedValue({ message_id: 2, chat: CHAT });

    await runTelegramSetup(mockContext());

    expect(mockGetMe).toHaveBeenCalled();
    expect(mockGetUpdates).toHaveBeenCalled();
    expect(mockGetChatMember).toHaveBeenCalledWith(CHAT.id, BOT_USER.id);
    expect(mockSendMessage).toHaveBeenCalledWith(CHAT.id, "✅ GSD Telegram bot connected!");
    expect(savedConfig).toEqual({
      botToken: TOKEN,
      botUsername: "testbot",
      chatId: CHAT.id,
      chatTitle: CHAT.title,
      streamingGranularity: "throttled",
    });
  });

  it("aborts when user cancels token input", async () => {
    inputBoxQueue = [undefined];

    await runTelegramSetup(mockContext());

    expect(mockGetMe).not.toHaveBeenCalled();
  });

  it("shows error and aborts on invalid token", async () => {
    inputBoxQueue = [TOKEN];
    mockGetMe.mockRejectedValue(new Error(`Telegram API error 401: Unauthorized for ${TOKEN}`));

    await runTelegramSetup(mockContext());

    expect(mockShowErrorMessage).toHaveBeenCalled();
    const errorMsg = (mockShowErrorMessage.mock.calls[0] as unknown[])[0] as string;
    expect(errorMsg).not.toContain(TOKEN);
    expect(errorMsg).toContain("bot***");
  });

  it("warns when bot is not admin", async () => {
    inputBoxQueue = [TOKEN];
    mockGetMe.mockResolvedValue(BOT_USER);
    mockGetUpdates.mockResolvedValue([
      { update_id: 1, message: { message_id: 1, chat: { id: CHAT.id, title: CHAT.title, type: "supergroup" } } },
    ]);
    mockGetChatMember.mockResolvedValue({ status: "member", user: BOT_USER });
    mockSendMessage.mockResolvedValue({ message_id: 2, chat: CHAT });

    await runTelegramSetup(mockContext());

    expect(mockShowWarningMessage).toHaveBeenCalled();
    const warnMsg = (mockShowWarningMessage.mock.calls[0] as unknown[])[0] as string;
    expect(warnMsg).toContain("member");
    expect(savedConfig).not.toBeNull();
  });

  it("offers manual group ID entry on timeout", async () => {
    mockGetMe.mockResolvedValue(BOT_USER);
    mockGetUpdates.mockResolvedValue([]);
    mockGetChatMember.mockResolvedValue({ status: "administrator", user: BOT_USER });
    mockSendMessage.mockResolvedValue({ message_id: 2, chat: CHAT });

    // First showInputBox returns token, second returns manual group ID
    mockShowInputBox
      .mockResolvedValueOnce(TOKEN)
      .mockResolvedValueOnce(String(CHAT.id));

    let callCount = 0;
    mockWithProgress.mockImplementation(async (_opts: unknown, task: (p: unknown, c: vscode.CancellationToken) => Promise<unknown>) => {
      callCount++;
      if (callCount === 2) {
        return null; // simulate group detection timeout
      }
      const cancelToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken;
      return task({}, cancelToken);
    });

    await runTelegramSetup(mockContext());

    expect(mockShowInputBox).toHaveBeenCalledTimes(2);
    expect(savedConfig).not.toBeNull();
    expect(savedConfig?.chatId).toBe(CHAT.id);
  });

  it("redacts token in OutputChannel logs on network error", async () => {
    mockGetMe.mockResolvedValue(BOT_USER);

    const errorWithToken = `Network failed for ${TOKEN}`;
    mockGetUpdates.mockRejectedValue(new Error(errorWithToken));

    mockShowInputBox
      .mockResolvedValueOnce(TOKEN)
      .mockResolvedValueOnce(undefined);

    let callCount = 0;
    mockWithProgress.mockImplementation(async (_opts: unknown, task: (p: unknown, c: vscode.CancellationToken) => Promise<unknown>) => {
      callCount++;
      if (callCount === 2) {
        // Simulate immediate cancellation so loop runs once then exits
        const cancelToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken;
        // Run task but expire deadline immediately after first iteration
        const origNow = Date.now;
        let n = 0;
        Date.now = () => { n++; return n <= 2 ? origNow() : origNow() + 120_000; };
        const result = await task({}, cancelToken);
        Date.now = origNow;
        return result;
      }
      const cancelToken = { isCancellationRequested: false, onCancellationRequested: vi.fn() } as unknown as vscode.CancellationToken;
      return task({}, cancelToken);
    });

    await runTelegramSetup(mockContext());

    const logCalls = mockOutputChannel.appendLine.mock.calls.map((c: unknown[]) => c[0] as string);
    const errorLogs = logCalls.filter((l: string) => l.includes("getUpdates error"));
    expect(errorLogs.length).toBeGreaterThan(0);
    for (const log of errorLogs) {
      expect(log).not.toContain(TOKEN);
      expect(log).toContain("bot***");
    }
  });
});

describe("updateTelegramStatusBar", () => {
  it("appends Telegram status to tooltip when config exists", async () => {
    savedConfig = { botToken: TOKEN, botUsername: "testbot", chatId: CHAT.id, chatTitle: CHAT.title };
    const statusBar = { tooltip: "Rokket GSD" } as vscode.StatusBarItem;

    await updateTelegramStatusBar(statusBar, mockContext());

    expect(statusBar.tooltip).toContain("Telegram: Connected");
  });

  it("does not change tooltip when no config exists", async () => {
    savedConfig = null;
    const statusBar = { tooltip: "Rokket GSD" } as vscode.StatusBarItem;

    await updateTelegramStatusBar(statusBar, mockContext());

    expect(statusBar.tooltip).toBe("Rokket GSD");
  });
});
