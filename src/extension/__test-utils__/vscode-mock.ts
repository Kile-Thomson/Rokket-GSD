import { vi } from "vitest";

/**
 * Reusable vscode API mock for extension-host unit tests.
 *
 * Usage:
 *   import { setupVscodeMock } from "./__test-utils__/vscode-mock";
 *   vi.mock("vscode", () => setupVscodeMock());
 *
 * Or import the mock object directly for per-test spy setup:
 *   import vscodeMock from "./__test-utils__/vscode-mock";
 */

export function createVscodeMock() {
  return {
    workspace: {
      workspaceFolders: [
        {
          uri: { fsPath: "/mock/workspace", scheme: "file" },
          name: "mock-workspace",
          index: 0,
        },
      ],
      openTextDocument: vi.fn(),
      getConfiguration: vi.fn(() => ({
        get: vi.fn(),
        has: vi.fn(() => false),
        inspect: vi.fn(),
        update: vi.fn(),
      })),
      fs: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        stat: vi.fn(),
      },
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    },
    window: {
      showTextDocument: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        append: vi.fn(),
        clear: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      })),
      withProgress: vi.fn(),
      createWebviewPanel: vi.fn(),
    },
    commands: {
      executeCommand: vi.fn(),
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath, scheme: "file", toString: () => `file://${fsPath}` }),
      parse: (uri: string) => ({ fsPath: uri, scheme: uri.startsWith("https") ? "https" : "http", toString: () => uri }),
      joinPath: (...segments: unknown[]) => ({ fsPath: (segments as string[]).join("/"), scheme: "file" }),
    },
    ViewColumn: {
      One: 1,
      Two: 2,
      Three: 3,
      Beside: -2,
      Active: -1,
    },
    env: {
      clipboard: {
        writeText: vi.fn(),
        readText: vi.fn(),
      },
      uriScheme: "vscode",
      language: "en",
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
    ProgressLocation: {
      Notification: 15,
      SourceControl: 1,
      Window: 10,
    },
    EventEmitter: vi.fn(() => ({
      event: vi.fn(),
      fire: vi.fn(),
      dispose: vi.fn(),
    })),
    Disposable: {
      from: vi.fn(),
    },
  };
}

const vscodeMock = createVscodeMock();

/**
 * Returns a fresh vscode mock suitable for `vi.mock("vscode", () => ...)`.
 */
export function setupVscodeMock() {
  return createVscodeMock();
}

export default vscodeMock;
