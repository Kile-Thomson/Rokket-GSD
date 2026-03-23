# Changelog

All notable changes to Rokket GSD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.68] — 2026-03-23

### Added
- **Async Subagent Extension** — bundled `async_subagent` and `await_subagent` tools for non-blocking subagent execution. Spawns agents in the background and returns immediately so the conversation continues. Results auto-deliver when jobs complete via `triggerTurn`.
- **Live-updating spawn cards** — async subagent cards update in real-time with turns, usage, cost, and model as background agents work. Cards transition from running (spinner) to done (green ✓) as each agent completes. Progress flows through stderr as structured JSON, intercepted by the extension host and forwarded to the webview.
- **Auto-install bundled pi extensions** — the VS Code extension ships pi-side extensions in `resources/extensions/` and auto-installs them to `~/.gsd/agent/extensions/` on activation. Version-aware: only installs when the bundled version differs.
- **Tool category support** — `async_subagent` and `await_subagent` recognized as `agent` category with 🤖 icon and proper key-arg display for single, parallel, and chain modes.
- **System prompt preference** — the async-subagent extension injects a `before_agent_start` hook that instructs the agent to always prefer `async_subagent` over the blocking `subagent` tool.

### Changed
- **Subagent tool rendering** — `isSubagent` check now matches `subagent`, `async_subagent`, and `await_subagent` for consistent card-style output rendering.
- **Tool execution updates** — `updateToolSegmentElement` now supports `searchAllEntries` mode for async updates that arrive after the originating turn ends.

## [0.2.67] — 2026-03-22

### Fixed
- **Steer note stuck during auto-mode** — the "⚡ Redirecting agent..." indicator now clears on `message_start` (when the agent begins its next response), not just `agent_start`/`agent_end`. During auto-mode the entire workflow is one agent turn, so `agent_start`/`agent_end` never fires between tasks. The note also clears on `error` and `process_exit` events.
- **Persisted steer note auto-removes** — when a steer is persisted to `OVERRIDES.md` during auto-mode, the note updates to "⚡ Override saved — applies to current and future tasks" and auto-removes after 4 seconds instead of lingering indefinitely.

## [0.2.66] — 2026-03-22

### Fixed
- **Steer note stuck forever** — the "⚡ Redirecting agent..." indicator now clears on `error` and `process_exit` events, not just `agent_start`/`agent_end`. Previously a failed steer or process crash left it visible indefinitely.
- **Silent steer drop with no client** — sending a message with no active GSD session now shows an explicit error instead of silently discarding the message.
- **Steer error clarity** — steer failures now show "Steer failed: ..." prefix so the user knows what failed.

### Added
- **Auto-mode steer persistence** — messages sent during auto-mode are now persisted to `.gsd/OVERRIDES.md` and injected into all future task prompts. Previously, steers only affected the current turn and were lost on task transitions. The steer note updates to "⚡ Override saved — applies to current and future tasks" on successful persistence.
- **`/gsd rate` subcommand** — token usage rates and profile defaults, added to command fallback and slash menu.

## [0.2.64] — 2026-03-21

### Added
- **Fork conversation button** — fork/branch icon on every completed assistant turn. Clicking it forks the conversation at that point, creating a new session with the forked messages. Uses server-side entry IDs for correct fork targeting.
- **Abort Retry button** — retry overlay now includes an "Abort Retry" button to cancel pending auto-retries.
- **`/auto-retry` slash command** — toggle auto-retry on transient errors from the slash menu, matching the `/auto-compact` pattern.
- **Streaming abort guards** — switching sessions or starting a new conversation while streaming now cleanly aborts the stream and clears all watchdog timers before proceeding.
- **Architecture documentation** — `ARCHITECTURE.md` (460 lines, 8 sections) covering three-layer architecture, message flow, module map, CSS token system, RPC protocol, data flow, build config, and testing setup.
- **Expanded CONTRIBUTING.md** — from 45→203 lines with architecture overview, test guide (mock patterns, jsdom setup), module map, and RPC protocol quick reference.
- **JSDoc on all public APIs** — 69 JSDoc blocks added across `types.ts`, `helpers.ts`, and `rpc-client.ts`. Every major type, function, and RPC method now has IDE hover documentation.
- **CI coverage gate** — `npx vitest --run --coverage` enforces ≥60% line coverage on every push/PR. 844 tests across 44 files.

