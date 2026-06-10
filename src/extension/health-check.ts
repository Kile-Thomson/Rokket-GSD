import * as vscode from "vscode";
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { toErrorMessage } from "../shared/errors";
import { EXEC_TIMEOUT_MS, MIN_NODE_MAJOR_VERSION } from "../shared/constants";
import { resolveShellEnv, mergeShellEnv } from "./shell-env";

// ============================================================
// Startup Health Check — validates the full environment
// Checks: Node.js, GSD CLI, authorized providers, settings
// ============================================================

export interface HealthCheckResult {
  gsdFound: boolean;
  gsdPath: string | null;
  gsdVersion: string | null;
  /** GSD-family packages whose version diverges from the top-level gsd-pi version. */
  gsdVersionSkew: VersionSkew[];
  nodeFound: boolean;
  nodeVersion: string | null;
  authProviders: AuthProviderInfo[];
  defaultProvider: string | null;
  defaultModel: string | null;
  issues: HealthIssue[];
}

export interface VersionSkew {
  name: string;
  version: string;
}

export interface AuthProviderInfo {
  name: string;
  type: "oauth" | "api_key" | "unknown";
  authorized: boolean;
}

export interface HealthIssue {
  severity: "error" | "warning" | "info";
  message: string;
  fix?: string;
}

/** Resolve the GSD agent config directory (~/.gsd/agent/) */
function gsdAgentDir(): string {
  return path.join(os.homedir(), ".gsd", "agent");
}

/**
 * Run comprehensive health check and report issues.
 * Called once on activation. Shows a single actionable notification
 * if there are blocking issues — otherwise stays silent.
 */
