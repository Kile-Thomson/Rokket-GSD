import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import { sanitizeEnvForChildProcess } from "./rpc-client";

/**
 * Integration test: verify that a child process spawned with our sanitized env
 * does NOT see Electron/VS Code vars, AND that grandchild processes (simulating
 * bg_shell spawning next dev, which spawns lightningcss workers) also don't see them.
 *
 * This reproduces the actual bug: extension host env leaking through to GSD's
 * subprocess tree.
 */
describe("child process env sanitization (integration)", () => {
  // Simulate the VS Code extension host environment
  const poisonedEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    // These are what VS Code's extension host injects
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: "--require /fake/electron/hook.js --max-old-space-size=8192",
    VSCODE_PID: "99999",
    VSCODE_IPC_HOOK: "\\\\.\\pipe\\vscode-ipc-test",
    VSCODE_NLS_CONFIG: '{"locale":"en"}',
    VSCODE_CWD: process.cwd(),
    VSCODE_HANDLES_UNCAUGHT_ERRORS: "true",
    VSCODE_INSPECTOR_OPTIONS: '{"port":0}',
    GOOGLE_API_KEY: "electron-internal-key",
    CHROME_DESKTOP: "code.desktop",
    // This should survive
    GSD_TEST_MARKER: "should-survive",
  };

  it("child process does not see ELECTRON/VSCODE vars when env is sanitized", async () => {
    const cleanEnv = sanitizeEnvForChildProcess(poisonedEnv as unknown as NodeJS.ProcessEnv);

    // Spawn a child that dumps its own env as JSON
    const result = await spawnAndCapture(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      cleanEnv
    );

    const childEnv = JSON.parse(result);

    expect(childEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(childEnv.NODE_OPTIONS).toBeUndefined();
    expect(childEnv.VSCODE_PID).toBeUndefined();
    expect(childEnv.VSCODE_IPC_HOOK).toBeUndefined();
    expect(childEnv.VSCODE_INSPECTOR_OPTIONS).toBeUndefined();
    expect(childEnv.GOOGLE_API_KEY).toBeUndefined();
    expect(childEnv.CHROME_DESKTOP).toBeUndefined();
    expect(childEnv.GSD_TEST_MARKER).toBe("should-survive");
  });

  it("grandchild process (simulating bg_shell -> next dev -> worker) also clean", async () => {
    const cleanEnv = sanitizeEnvForChildProcess(poisonedEnv as unknown as NodeJS.ProcessEnv);

    // Spawn a child that spawns a grandchild — simulates GSD -> bg_shell -> next dev
    // The grandchild dumps its env. This verifies env doesn't sneak back in.
    const grandchildScript = `
      const { execSync } = require("child_process");
      const out = execSync(process.execPath + ' -e "process.stdout.write(JSON.stringify(process.env))"', {
        encoding: "utf-8",
        env: process.env,  // passes through whatever it inherited
      });
      process.stdout.write(out);
    `;

    const result = await spawnAndCapture(
      process.execPath,
      ["-e", grandchildScript],
      cleanEnv
    );

    const grandchildEnv = JSON.parse(result);

    expect(grandchildEnv.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(grandchildEnv.NODE_OPTIONS).toBeUndefined();
    expect(grandchildEnv.VSCODE_PID).toBeUndefined();
    expect(grandchildEnv.GSD_TEST_MARKER).toBe("should-survive");
  });

  it("WITHOUT sanitization, child crashes from poisoned NODE_OPTIONS (proves the bug)", async () => {
    // This IS the bug: NODE_OPTIONS contains --require for a non-existent Electron hook.
    // When unsanitized env leaks to child processes, they crash or misbehave.
    // In production, this causes next dev workers to loop-crash-respawn.
    await expect(
      spawnAndCapture(
        process.execPath,
        ["-e", "process.stdout.write('ok')"],
        poisonedEnv
      )
    ).rejects.toThrow(/Cannot find module|MODULE_NOT_FOUND|exited/);
  });
});

function spawnAndCapture(cmd: string, args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(cmd, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Child exited ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    child.on("error", reject);

    // Safety timeout
    setTimeout(() => {
      child.kill();
      reject(new Error("Child process timed out"));
    }, 10000);
  });
}