### Fixed
- **Overlay visibility regression** — slash menu, model picker, thinking picker, and visualizer were invisible since M016/S02. The `style.display` → `gsd-hidden` migration left base CSS `display: none` that `classList.remove("gsd-hidden")` couldn't override. Fixed by removing base `display: none` and using `gsd-hidden` class on initial HTML elements.
- **Command fallback stomping native commands** — `/gsd config`, `/gsd keys`, `/gsd doctor`, and 20+ other subcommands that work natively in RPC mode were triggering the 500ms fallback timer, which would overwrite the native UI with an auto-execute prompt. Expanded `GSD_NATIVE_SUBCOMMANDS` from 11→33 subcommands.
- **Forge theme visual regression** — M017 theme token refactor dropped ~45 per-element Forge rules (badge colors, action button bevels/borders, tool icon/name colors, welcome chip styling, thinking dots, etc.). Restored all missing rules.
- **Stream splitting on user messages** — sending a message while the agent was responding would visually split the assistant's turn into fragments with the user bubble inserted in the middle. User messages now appear below the in-progress response without interrupting the assistant's rendering.
- **Fork entryId mapping** — fork button was sending webview-local IDs (`e-1`, `e-2`) but the server expects 8-char UUID fragments from its session manager. Now fetches server-side entry IDs via `get_fork_messages` RPC and maps them to fork buttons by user message index.

### Changed
- **Test coverage** — 46.71% → 60.45% lines (181 new tests across 12 files covering message-dispatch, dashboard, polling, toasts, model-picker, thinking-picker, file-handling, session-history, slash-menu, html-generator, captures-parser).
- **`toGsdState()` consolidation** — all 4 state construction sites now use the shared helper, adding 5 previously-dropped fields (`sessionName`, `steeringMode`, `followUpMode`, `cwd`, `pendingMessageCount`).

### Removed
- **Dead RPC methods** — `cycleModel`, `abortBash`, `getLastAssistantText`, `exportHtml` removed from `rpc-client.ts` (zero external references).

## [0.2.55] — 2026-03-19

### Added
- **Health widget** — ambient system health bar in the footer showing system status, budget, provider issues, and environment errors. Data comes from gsd-pi's `setWidget` events (requires gsd-pi ≥2.30).
- **Health tab in visualizer** — new "Health" tab in the `/gsd visualize` overlay showing system health status, budget info, environment warnings, and active model.
- **Model health indicator** — green/amber/red dot next to the model name in the auto-progress widget, reflecting current system health.
- **Widget rendering** — generic `setWidget` handler that renders any widget data sent by gsd-pi extensions. Previously these events were silently dropped.
- **Parallel worker progress cards** — during parallel auto-mode, the progress widget shows per-worker cards with milestone ID, state badges (Running/Paused/Stopped/Error), current unit, cost, and budget usage bars. Workers with stale heartbeats are dimmed with a "(stale)" indicator.
- **Budget alert toast** — a VS Code warning toast fires when any parallel worker's cost exceeds 80% of `budget_ceiling` from `.gsd/preferences.md`. Fires once per threshold crossing, resets when all workers drop below 80%.
- **Budget alert badge** — ⚠️ badge appears in the progress widget stats when any worker is over budget.
- **Validate-milestone phase** — progress widget renders `validate-milestone` as "✓ VALIDATING" with a checkmark icon.
- **Discussion-pause visibility** — when auto-mode pauses for slice discussion (`require_slice_discussion`), the progress widget shows 💬 "AWAITING DISCUSSION" with a `/gsd discuss` hint instead of disappearing.
- **New slash commands** — `/gsd update` (immediate execution) and `/gsd export` (append arguments like `--html --all`) added to the slash menu.
- **Export report command** — "Rokket GSD: Export Milestone Report" available from the VS Code command palette (`gsd.exportReport`).

### Fixed
- **Agent errors now displayed in chat** — non-retryable errors from the agent (invalid API key, permission denied, malformed requests) were silently swallowed because `message_end` never checked `stopReason: "error"`. These now surface as red system entries in the chat. Retryable errors (rate limits, 502s) also briefly show the error before the retry indicator appears, giving useful context.
- **Release workflow no longer triggers on README/CHANGELOG edits** — prevents spurious empty releases when editing docs on GitHub.

## [0.2.45] — 2026-03-17

### Added
- **Auto-mode progress widget** — during auto-mode dispatch, a sticky progress bar shows current task, phase, progress bars (tasks/slices), elapsed time, cost, and active model — polled every 3 seconds from `.gsd/` state files. Eliminates the "hung" appearance between task dispatches.
- **Dynamic model routing indicator** — when gsd-pi switches models mid-task, the header model badge flashes with a yellow highlight animation and a toast announces the change (e.g. "Model routed: Sonnet → Opus")
- **Pending captures badge** — `/gsd capture` thoughts during auto-mode are tracked; the progress widget shows a 📌 badge with the pending capture count
- **Workflow visualizer overlay** — `/gsd visualize` opens a full-page overlay with two tabs: Progress (milestone header, progress bars, slice/task breakdown, milestone registry, blockers, next action) and Metrics (cost, tool calls, model, token breakdown, context usage). Auto-refreshes every 5 seconds.
- **New slash commands** — added `/gsd visualize`, `/gsd capture`, `/gsd steer`, `/gsd knowledge`, and `/gsd config` to the slash menu, bringing command parity with gsd-pi 2.13–2.19