export async function runHealthCheck(output: vscode.OutputChannel): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    gsdFound: false,
    gsdPath: null,
    gsdVersion: null,
    gsdVersionSkew: [],
    nodeFound: false,
    nodeVersion: null,
    authProviders: [],
    defaultProvider: null,
    defaultModel: null,
    issues: [],
  };

  // Resolve login shell env so health checks find binaries on Linux desktop launches
  const shellEnv = await resolveShellEnv();
  const healthEnv = mergeShellEnv(
    Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    shellEnv,
  );

  // ---- Check Node.js ----
  try {
    result.nodeVersion = await new Promise<string>((resolve, reject) => {
      execFile("node", ["--version"], {
        encoding: "utf8",
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
        env: healthEnv,
      }, (err, stdout) => { if (err) reject(err); else resolve(stdout); });
    }).then(s => s.trim());
    result.nodeFound = true;

    // Check minimum version (Node 18+)
    const major = parseInt(result.nodeVersion!.replace(/^v/, "").split(".")[0], 10);
    if (major < MIN_NODE_MAJOR_VERSION) {
      result.issues.push({
        severity: "error",
        message: `Node.js ${result.nodeVersion} is too old. GSD requires Node.js 18+.`,
        fix: "Download the latest LTS from https://nodejs.org or use nvm to upgrade.",
      });
    }
  } catch {
    result.issues.push({
      severity: "error",
      message: "Node.js not found in PATH.",
      fix: process.platform === "linux"
        ? "Install Node.js 18+ from https://nodejs.org. If using nvm, try launching VS Code from a terminal ('code .') so it inherits your shell PATH."
        : "Install Node.js 18+ from https://nodejs.org",
    });
  }

  // ---- Check GSD CLI ----
  const config = vscode.workspace.getConfiguration("gsd");
  const processWrapper = config.get<string>("processWrapper", "");
  const gsdCommand = processWrapper || "gsd";

  try {
    const whichBin = process.platform === "win32" ? "where" : "which";
    const gsdPath = await new Promise<string>((resolve, reject) => {
      execFile(whichBin, [gsdCommand], {
        encoding: "utf8",
        timeout: EXEC_TIMEOUT_MS,
        windowsHide: true,
        env: healthEnv,
      }, (err, stdout) => { if (err) reject(err); else resolve(stdout); });
    }).then(s => s.trim().split(/\r?\n/)[0]);

    result.gsdFound = true;
    result.gsdPath = gsdPath;

    // Get version from the package.json next to the binary
    result.gsdVersion = await resolveGsdVersion(gsdPath);

    // ---- Detect a mixed-version (half-applied) gsd-pi install ----
    // A Windows `npm i -g` that runs while VS Code holds the RPC child open
    // overwrites some bundled packages and silently skips the locked ones,
    // leaving a version-skewed install (e.g. 1.2.0 agent driving a 1.0.2 RPC
    // transport) that destabilizes sessions. Best-effort — never block startup.
    if (result.gsdVersion) {
      try {
        const installRoot = await resolveGsdInstallRoot(gsdPath);
        if (installRoot) {
          const pkgVersions = await collectGsdPackageVersions(installRoot);
          result.gsdVersionSkew = detectVersionSkew(pkgVersions, result.gsdVersion);
          if (result.gsdVersionSkew.length > 0) {
            const n = result.gsdVersionSkew.length;
            result.issues.push({
              severity: "error",
              message: `Mixed-version gsd-pi install detected — ${n} package${n === 1 ? "" : "s"} do not match gsd-pi ${result.gsdVersion}. A half-applied update destabilizes sessions.`,
              fix: "Quit ALL VS Code windows, then reinstall: npm i -g @opengsd/gsd-pi@latest (or run fix-gsd-pi.ps1). A file locked during 'npm i -g' leaves the RPC transport on the old version.",
            });
          }
        }
      } catch { /* skew detection is diagnostic only — ignore failures */ }
    }
  } catch {
    // gsd-pi binary not found or version unreadable
    if (processWrapper) {
      result.issues.push({
        severity: "error",
        message: `Custom GSD path not found: "${processWrapper}".`,
        fix: "Check your gsd.processWrapper setting. The path should point to the gsd executable.",
      });
    } else {
      result.issues.push({
        severity: "error",
        message: "GSD CLI not found in PATH.",
        fix: process.platform === "linux"
          ? "Install it with: npm install -g @opengsd/gsd-pi (or gsd-pi for legacy V2). If already installed, try launching VS Code from a terminal ('code .') or add npm's global bin to ~/.profile."
          : "Install it with: npm install -g @opengsd/gsd-pi (or gsd-pi for legacy V2)",
      });
    }
  }

  // ---- Check auth.json for authorized providers ----
  // Service/tool providers — these provide optional features, not model access
  const serviceProviderNames = new Set([
    "brave", "brave_answers", "context7", "jina",
    "slack_bot", "discord_bot", "github",
  ]);

  const authPath = path.join(gsdAgentDir(), "auth.json");
  try {
    let authRaw: string;
    try {
      authRaw = await fs.promises.readFile(authPath, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        result.issues.push({
          severity: "warning",
          message: "No auth configuration found (~/.gsd/agent/auth.json).",
          fix: "Run 'gsd' in a terminal once to set up authentication.",
        });
      } else {
        throw err;
      }
      authRaw = "";
    }

    if (authRaw) {
      const authData = JSON.parse(authRaw);

      for (const [providerName, entry] of Object.entries(authData)) {
        const e = entry as Record<string, unknown>;
        const type = e.type === "oauth" ? "oauth" : e.type === "api_key" ? "api_key" : "unknown";
        let authorized = false;

        if (type === "oauth") {
          authorized = !!(e.access || e.refresh);
        } else if (type === "api_key") {
          authorized = !!(e.key && (e.key as string).trim());
        }

        result.authProviders.push({ name: providerName, type, authorized });
      }

      // Check if at least one non-service provider is authorized (i.e. a model provider)
      const hasAuthorizedModelProvider = result.authProviders.some(
        (p) => p.authorized && !serviceProviderNames.has(p.name)
      );
      if (!hasAuthorizedModelProvider) {
        result.issues.push({
          severity: "error",
          message: "No AI model provider is authorized.",
          fix: "Run 'gsd' in a terminal and follow the authentication prompts, or set an API key (e.g. ANTHROPIC_API_KEY) in your environment.",
        });
      }
    }
  } catch (err: unknown) {
    result.issues.push({
      severity: "warning",
      message: `Could not read auth config: ${toErrorMessage(err)}`,
    });
  }

  // ---- Check settings.json for default provider/model ----
  const settingsPath = path.join(gsdAgentDir(), "settings.json");
  try {
    const settingsRaw = await fs.promises.readFile(settingsPath, "utf8");
    const settings = JSON.parse(settingsRaw);
    result.defaultProvider = settings.defaultProvider || null;
    result.defaultModel = settings.defaultModel || null;

    // Warn if the default provider isn't authorized
    if (result.defaultProvider) {
      const providerAuth = result.authProviders.find((p) => p.name === result.defaultProvider);
      if (providerAuth && !providerAuth.authorized) {
        result.issues.push({
          severity: "warning",
          message: `Default provider "${result.defaultProvider}" is configured but not authorized.`,
          fix: `Run 'gsd' in a terminal to authenticate with ${result.defaultProvider}, or change the default in ~/.gsd/agent/settings.json.`,
        });
      }
    }
  } catch {
    // settings.json is optional
  }

  // ---- Log full results ----
  output.appendLine("=== Health Check ===");
  output.appendLine(`Node.js: ${result.nodeFound ? result.nodeVersion : "NOT FOUND"}`);
  output.appendLine(`GSD CLI: ${result.gsdFound ? (result.gsdPath || "found") : "NOT FOUND"}`);
  if (result.gsdVersion) output.appendLine(`GSD version: ${result.gsdVersion}`);
  if (result.gsdVersionSkew.length > 0) {
    output.appendLine(`Version skew (expected ${result.gsdVersion}): ${result.gsdVersionSkew.map((p) => `${p.name}@${p.version}`).join(", ")}`);
  }

  if (result.authProviders.length > 0) {
    output.appendLine("Providers:");
    for (const p of result.authProviders) {
      const status = p.authorized ? "✓ authorized" : "✗ not authorized";
      output.appendLine(`  ${p.name} (${p.type}): ${status}`);
    }
  }

  if (result.defaultProvider) {
    output.appendLine(`Default: ${result.defaultProvider}/${result.defaultModel || "?"}`);
  }

  if (result.issues.length > 0) {
    output.appendLine(`Issues: ${result.issues.length}`);
    for (const issue of result.issues) {
      const icon = issue.severity === "error" ? "✗" : issue.severity === "warning" ? "⚠" : "ℹ";
      output.appendLine(`  ${icon} ${issue.message}`);
      if (issue.fix) output.appendLine(`    Fix: ${issue.fix}`);
    }
  } else {
    output.appendLine("All checks passed.");
  }
  output.appendLine("====================");

  // ---- Show notification if there are blocking issues ----
  const errors = result.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    const message = errors.length === 1
      ? errors[0].message
      : `Rokket GSD: ${errors.length} setup issues found`;

    const fixHint = errors[0].fix;
    const actions: string[] = ["Open Output"];
    if (fixHint) actions.unshift("Show Fix");

    const choice = await vscode.window.showWarningMessage(message, ...actions);

    if (choice === "Show Fix") {
      output.show();
      // Also show as a more visible info message
      if (fixHint) {
        vscode.window.showInformationMessage(`Fix: ${fixHint}`);
      }
    } else if (choice === "Open Output") {
      output.show();
    }
  }

  return result;
}

