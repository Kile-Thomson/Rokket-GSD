import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import type { GsdWebviewProvider } from "./webview-provider";

// ============================================================
// Auto-Update Checker — polls GitHub Releases for new versions
// Supports private repos by resolving GitHub auth from:
//   1. gsd.githubToken setting
//   2. GITHUB_TOKEN / GH_TOKEN env vars
//   3. gh auth token (GitHub CLI)
//   4. git credential-manager (Git's credential store)
// ============================================================

const GITHUB_OWNER = "Kile-Thomson";
const GITHUB_REPO = "Rokket-GSD";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

/** Check interval: 1 hour */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Skip repeated prompts for the same version the user dismissed */
const DISMISSED_VERSION_KEY = "gsd.dismissedUpdateVersion";

/** Cache the resolved token for the session lifetime */
let cachedToken: string | null | undefined; // undefined = not yet resolved

let cachedProvider: GsdWebviewProvider | null = null;

// ─── Token resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a GitHub token for private repo API access.
 * Tries multiple sources so the user doesn't need to configure anything
 * if they already have gh or git set up.
 */
function getGitHubToken(): string | undefined {
  // Return cached result (even if null = "no token found")
  if (cachedToken !== undefined) return cachedToken || undefined;

  // 1. Extension setting
  const configToken = vscode.workspace
    .getConfiguration("gsd")
    .get<string>("githubToken", "")
    ?.trim();
  if (configToken) {
    cachedToken = configToken;
    return configToken;
  }

  // 2. Environment variables
  const envToken = (
    process.env.ROKKET_GSD_GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ""
  ).trim();
  if (envToken) {
    cachedToken = envToken;
    return envToken;
  }

  // 3. GitHub CLI (gh auth token)
  try {
    const ghToken = execSync("gh auth token", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (ghToken) {
      cachedToken = ghToken;
      return ghToken;
    }
  } catch {
    // gh not installed or not authenticated — continue
  }

  // 4. Git credential manager
  try {
    const credOutput = execSync(
      "git credential-manager get",
      {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        input: "protocol=https\nhost=github.com\n\n",
      }
    ).trim();
    const passwordMatch = credOutput.match(/^password=(.+)$/m);
    if (passwordMatch?.[1]?.trim()) {
      cachedToken = passwordMatch[1].trim();
      return cachedToken;
    }
  } catch {
    // No credential manager — continue
  }

  cachedToken = null; // Mark as "resolved, nothing found"
  return undefined;
}

/**
 * Build HTTP request headers, adding auth if a token is available.
 */
function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "Rokket-GSD-VSCode",
    Accept: "application/vnd.github.v3+json",
  };
  const token = getGitHubToken();
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  return headers;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startUpdateChecker(
  context: vscode.ExtensionContext,
  provider: GsdWebviewProvider
): void {
  const enabled = vscode.workspace
    .getConfiguration("gsd")
    .get<boolean>("autoUpdate", true);
  if (!enabled) return;

  const currentVersion = getInstalledVersion();
  if (!currentVersion) return;

  cachedProvider = provider;

  // Check shortly after activation (3s delay — just enough for webview to be ready)
  const initialTimer = setTimeout(
    () => checkForUpdate(context, currentVersion),
    3_000
  );
  context.subscriptions.push({ dispose: () => clearTimeout(initialTimer) });

  // Then check periodically
  const interval = setInterval(
    () => checkForUpdate(context, currentVersion),
    CHECK_INTERVAL_MS
  );
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
}

/**
 * Download a .vsix from a URL and install it via VS Code's API.
 */
