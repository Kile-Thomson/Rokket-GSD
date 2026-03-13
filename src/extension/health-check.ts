import * as vscode from "vscode";
import { execSync, execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// ============================================================
// Startup Health Check — validates the full environment
// Checks: Node.js, GSD CLI, authorized providers, settings
// ============================================================

export interface HealthCheckResult {
  gsdFound: boolean;
  gsdPath: string | null;
  gsdVersion: string | null;
  nodeFound: boolean;
  nodeVersion: string | null;
  authProviders: AuthProviderInfo[];
  defaultProvider: string | null;
  defaultModel: string | null;
  issues: HealthIssue[];
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
    nodeFound: false,
    nodeVersion: null,
    authProviders: [],
    defaultProvider: null,
    defaultModel: null,
    issues: [],
  };

  // ---- Check Node.js ----
  try {
    result.nodeVersion = execSync("node --version", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    result.nodeFound = true;

    // Check minimum version (Node 18+)
    const major = parseInt(result.nodeVersion.replace(/^v/, "").split(".")[0], 10);
    if (major < 18) {
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
      fix: "Install Node.js 18+ from https://nodejs.org",
    });
  }

  // ---- Check GSD CLI ----
  const config = vscode.workspace.getConfiguration("gsd");
  const processWrapper = config.get<string>("processWrapper", "");
  const gsdCommand = processWrapper || "gsd";

  try {
    const whichBin = process.platform === "win32" ? "where" : "which";
    const gsdPath = execFileSync(whichBin, [gsdCommand], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim().split(/\r?\n/)[0];

    result.gsdFound = true;
    result.gsdPath = gsdPath;

    // Get version from the package.json next to the binary
    result.gsdVersion = resolveGsdVersion(gsdPath);
  } catch {
    if (processWrapper) {
      result.issues.push({
        severity: "error",
        message: `Custom GSD path not found: "${processWrapper}".`,
        fix: "Check your gsd.processWrapper setting. The path should point to the gsd executable.",
      });
    } else {
      result.issues.push({
        severity: "error",
        message: "GSD CLI (gsd-pi) not found in PATH.",
        fix: "Install it with: npm install -g gsd-pi",
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
    if (fs.existsSync(authPath)) {
      const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));

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
    } else {
      result.issues.push({
        severity: "warning",
        message: "No auth configuration found (~/.gsd/agent/auth.json).",
        fix: "Run 'gsd' in a terminal once to set up authentication.",
      });
    }
  } catch (err: any) {
    result.issues.push({
      severity: "warning",
      message: `Could not read auth config: ${err.message}`,
    });
  }

  // ---- Check settings.json for default provider/model ----
  const settingsPath = path.join(gsdAgentDir(), "settings.json");
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
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
    }
  } catch {
    // settings.json is optional
  }

  // ---- Log full results ----
  output.appendLine("=== Health Check ===");
  output.appendLine(`Node.js: ${result.nodeFound ? result.nodeVersion : "NOT FOUND"}`);
  output.appendLine(`GSD CLI: ${result.gsdFound ? (result.gsdPath || "found") : "NOT FOUND"}`);
  if (result.gsdVersion) output.appendLine(`GSD version: ${result.gsdVersion}`);

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
function resolveGsdVersion(gsdPath: string): string | null {
  try {
    let dir = path.dirname(gsdPath);
    for (let i = 0; i < 4; i++) {
      const pkgPath = path.join(dir, "node_modules", "gsd-pi", "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        return pkg.version || null;
      }
      dir = path.dirname(dir);
    }
  } catch { /* ignored */ }
  return null;
}
