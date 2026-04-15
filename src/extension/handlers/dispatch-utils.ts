import * as vscode from "vscode";
import { buildDashboardData } from "../dashboard-parser";
import { loadMetricsLedger, buildMetricsData } from "../metrics-parser";
import type { MessageDispatchContext } from "../message-dispatch";
import type { ExtensionToWebviewMessage } from "../../shared/types";

export async function sendDashboardData(
  ctx: MessageDispatchContext,
  webview: vscode.Webview,
  sessionId: string,
): Promise<void> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  try {
    const data = await buildDashboardData(cwd);
    if (data) {
      const client = ctx.getSession(sessionId).client;
      if (client?.isRunning) {
        try {
          const statsResult = await client.getSessionStats() as Record<string, unknown> | null;
          if (statsResult) {
            data.stats = {
              cost: statsResult.cost as number | undefined,
              tokens: statsResult.tokens as { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } | undefined,
              toolCalls: statsResult.toolCalls as number | undefined,
              userMessages: statsResult.userMessages as number | undefined,
            };
            ctx.applySessionCostFloor(sessionId, data.stats);
          }
        } catch {
          // Stats not available — that's fine
        }
      }
    }
    if (data) {
      try {
        const ledger = await loadMetricsLedger(cwd);
        if (ledger && ledger.units.length > 0) {
          const remainingSlices = data.slices.filter(s => !s.done).length;
          data.metrics = buildMetricsData(ledger, remainingSlices);
        }
      } catch {
        // Metrics not available — that's fine
      }
    }
    ctx.postToWebview(webview, { type: "dashboard_data", data } as ExtensionToWebviewMessage);
  } catch (_err: unknown) {
    ctx.postToWebview(webview, { type: "dashboard_data", data: null } as ExtensionToWebviewMessage);
  }
}
