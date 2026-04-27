import { execFile } from "child_process";
import * as os from "os";
import { EXEC_TIMEOUT_MS } from "../shared/constants";

let cachedEnv: Record<string, string> | null = null;
let resolving: Promise<Record<string, string>> | null = null;

/**
 * On Linux/macOS, VS Code launched from the desktop doesn't inherit the
 * user's shell environment (~/.bashrc, ~/.zshrc, ~/.profile). This means
 * PATH (where node/gsd live), API keys, and other env vars are missing.
 *
 * This resolves the user's login shell environment once and caches it.
 * On Windows this is a no-op — env vars propagate correctly there.
 */
export function resolveShellEnv(): Promise<Record<string, string>> {
  if (cachedEnv) return Promise.resolve(cachedEnv);
  if (resolving) return resolving;

  if (process.platform === "win32") {
    cachedEnv = {};
    return Promise.resolve(cachedEnv);
  }

  resolving = doResolve().then(env => {
    cachedEnv = env;
    resolving = null;
    return env;
  }).catch(() => {
    cachedEnv = {};
    resolving = null;
    return cachedEnv;
  });

  return resolving;
}

/**
 * Merge shell env into a base env object. Shell env provides missing
 * PATH segments and env vars, but doesn't overwrite explicitly set values.
 */
export function mergeShellEnv(base: Record<string, string>, shell: Record<string, string>): Record<string, string> {
  const merged = { ...base };

  for (const [key, value] of Object.entries(shell)) {
    if (key === "PATH" || key === "Path") {
      // Append shell PATH segments that aren't already present
      const basePath = merged.PATH || merged.Path || "";
      const baseParts = new Set(basePath.split(":").filter(Boolean));
      const shellParts = value.split(":").filter(Boolean);
      const newParts = shellParts.filter(p => !baseParts.has(p));
      if (newParts.length > 0) {
        const pathKey = "PATH" in merged ? "PATH" : "Path" in merged ? "Path" : "PATH";
        merged[pathKey] = basePath ? `${basePath}:${newParts.join(":")}` : newParts.join(":");
      }
    } else if (!(key in merged)) {
      merged[key] = value;
    }
  }

  return merged;
}

function doResolve(): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const shell = process.env.SHELL || "/bin/sh";

    // Run a login+interactive shell that prints env as null-delimited pairs.
    // The markers ensure we only parse the env block, not shell startup noise.
    const marker = `__GSD_ENV_${Date.now()}__`;
    const script = `echo '${marker}' && env -0 && echo '${marker}'`;

    execFile(shell, ["-ilc", script], {
      encoding: "utf8",
      timeout: EXEC_TIMEOUT_MS,
      env: { ...process.env },
      maxBuffer: 1024 * 1024,
    }, (err, stdout) => {
      if (err) {
        // Fallback: try non-interactive login shell
        execFile(shell, ["-lc", script], {
          encoding: "utf8",
          timeout: EXEC_TIMEOUT_MS,
          env: { ...process.env },
          maxBuffer: 1024 * 1024,
        }, (err2, stdout2) => {
          if (err2) return reject(err2);
          resolve(parseEnv(stdout2, marker));
        });
        return;
      }
      resolve(parseEnv(stdout, marker));
    });
  });
}

function parseEnv(stdout: string, marker: string): Record<string, string> {
  const env: Record<string, string> = {};

  // Extract content between markers
  const startIdx = stdout.indexOf(marker);
  const endIdx = stdout.lastIndexOf(marker);
  if (startIdx === -1 || endIdx === -1 || startIdx === endIdx) {
    // No markers — try parsing the whole output
    return parseEnvRaw(stdout);
  }

  const block = stdout.slice(startIdx + marker.length, endIdx).trim();
  // env -0 uses null bytes as delimiters
  const entries = block.split("\0").filter(Boolean);
  for (const entry of entries) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx > 0) {
      env[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
    }
  }

  return env;
}

function parseEnvRaw(stdout: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of stdout.split(/\n/)) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        env[key] = line.slice(eqIdx + 1);
      }
    }
  }
  return env;
}