## [0.2.34] — 2026-03-15

### Added
- **Parallel tool execution indicator** — tools running concurrently display a ⚡ badge with pulse animation, distinguishing parallel from sequential execution (gsd-pi 2.12.0+)
- **Provider fallback notifications** — toast alerts when gsd-pi auto-switches models due to rate limits (`fallback_provider_switch`), and when the original provider recovers (`fallback_provider_restored`). Model badge and status bar update accordingly.
- **Session shutdown handling** — `session_shutdown` event produces a clean "Session ended" state instead of appearing as a crash
- **Resume last session** — "↩ Resume" button on welcome screen and `/resume` slash command to instantly resume the most recent conversation

## [0.2.25] — 2026-03-14

### Changed
- **Ping-based monitoring replaces event-based timeouts** — long-running tools (subagent, bg_shell) run 5+ minutes without emitting intermediate RPC events; the previous hard timeouts (120s/180s) would abort healthy work. Now uses health pings — if the process responds, it's alive regardless of event flow.
- **Removed client-side tool watchdog** — hang detection fully handled by extension host ping monitor. Users press Escape to interrupt manually.

## [0.2.24] — 2026-03-14

### Fixed
- **Eliminate duplicate confirmation dialogs** — dialog fingerprinting deduplicates identical confirm/select/input requests; linked duplicates get the same response automatically
- **Sidebar session reuse** — re-opening the sidebar no longer creates orphaned GSD processes or stacks duplicate message handlers (root cause of triple/quadruple confirmations)
- **Slash commands always sent as prompt** — removes unreliable steer path when `isStreaming` state is stale
- **Slash command watchdog** (10s) — detects when a slash command gets no response and retries before showing an error
- **Streaming activity monitor** (120s) — auto-aborts stalled agent turns and force-pushes `agent_end` if the abort doesn't produce one
- **Tool watchdog auto-recovery** — auto-sends interrupt on timeout + 15s force-clear safety net instead of passive warning
- **Interrupt failure recovery** — failed aborts now clear streaming state and notify the webview instead of silently swallowing
- **Process exit full cleanup** — all tracking maps (activity timers, watchdogs, streaming state) properly cleaned on process exit
- **Launch guard** — prevents launching duplicate GSD processes for the same session

## [0.2.23] — 2026-03-14

### Fixed
- **Slash commands work during streaming** — `/gsd auto`, `/gsd stop`, and other slash commands now execute even when the agent is mid-response (aborts stream first, then sends command)
- **Prompt watchdog false alarms** — extension commands no longer trigger "GSD accepted the command but didn't start processing" errors
- **User messages render above streaming response** — messages sent during streaming now appear in correct order
- **Case-insensitive `/gsd status`** check

## [0.2.11] — 2026-03-13

### Added
- File attachment support — attach non-image files via paperclip button, drag-and-drop, or paste
- File chips UI — attached files shown as removable chips with type-specific icons in the input area and sent messages
- Drag-and-drop file paths from VS Code explorer and OS file manager
- File access validation — warns when attached files aren't readable

