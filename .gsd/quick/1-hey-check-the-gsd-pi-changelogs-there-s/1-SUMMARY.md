# Quick Task: gsd-pi v2.20–v2.25 Feature Parity

**Date:** 2026-03-17
**Branch:** gsd/quick/1-hey-check-the-gsd-pi-changelogs-there-s

## What Changed

### Tool Display (icons, categories, key args)
- Added icons for `lsp` (🧠), `await_job`/`cancel_job` (⏳), `gsd_*` tools (📋)
- Added tool categories for `await_job`, `cancel_job`, `lsp`, `gsd_*` tools
- Added key arg extraction for 20+ tools introduced in v2.20–v2.25: `lsp`, `browser_batch`, `browser_find`, `browser_wait_for`, `browser_assert`, `browser_evaluate`, `browser_emulate_device`, `browser_mock_route`, `browser_extract`, `browser_type`, `github_*` (action + number), `mcp_call` (server/tool), `gsd_*` tools, `web_search`, `fetch_page`, `search_and_read`, `resolve_library`, `get_library_docs`, `await_job`, `cancel_job`, `mac_*`, `secure_env_collect`

### Slash Menu
- Added `/gsd quick` — ad-hoc task with GSD guarantees
- Added `/gsd mode` — workflow mode switching (solo/team)
- Added `/gsd help` — categorized command reference
- Added `/gsd forensics` — post-mortem analysis
- Updated `/gsd doctor` to sendOnSelect
- Updated `/gsd remote` to mention Telegram

### RPC Protocol
- Added `setSteeringMode()`, `setFollowUpMode()`, `getForkMessages()` to RPC client
- Added `sessionName`, `pendingMessageCount`, `steeringMode`, `followUpMode` to `GsdState`
- Added `set_steering_mode`, `set_follow_up_mode` webview→extension message types
- Handler cases in webview-provider for the new message types

### Command Fallback System
- Expanded `GSD_COMMAND_RE` to recognize all 20 /gsd subcommands
- Added fallback prompts for `quick`, `mode`, `help`, `forensics`, `doctor`, `visualize` subcommands (both with and without STATE.md)

### Tests
- 16 new test cases covering new tool icons, categories, and key arg extraction
- Test count: 235 → 251

## Files Modified
- `src/webview/helpers.ts` — tool icons, categories, key arg extraction
- `src/webview/helpers.test.ts` — 16 new tests
- `src/webview/slash-menu.ts` — 4 new commands, 2 updates
- `src/shared/types.ts` — GsdState fields, new message types
- `src/extension/rpc-client.ts` — 3 new RPC methods
- `src/extension/webview-provider.ts` — message handlers, command regex, fallback prompts

## Verification
- `npm run lint` — clean
- `npm test` — 251 tests pass (14 test files)
- `npm run build` — extension 139.9kb, webview 327.2kb — clean builds