export async function downloadAndInstallUpdate(
  url: string,
  context: vscode.ExtensionContext
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Rokket GSD: Downloading update...",
      cancellable: false,
    },
    async () => {
      const filename = url.split("/").pop() || "rokket-gsd-update.vsix";
      const tmpPath = path.join(os.tmpdir(), filename);

      try {
        await downloadFile(url, tmpPath);
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          vscode.Uri.file(tmpPath)
        );

        await context.globalState.update(DISMISSED_VERSION_KEY, undefined);

        const choice = await vscode.window.showInformationMessage(
          "Rokket GSD updated. Reload to activate the new version.",
          "Reload Now"
        );
        if (choice === "Reload Now") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Update failed: ${err.message}`);
      } finally {
        // Delay cleanup — VS Code may still be reading the file
        setTimeout(() => {
          try { fs.unlinkSync(tmpPath); } catch { /* ignored */ }
        }, 5000);
      }
    }
  );
}

/**
 * Dismiss a version so the user won't be prompted again.
 */
export async function dismissUpdateVersion(
  version: string,
  context: vscode.ExtensionContext
): Promise<void> {
  await context.globalState.update(DISMISSED_VERSION_KEY, version);
}

/**
 * Fetch release notes for a specific version tag from GitHub.
 * Returns the body text or null if not found.
 */
export async function fetchReleaseNotes(version: string): Promise<string | null> {
  const tag = version.startsWith("v") ? version : `v${version}`;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${tag}`;

  return new Promise((resolve) => {
    const headers = githubHeaders();
    const req = https.get(url, { headers, timeout: API_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.body || null);
        } catch {
          resolve(null);
        }
      });
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/**
 * Fetch release notes for the N most recent releases.
 */
export async function fetchRecentReleases(count = 10): Promise<Array<{ version: string; notes: string; date: string }>> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=${count}`;

  return new Promise((resolve) => {
    const headers = githubHeaders();
    const req = https.get(url, { headers, timeout: API_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve([]);
        return;
      }
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => {
        try {
          const releases = JSON.parse(data);
          resolve(
            (releases as any[])
              .filter((r: any) => r.body?.trim())
              .map((r: any) => ({
                version: (r.tag_name || "").replace(/^v/, ""),
                notes: r.body || "",
                date: r.published_at || r.created_at || "",
              }))
          );
        } catch {
          // JSON parse failed — treat as no releases
          resolve([]);
        }
      });
      res.on("error", () => resolve([]));
    });
    req.on("error", () => resolve([]));
    req.on("timeout", () => { req.destroy(); resolve([]); });
  });
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function getInstalledVersion(): string | undefined {
  const ext = vscode.extensions.getExtension("rokketek.rokket-gsd");
  return ext?.packageJSON?.version;
}

async function checkForUpdate(
  context: vscode.ExtensionContext,
  currentVersion: string
): Promise<void> {
  try {
    const release = await fetchLatestRelease();
    if (!release) return;

    const latestVersion = release.tag.replace(/^v/, "");
    if (!isNewer(latestVersion, currentVersion)) return;

    const dismissed = context.globalState.get<string>(DISMISSED_VERSION_KEY);
    if (dismissed === latestVersion) return;

    const vsixAsset = release.assets.find((a) => a.name.endsWith(".vsix"));
    if (!vsixAsset) return;

    // Route through the webview — fall back to native notification if no webview is open
    if (cachedProvider) {
      const delivered = cachedProvider.broadcast({
        type: "update_available",
        version: latestVersion,
        currentVersion,
        releaseNotes: release.body || "",
        downloadUrl: vsixAsset.url,
        htmlUrl: release.htmlUrl,
      });

      if (!delivered) {
        showNativeUpdateNotification(
          latestVersion, currentVersion, vsixAsset.url, release.htmlUrl, context
        ).catch(() => {}); // Best-effort — don't let notification errors propagate
      }
    }
  } catch {
    // Silent failure — update checks are best-effort
  }
}

async function showNativeUpdateNotification(
  latestVersion: string,
  currentVersion: string,
  downloadUrl: string,
  htmlUrl: string,
  context: vscode.ExtensionContext
): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Rokket GSD v${latestVersion} is available (you have v${currentVersion})`,
    "Update Now",
    "Release Notes",
    "Dismiss"
  );

  if (choice === "Update Now") {
    await downloadAndInstallUpdate(downloadUrl, context);
  } else if (choice === "Release Notes") {
    vscode.env.openExternal(vscode.Uri.parse(htmlUrl));
  } else if (choice === "Dismiss") {
    await dismissUpdateVersion(latestVersion, context);
  }
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

interface ReleaseInfo {
  tag: string;
  htmlUrl: string;
  body: string;
  assets: Array<{ name: string; url: string }>;
}

/** Trusted exact hostnames for GitHub API and web */
const TRUSTED_HOSTS = new Set([
  "github.com",
  "api.github.com",
]);

/** Trusted hostname suffix patterns for GitHub CDN/storage redirects */
const TRUSTED_SUFFIXES = [
  ".githubusercontent.com",
  ".s3.amazonaws.com",
];

/** Check if a URL is on a trusted host (exact match or suffix match, HTTPS only) */
function isTrustedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (TRUSTED_HOSTS.has(parsed.hostname)) return true;
    return TRUSTED_SUFFIXES.some(suffix => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

/** Check if a URL is specifically a GitHub API/web host (for auth forwarding) */
function isGitHubHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.hostname === "github.com" || parsed.hostname === "api.github.com");
  } catch {
    return false;
  }
}