### Fixed
- **Infinite node process spawning** — VS Code extension host Electron env vars (`NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, `VSCODE_*`) were leaking into GSD's subprocess tree, causing child processes (e.g. Next.js dev server CSS workers) to crash-restart in a loop (144+ processes, 6.5GB RAM)
- Sanitized environment for GSD child process — strips all Electron/VS Code internals before spawning

## [0.2.10] — 2026-03-13

### Fixed
- Auto-update download blocked with GSD-ERR-013 "untrusted host" — GitHub redirects VSIX downloads to S3 CDN which wasn't in the trusted hosts allowlist

## [0.2.9] — 2026-03-13

### Added
- Scroll-to-bottom FAB — floating ↓ button appears when scrolled up, click to jump to latest (M007)
- Message timestamps — relative time on each message, updates every 30s, absolute on hover (M007)
- Welcome screen quick actions — clickable chips for Auto, Status, Review (M007)
- Copy full response button — hover over assistant turn to copy entire response (M007)
- Toast notification system — brief auto-dismissing feedback for actions (M007)
- Thinking blocks default collapsed with line count indicator, open during streaming (M007)
- Drag-to-resize input area — pull the handle to make the input taller (M007)
- Multi-select UI for ask_user_questions — checkbox toggle + confirm (M005)
- Thinking level dropdown picker — click the 🧠 badge to select from available levels (M005)
- Model-aware thinking: non-reasoning models show disabled "N/A" badge, XHigh only for Opus 4.6 (M005)
- Delete current session from history — starts a fresh conversation automatically (M005)
- Context usage progress bar below header — green/amber/red color zones at 70%/90% thresholds (M005)
- Tool call shimmer animation on running tools (M005)
- GSD workflow state badge in header — shows active milestone/slice/task and phase (M004)
- Auto-mode indicator (⚡ Auto, ▸ Next, ⏸ Paused) in workflow badge (M004)
- Session history panel — browse, search, rename, and resume previous conversations (M002)
- Process resilience: spawn hardening, forceKill, health monitoring, tool watchdog, force-restart UI (M003)

### Fixed
- UI dialogs no longer auto-reject/expire silently — pending dialogs tracked, expired visually with ⏱ icon when backend moves on
- Dialog timeout race condition fixed — countdown uses `timeout - 2s` safety margin so user clicks aren't swallowed at the boundary
- Dialogs arriving while GSD panel is hidden now trigger a native VS Code notification with "Open GSD" button
- Dialogs expire automatically on agent_start, agent_end, and process_exit events
- `/gsd` slash commands now work reliably — process_status: "running" sent only after getState() confirms readiness
- Commands proactively pushed by extension after startup and restart (no longer relies on webview requesting them)
- `commandsLoaded` and `commands` state properly reset on process crash/restart/exit
- `get_commands` handler retries after 2s if client not running, sends empty array on failure
- UI dialogs (question popups) now force-scroll into view when rendered
- Removed `/gsd status` from slash menu — requires TUI widget support the extension doesn't have
- Removed click-to-edit on user message bubbles — removed pointer cursor and hover brightness effect

### Security
- Path traversal: `deleteSession` now validates paths are inside the sessions directory
- Command injection: health check uses `execFileSync` with args array instead of shell interpolation
- URL validation: `open_url` restricted to http/https schemes only
- Path validation: `open_file` and `open_diff` restricted to workspace directory with symlink resolution
- Download validation: update installer only accepts GitHub URLs
- DOMPurify: removed blanket `ALLOW_DATA_ATTR: true`, explicit attribute allowlist instead
- Session ID injection: uses `JSON.stringify()` instead of string interpolation in HTML template

### Changed
- Smart auto-scroll — only scrolls to bottom if already near bottom, respects manual scroll position (M007)
- Header components ~30% larger with updated responsive breakpoints (M004)
- Error boundaries: both webview and extension message handlers wrapped in try/catch with unique error IDs
- Error codes: key errors tagged with `[GSD-ERR-XXX]` prefix for user reporting
- Stream error handlers added to stdout/stderr to prevent unhandled error crashes
- RPC request leak fixed: `send()` failures inside `request()` now clean up pending entries
- Force-restart race condition fixed: concurrent restarts on same session prevented via mutex
- Update checker: 30s API timeout, 2min download timeout, 5-redirect limit, 1MB response cap
- Output channel properly disposed on extension deactivation

## [0.2.1] - 2026-03-12

### Changed
- Split monolithic webview/index.ts (2,149 lines) into 7 focused modules: state, helpers, slash-menu, model-picker, ui-dialogs, renderer, index (M001/S01)
- All modules use init(deps) pattern for clean dependency injection

### Removed
- Empty `tool_permission_response` handler and message type
- Duplicate `compactContext` RPC method (use `compact` instead)

### Fixed
- Added DOMPurify for markdown HTML sanitization
- Added URL scheme allowlist via `sanitizeUrl()`
- Fixed bg_shell tool categorization (returns "process" not "shell")
- Added missing `available_models`, `bash_result`, `thinking_level_changed` to ExtensionToWebviewMessage type union
- Eliminated all `as any` casts in message handlers (25 total) with proper typed interfaces

## [0.2.0] - 2026-03-12

### Added
- Sequential streaming renderer — text, thinking, and tool calls render in arrival order
- Full markdown rendering with syntax-highlighted code blocks, tables, images
- Tool call visualization with category icons, collapsible output, duration tracking
- Subagent results rendered as rich markdown
- Model picker grouped by provider with context window and reasoning tags
- Thinking level cycling (off/minimal/low/medium/high/xhigh)
- Slash command menu with GSD subcommands and built-in actions
- Inline UI dialogs (confirm/select/input) rendered in chat flow
- Image paste/drop with base64 attachment support
- Steer-while-streaming — send messages while agent is working
- Auto-compaction and auto-retry overlay indicators
- Crash recovery with restart button
- `!command` bash shortcut
- Status bar integration (streaming state, model, session cost)
- File path click-to-open and URL link handling
- Copy button on all code blocks
- VS Code theme-aware styling
- One-liner install scripts for macOS/Linux and Windows