/**
 * Resolve the gsd-pi version from the package.json near the binary.
 */
async function resolveGsdVersion(gsdPath: string): Promise<string | null> {
  const packageNames = ["@opengsd/gsd-pi", "gsd-pi"];
  try {
    let dir = path.dirname(gsdPath);
    for (let i = 0; i < 4; i++) {
      for (const pkg of packageNames) {
        const pkgPath = path.join(dir, "node_modules", ...pkg.split("/"), "package.json");
        try {
          const parsed = JSON.parse(await fs.promises.readFile(pkgPath, "utf8"));
          return parsed.version || null;
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      dir = path.dirname(dir);
    }
  } catch { /* ignored */ }
  return null;
}

/** npm scopes whose packages ship in lockstep with the gsd-pi release train. */
const GSD_FAMILY_SCOPES = ["@gsd", "@gsd-build", "@opengsd"];

/**
 * GSD-family packages that legitimately version independently of gsd-pi and so
 * must NOT be treated as skew. `@opengsd/gsd-pi` is the reference version itself;
 * `@opengsd/gsd-browser` ships on its own (0.x) cadence.
 */
const SKEW_DENYLIST = new Set(["@opengsd/gsd-pi", "gsd-pi", "@opengsd/gsd-browser"]);

function isGsdFamilyPackage(name: string): boolean {
  return GSD_FAMILY_SCOPES.some((scope) => name.startsWith(`${scope}/`));
}

/**
 * Locate the gsd-pi package directory (the one containing its package.json) by
 * walking up from the resolved binary, mirroring resolveGsdVersion's search.
 * Returns the package dir, or null if not found.
 */
async function resolveGsdInstallRoot(gsdPath: string): Promise<string | null> {
  const packageNames = ["@opengsd/gsd-pi", "gsd-pi"];
  let dir = path.dirname(gsdPath);
  for (let i = 0; i < 4; i++) {
    for (const pkg of packageNames) {
      const pkgDir = path.join(dir, "node_modules", ...pkg.split("/"));
      try {
        await fs.promises.access(path.join(pkgDir, "package.json"));
        return pkgDir;
      } catch { /* not here — keep walking */ }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Collect name→version for every GSD-family package bundled under the gsd-pi
 * install. Scans both layouts that gsd-pi has shipped: scoped dirs under
 * `<root>/node_modules/{@gsd,@gsd-build,@opengsd}/*` and a flat `<root>/packages/*`.
 * Best-effort: unreadable or missing dirs are skipped.
 */
async function collectGsdPackageVersions(pkgRoot: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>();

  const readPkg = async (pkgJsonPath: string): Promise<void> => {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(pkgJsonPath, "utf8"));
      if (parsed.name && parsed.version) versions.set(parsed.name, parsed.version);
    } catch { /* missing/unreadable — skip */ }
  };

  // Layout 1: scoped packages under the install's node_modules
  const nodeModules = path.join(pkgRoot, "node_modules");
  for (const scope of GSD_FAMILY_SCOPES) {
    const scopeDir = path.join(nodeModules, scope);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(scopeDir);
    } catch { continue; }
    for (const name of entries) {
      await readPkg(path.join(scopeDir, name, "package.json"));
    }
  }

  // Layout 2: monorepo-style bundled packages/<name>
  let pkgEntries: string[] = [];
  try {
    pkgEntries = await fs.promises.readdir(path.join(pkgRoot, "packages"));
  } catch { /* no packages dir — fine */ }
  for (const name of pkgEntries) {
    await readPkg(path.join(pkgRoot, "packages", name, "package.json"));
  }

  return versions;
}

/**
 * Pure skew check: return every GSD-family package whose version differs from
 * the top-level gsd-pi version, ignoring the denylist. An empty result means a
 * uniform (healthy) install.
 */
export function detectVersionSkew(
  pkgVersions: Map<string, string>,
  topVersion: string,
): VersionSkew[] {
  const skew: VersionSkew[] = [];
  for (const [name, version] of pkgVersions) {
    if (SKEW_DENYLIST.has(name)) continue;
    if (!isGsdFamilyPackage(name)) continue;
    if (version !== topVersion) skew.push({ name, version });
  }
  return skew;
}
