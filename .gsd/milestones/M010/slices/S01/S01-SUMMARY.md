# S01: Parallel Tool Indicator & New Event Handling

**Delivered:** Parallel tool detection with ⚡ badge, fallback provider toasts, and session_shutdown handling.

## What Was Built

- **Parallel tool detection** in `message-handler.ts`: tracks in-flight tool count during `tool_execution_start`; when 2+ tools are running simultaneously, all concurrent tools get `isParallel: true`
- **⚡ concurrent badge** in `renderer.ts`: parallel tools display a pulsing ⚡ badge next to the tool name
- **CSS animation** in `styles.css`: `.parallel-pulse` keyframe animates the badge while tools are running
- **`fallback_provider_switch` handler**: updates model badge, fires toast with from→to provider info
- **`fallback_provider_restored` handler**: restores original model badge, fires restoration toast
- **`fallback_chain_exhausted` handler**: fires error toast when all fallback providers are exhausted
- **`session_shutdown` handler**: sets `isStreaming: false` and `processStatus: stopped` for clean UI state
- **`extension_error` handler**: surfaces extension-level errors as system entries

## Test Coverage

- `parallel-tools.test.ts` — 5 tests: single tool not parallel, second concurrent marks both, third concurrent, sequential not parallel, mixed overlap
- `fallback-events.test.ts` — 4 tests: parse from/to fields, model state update, provider restore, session shutdown clean state

## Files Modified

- `src/webview/message-handler.ts` — parallel detection logic + new event handlers
- `src/webview/renderer.ts` — parallel badge rendering
- `src/webview/state.ts` — `isParallel` field on ToolCallState
- `src/webview/styles.css` — parallel badge styling and animation
- `src/extension/webview-provider.ts` — event routing for new event types
