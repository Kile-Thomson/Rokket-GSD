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
          try { fs.unlinkSync(tmpPath); } catch {}
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
        );
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

function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  return new Promise((resolve) => {
    const headers = githubHeaders();

    https
      .get(RELEASES_API, { headers }, (res) => {
        if (res.statusCode === 404 || res.statusCode === 403) {
          resolve(null);
          return;
        }

        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) {
            // Preserve auth for same-host redirects
            const redirectHeaders = location.includes("github.com")
              ? headers
              : { "User-Agent": "Rokket-GSD-VSCode" };
            https
              .get(location, { headers: redirectHeaders }, (rr) => collectJson(rr, resolve))
              .on("error", () => resolve(null));
            return;
          }
        }

        collectJson(res, resolve);
      })
      .on("error", () => resolve(null));
  });
}

function collectJson(
  res: import("http").IncomingMessage,
  resolve: (value: ReleaseInfo | null) => void
): void {
  let data = "";
  res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
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

/**
 * Download a file, following redirects.
 * Adds GitHub auth for github.com URLs, strips it for CDN redirects.
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const request = (downloadUrl: string) => {
      const headers: Record<string, string> = {
        "User-Agent": "Rokket-GSD-VSCode",
      };

      // Auth for GitHub-hosted URLs only — CDN redirects don't need it
      if (downloadUrl.includes("github.com") || downloadUrl.includes("api.github.com")) {
        const token = getGitHubToken();
        if (token) headers["Authorization"] = `token ${token}`;
        headers["Accept"] = "application/octet-stream";
      }

      https
        .get(downloadUrl, { headers }, (res) => {
          if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
            request(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            file.close();
            try { fs.unlinkSync(dest); } catch {}
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }

          res.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
        })
        .on("error", (err) => {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          reject(err);
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
