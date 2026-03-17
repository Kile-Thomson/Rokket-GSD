# S02: Event Handling & Diagnostics

**Delivered:** Fixed fallback_chain_exhausted handling, cross-platform export, rpc-client diagnostics, and tool icon coverage.

## What Was Built

- Handled `fallback_chain_exhausted` event with user-friendly error message
- Fixed HTML export to use `vscode.env.openExternal` (works on macOS/Linux, not just Windows)
- Removed unused `child_process` import from export handler
- Fixed `message_update` field name: `assistantMessageEvent` is the actual pi event field, not `delta`
- Added tool icons for `github_*`, `mcp_*`, `ask_user_questions`, `secure_env_collect`, `discover_configs`, `async_bash`, `web_search`

## Files Modified

- `src/webview/message-handler.ts` — fallback_chain_exhausted handler, message_update field fix
- `src/extension/webview-provider.ts` — cross-platform export fix
- `src/webview/helpers.ts` — new tool icons
