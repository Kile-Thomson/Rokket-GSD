import * as vscode from "vscode";

// ============================================================
// HTML Generator — webview HTML template and nonce utility
// ============================================================

/** Generate a cryptographic nonce for Content Security Policy */
export function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return nonce;
}

/** Build the full HTML document for a GSD webview panel or sidebar */
export function getWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview, sessionId: string): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.js")
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "index.css")
  );

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Rokket GSD</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.GSD_SESSION_ID = ${JSON.stringify(sessionId)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
