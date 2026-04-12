import { describe, it, expect, vi } from "vitest";
import { sanitizeEnvForChildProcess, GsdRpcClient } from "./rpc-client";

describe("sanitizeEnvForChildProcess", () => {
  it("preserves normal env vars", () => {
    const env = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      ANTHROPIC_API_KEY: "sk-test",
      LANG: "en_US.UTF-8",
    };
    const result = sanitizeEnvForChildProcess(env);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.HOME).toBe("/home/user");
    expect(result.ANTHROPIC_API_KEY).toBe("sk-test");
    expect(result.LANG).toBe("en_US.UTF-8");
  });

  it("strips ELECTRON_* vars", () => {
    const env = {
      PATH: "/usr/bin",
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ASAR: "1",
      ELECTRON_ENABLE_LOGGING: "1",
    };
    const result = sanitizeEnvForChildProcess(env);
    expect(result.PATH).toBe("/usr/bin");
    expect(result.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(result.ELECTRON_NO_ASAR).toBeUndefined();
    expect(result.ELECTRON_ENABLE_LOGGING).toBeUndefined();
  });

  it("strips VSCODE_* vars", () => {
    const env = {
      PATH: "/usr/bin",
      VSCODE_PID: "12345",
      VSCODE_IPC_HOOK: "/tmp/vscode-ipc",
      VSCODE_NLS_CONFIG: "{}",
      VSCODE_CWD: "/home/user",
      VSCODE_INSPECTOR_OPTIONS: "--inspect=9229",
    };
    const result = sanitizeEnvForChildProcess(env);
    expect(result.PATH).toBe("/usr/bin");
    expect(Object.keys(result).filter(k => k.startsWith("VSCODE_"))).toHaveLength(0);
  });

  it("strips NODE_OPTIONS", () => {
    const env = {
      PATH: "/usr/bin",
      NODE_OPTIONS: "--require /some/electron/hook.js --max-old-space-size=4096",
      NODE_ENV: "development",
    };
    const result = sanitizeEnvForChildProcess(env);
    expect(result.NODE_OPTIONS).toBeUndefined();
    expect(result.NODE_ENV).toBe("development");
  });

  it("handles undefined values", () => {
    const env = {
      PATH: "/usr/bin",
      UNDEFINED_VAR: undefined,
    } as unknown as NodeJS.ProcessEnv;
    const result = sanitizeEnvForChildProcess(env);
    expect(result.PATH).toBe("/usr/bin");
    expect("UNDEFINED_VAR" in result).toBe(false);
  });

  it("simulates realistic VS Code extension host env", () => {
    // This is roughly what process.env looks like inside a VS Code extension host
    const env = {
      PATH: "C:\\Program Files\\nodejs;C:\\Users\\user\\AppData\\Roaming\\npm",
      HOME: "C:\\Users\\user",
      USERPROFILE: "C:\\Users\\user",
      APPDATA: "C:\\Users\\user\\AppData\\Roaming",
      NODE_OPTIONS: "--require C:\\Program Files\\Microsoft VS Code\\resources\\app\\out\\bootstrap-fork.js",
      ELECTRON_RUN_AS_NODE: "1",
      VSCODE_PID: "9876",
      VSCODE_IPC_HOOK: "\\\\.\\pipe\\vscode-ipc-deadbeef",
      VSCODE_NLS_CONFIG: '{"locale":"en"}',
      VSCODE_CWD: "C:\\Users\\user\\projects",
      VSCODE_HANDLES_UNCAUGHT_ERRORS: "true",
      VSCODE_CRASH_REPORTER_PROCESS_TYPE: "extensionHost",
      VSCODE_AMD_ENTRYPOINT: "vs/workbench/api/node/extensionHostProcess",
      VSCODE_INSPECTOR_OPTIONS: '{"port":0}',
      VSCODE_LOG_LEVEL: "info",
      VSCODE_LOGS: "C:\\Users\\user\\AppData\\Roaming\\Code\\logs",
      CHROME_DESKTOP: "code.desktop",
      GOOGLE_API_KEY: "electron-internal-key",
      ORIGINAL_XDG_CURRENT_DESKTOP: "ubuntu:GNOME",
      // These should survive
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-test",
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
    };

    const result = sanitizeEnvForChildProcess(env);

    // Should keep normal vars
    expect(result.PATH).toBeDefined();
    expect(result.HOME).toBeDefined();
    expect(result.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(result.OPENAI_API_KEY).toBe("sk-test");
    expect(result.TERM).toBe("xterm-256color");

    // Should strip all the Electron/VS Code junk
    expect(result.NODE_OPTIONS).toBeUndefined();
    expect(result.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(result.GOOGLE_API_KEY).toBeUndefined();
    expect(result.CHROME_DESKTOP).toBeUndefined();
    expect(result.ORIGINAL_XDG_CURRENT_DESKTOP).toBeUndefined();
    expect(Object.keys(result).filter(k => k.startsWith("VSCODE_"))).toHaveLength(0);
    expect(Object.keys(result).filter(k => k.startsWith("ELECTRON_"))).toHaveLength(0);
  });
});

describe("GsdRpcClient error handler timer cleanup", () => {
  it("rejects pending requests when process emits spawn error", async () => {
    const client = new GsdRpcClient();
    const errors: Error[] = [];
    client.on("error", (err) => errors.push(err));

    // Start with a nonexistent binary to trigger spawn ENOENT
    await client.start({ cwd: ".", gsdPath: "__nonexistent_binary_that_does_not_exist__" });

    // Wait for the error event to fire asynchronously
    await new Promise((r) => setTimeout(r, 200));

    expect(client.isRunning).toBe(false);
    expect(client.pid).toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain("ENOENT");

    // Verify pending requests map is cleared
    const pendingRequests = (client as unknown as { pendingRequests: Map<string, unknown> }).pendingRequests;
    expect(pendingRequests.size).toBe(0);

    // Verify process reference is nulled
    const proc = (client as unknown as { process: object | null }).process;
    expect(proc).toBeNull();
  });

  it("rejects in-flight requests with timer cleanup on process error", async () => {
    const client = new GsdRpcClient();
    const errors: Error[] = [];
    client.on("error", () => { /* swallow */ });

    // Inject a pending request with a timeout (simulates request() mid-flight)
    const pendingRequests = (client as unknown as {
      pendingRequests: Map<string, { resolve: (d: unknown) => void; reject: (e: Error) => void }>
    }).pendingRequests;

    const rejections: Error[] = [];
    let timeoutHandle: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      errors.push(new Error("timeout leaked — timer was not cleaned up"));
    }, 60000);

    pendingRequests.set("req-1", {
      resolve: () => {},
      reject: (err) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        rejections.push(err);
      },
    });

    // Start with a bad binary — the error handler should reject pending requests
    await client.start({ cwd: ".", gsdPath: "__nonexistent_binary__" });
    await new Promise((r) => setTimeout(r, 200));

    expect(rejections).toHaveLength(1);
    expect(rejections[0].message).toContain("GSD process error");
    expect(pendingRequests.size).toBe(0);
    expect(timeoutHandle).toBeNull();
  });
});