/** Timeout for API calls: 30 seconds */
const API_TIMEOUT_MS = 30_000;

function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  return new Promise((resolve) => {
    const headers = githubHeaders();

    const req = https
      .get(RELEASES_API, { headers, timeout: API_TIMEOUT_MS }, (res) => {
        if (res.statusCode === 404 || res.statusCode === 403) {
          res.resume();
          resolve(null);
          return;
        }

        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          res.resume();
          if (location) {
            // Security: reject redirects to untrusted hosts
            if (!isTrustedHost(location)) {
              resolve(null);
              return;
            }
            // Preserve auth only for exact GitHub host matches
            const redirectHeaders = isGitHubHost(location)
              ? headers
              : { "User-Agent": "Rokket-GSD-VSCode" };
            const rReq = https
              .get(location, { headers: redirectHeaders, timeout: API_TIMEOUT_MS }, (rr) => collectJson(rr, resolve));
            rReq.on("error", () => resolve(null));
            rReq.on("timeout", () => { rReq.destroy(); resolve(null); });
            return;
          }
        }

        collectJson(res, resolve);
      });

    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/** Max response size for JSON API calls (1MB) */
const MAX_JSON_RESPONSE_BYTES = 1024 * 1024;

function collectJson(
  res: import("http").IncomingMessage,
  resolve: (value: ReleaseInfo | null) => void
): void {
  let data = "";
  let totalBytes = 0;
  res.on("data", (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_RESPONSE_BYTES) {
      res.destroy();
      resolve(null);
      return;
    }
    data += chunk.toString();
  });
  res.on("end", () => {
    try {
      const json = JSON.parse(data);
      resolve({
        tag: json.tag_name || "",
        htmlUrl: json.html_url || "",
        body: json.body || "",
        assets: (json.assets || []).map((a: any) => ({
          name: a.name,
          // Use API URL for private repo support — browser_download_url returns 404 without cookies
          url: a.url as string,
        })),
      });
    } catch {
      resolve(null);
    }
  });
  res.on("error", () => resolve(null));
}

/** Max redirects during download */
const MAX_REDIRECTS = 5;
/** Download timeout: 2 minutes */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Download a file, following redirects.
 * Adds GitHub auth for github.com URLs, strips it for CDN redirects.
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;

    const cleanup = (err?: Error) => {
      if (settled) return;
      settled = true;
      file.destroy();
      try { fs.unlinkSync(dest); } catch { /* ignored */ }
      if (err) reject(err);
    };

    file.on("error", (err) => cleanup(err));

    // Resolve only after the file stream is fully closed
    file.once("finish", () => {
      if (settled) return;
      settled = true;
      file.close((closeErr) => {
        if (closeErr) {
          try { fs.unlinkSync(dest); } catch { /* ignored */ }
          reject(closeErr);
          return;
        }
        resolve();
      });
    });

    const request = (downloadUrl: string, redirectCount: number = 0) => {
      if (redirectCount > MAX_REDIRECTS) {
        cleanup(new Error("[GSD-ERR-010] Download failed: too many redirects"));
        return;
      }

      // Security: only download from trusted hosts
      if (!isTrustedHost(downloadUrl)) {
        cleanup(new Error("[GSD-ERR-013] Download blocked: untrusted host"));
        return;
      }

      const headers: Record<string, string> = {
        "User-Agent": "Rokket-GSD-VSCode",
      };

      // Auth for GitHub-hosted URLs only — CDN redirects don't need it
      if (isGitHubHost(downloadUrl)) {
        const token = getGitHubToken();
        if (token) headers["Authorization"] = `token ${token}`;
        headers["Accept"] = "application/octet-stream";
      }

      const req = https
        .get(downloadUrl, { headers, timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            res.resume(); // Drain the response
            request(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            res.resume(); // Drain socket to free resources
            cleanup(new Error(`[GSD-ERR-011] Download failed: HTTP ${res.statusCode}`));
            return;
          }

          res.on("error", (err) => cleanup(err));
          res.pipe(file);
        });

      req.on("error", (err) => cleanup(err));
      req.on("timeout", () => {
        req.destroy();
        cleanup(new Error("[GSD-ERR-012] Download timed out"));
      });
    };

    request(url);
  });
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}
