# Changelog

All notable changes to Rokket GSD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.49] — 2026-04-28

### Added
- **Voice transcription in chat** — hold-to-record microphone button in the input area with real-time waveform visualizer; audio transcribed via configurable provider (OpenAI Whisper, Azure Speech Services, or xAI) and inserted as text
- **Multi-provider voice settings** — dropdown to switch between OpenAI, Azure, and xAI transcription providers with per-provider API key storage in SecretStorage
- **API key validation** — saving a voice provider API key triggers a lightweight verification call; badges show "…" (verifying), "✓" (valid), or "✗" (invalid) next to each provider
- **Azure region field** — labeled input with tooltip explaining where to find the region identifier in the Azure Portal

### Fixed
- **Voice provider radio button flicker** — switching providers now syncs state from the extension host (source of truth) instead of optimistic local updates that could desync

## [0.3.47] — 2026-04-27

### Fixed
- **Question dialogs render inline** — question dialogs now appear within the streaming turn instead of stacking at the bottom of the chat

### Changed
- **Updated README and branding** — marketplace listing now reflects new Rokketek logo and updated documentation

## [0.3.46] — 2026-04-27

### Fixed
- **Parallel agent detection & card display** — fixed parallel batch detection and agent card rendering in sidebar

## [0.3.45] — 2026-04-27

### Added
- **Telegram integration** — full relay bridge between Telegram and GSD sessions with voice transcription (OpenAI Whisper), photo attachments, topic threading, and guided setup wizard (`/gsd telegram-setup`)
- **Agent card subagent labels** — completed agent cards now show the agent type (e.g. "Explore", "Plan") instead of generic "Agent"
- **Rokketek branding** — updated logo across README and VS Code marketplace

### Fixed
- **Permission dialogs no longer auto-denied** — removed dedup/cache behavior that was silently rejecting confirm dialogs
- **Shell environment resolution** — failed lookups no longer cache permanently; retries on subsequent calls
- **Environment sanitization** — child process env no longer reintroduces stripped variables

### Changed
- **Test coverage** — 842 → 1370 tests across 66 files

## [0.3.40] — 2026-04-22

### Fixed
- **Parallel batch streaming** — batch grouping now tracks per-delta granularity for correct tool→batch mapping; narration text no longer splits across batch boundaries
- **Parallel batch finalization** — deferred until `message_end` arrives, preventing premature closure during streaming
- **Context percentage accuracy** — fixed several recomputation paths that produced incorrect context usage percentages
- **Accessibility regressions** — repaired a11y and initialization regressions from parallel batch work
- **Toast truncation** — long toast messages no longer overflow the sidebar

### Changed
- **Module decomposition** — extracted `AutoProgressPoller` lifecycle hooks, guarded cost accumulation against NaN/Infinity, zero `any` types across the codebase
- **Test coverage** — 46 new tests, expanded CI coverage

## [0.3.18] — 2026-04-13

### Added
- **Parallel batch tracker** — concurrent tool calls grouped into a visual container with shared header, elapsed timer, per-tool status bars, and usage footer
- **Richer tool cards** — tool headers show descriptions instead of raw commands, shortened file paths, and cache read/write token counts
- **Cost tracking** — accurate per-turn token and cost reporting from `cost_update` events

### Fixed
- **Thinking level override** — setting thinking to "off" no longer gets overridden by incoming events; picker waits for backend confirmation
- **Streaming cursor** — cursor no longer appears on wrong text block before tool calls
- **Context usage percentage** — fixed incorrect percentage calculations in visualizer

## [0.3.5] — 2026-04-11

### Fixed
- **Error handler cleanup** — process error handler now properly clears pending request timers
- **Windows console flash** — hidden console window on health check subprocess

### Changed
- **Polling performance** — all poll cycles parallelized (~50% faster auto-mode polling)
- **CSS fully tokenized** — all hardcoded colors replaced with semantic design tokens; light themes now render correctly throughout
- **Badge theming** — skill-pill and toast badges use design tokens

### Added
- **Crash overlay diagnostics** — shows exit code and up to 500 chars of diagnostic context
- **Keyboard accessibility** — focus-visible on 4 more interactive elements, aria-activedescendant on slash menu
- **Compaction toast** — "Context compacted successfully" feedback on compaction end

## [0.3.2] — 2026-04-08

### Added
- **Server-side tool rendering** — compact inline cards for Anthropic's native server-side tools (web search, code execution). Shows tool name, optional search query, spinner while running, and result count on completion. Requires gsd-pi v2.59+.

## [0.3.1] — 2026-04-06

### Fixed
- **Async-subagent extension non-destructive** — bundled extension no longer overwrites user-modified CLI copies; version comparison is strictly newer-only
- **File link handling** — drag-drop, click-to-open, and relative path resolution all work correctly for markdown file links

## [0.3.0] — 2026-04-04

### Fixed
- **Buffer overflow safety** — partial lines preserved on buffer overflow instead of discarding, preventing JSON-RPC stream corruption
- **Force restart guard** — `force_restart` timeout guarded against disposed sessions
- **Session memory leak** — session Map entry deleted on cleanup (was accumulating indefinitely)
- **Dialog memory leak** — expired `resolvedResponses` entries swept periodically (was growing unbounded)

### Changed
- **Async activation** — `installBundledExtensions` converted to async to unblock extension host activation

## [0.2.76] — 2026-03-30

### Added
- **Instant response feedback** — thinking dots appear the moment you send a message, before the agent starts processing
- **Per-token streaming** — text renders token-by-token instead of in chunks, with cached markdown lexing for performance

### Changed
- **Streaming performance** — first visible output appears a frame earlier; scroll decoupled from render loop to eliminate layout thrashing; tool and subagent cards patch in-place instead of rebuilding DOM

### Fixed
- **Animations on Windows** — reduced-motion accessibility setting no longer freezes thinking dots and spinners after one loop
- **Response content merging** — multiple assistant responses no longer concatenate into one block
- **Word duplication during streaming** — text no longer duplicates when live rendering catches up with parsed output
- **Subagent usage pills duplicating** — fixed selector mismatch causing pills to stack on each progress update

## [0.2.75] — 2026-03-26

### Fixed
- **Compaction hang** — added timeouts to `compact()` (300s) and `get_messages()` (60s) to prevent indefinite hangs
- **Error state not cleared** — agent errors now properly clear streaming state instead of leaving it stuck
- **Stale webview listeners** — all event listeners rebound when sidebar is hidden and re-shown
- **Cross-platform export** — HTML export path works on macOS/Linux (was Windows-only)
- **Session switch cleanup** — pruned message count resets correctly; path traversal validated

### Changed
- **Polling performance** — RPC and filesystem calls parallelized (~50% faster poll cycles); idle polling gated to reduce unnecessary calls

### Added
- **Full theme support** — 26 new design tokens; visualizer, badges, and all components now respect the active VS Code theme
- **Crash diagnostics** — crash overlay shows exit details inline instead of generic error
- **Keyboard accessibility** — focus-visible rings on 10 interactive elements; screen reader announcements in slash menu
- **Toast overflow protection** — long messages no longer overflow the sidebar

## [0.2.69] — 2026-03-23

### Fixed
- **Bundled extension install** — use proper semver comparison so a user-updated extension isn't downgraded by a bundled older version.
- **Stale webview reference** — async subagent progress now resolves the current webview at send time instead of closing over the launch-time reference.
- **Stderr line buffering** — progress JSON is now line-buffered to handle chunk splits across `data` events.
- **Failed subagent rendering** — cards now show error state (red) when background agents fail instead of neutral completion.
- **Type safety** — added `async_subagent_progress` to `ExtensionToWebviewMessage` union, removed `as any` casts.

## [0.2.68] — 2026-03-23

### Added
- **Async subagent execution** — spawn background agents that run in parallel while the conversation continues. Live-updating cards show progress, usage, and cost per agent with spinner→checkmark transitions on completion.
- **Auto-install bundled extensions** — VS Code extension auto-installs pi-side extensions on activation (version-aware, won't overwrite newer user copies)

## [0.2.66] — 2026-03-22

### Added
- **Auto-mode steer persistence** — messages sent during auto-mode are persisted and injected into all future task prompts, not just the current turn
- **`/gsd rate` subcommand** — token usage rates and profile defaults

### Fixed
- **Steer indicator stuck** — the "Redirecting agent..." note now clears properly on errors, crashes, and auto-mode task transitions
- **Silent steer drop** — sending a message with no active session now shows an explicit error

## [0.2.64] — 2026-03-21

### Added
- **Fork conversation** — fork/branch icon on every assistant turn to branch the conversation at that point
- **Abort Retry button** — cancel pending auto-retries from the retry overlay
- **`/auto-retry` slash command** — toggle auto-retry on transient errors
- **CI coverage gate** — enforces ≥60% line coverage on every push/PR (844 tests across 44 files)

### Fixed
- **Overlay visibility regression** — slash menu, model picker, thinking picker, and visualizer were invisible after theme refactor
- **Slash commands stomping native commands** — 20+ GSD subcommands no longer get intercepted by the fallback timer
- **Forge theme regression** — restored ~45 missing theme rules dropped during token refactor
- **Stream splitting on user messages** — sending a message while streaming no longer splits the assistant's response

### Changed
- **Test coverage** — 46% → 60% lines across 44 files

## [0.2.55] — 2026-03-19

### Added
- **Health widget** — ambient system health bar in the footer showing status, budget, provider issues, and environment errors
- **Health tab in visualizer** — system health, budget info, environment warnings, and active model
- **Parallel worker monitoring** — per-worker progress cards with state badges, cost tracking, and budget usage bars during parallel auto-mode
- **Budget alerts** — warning toast and badge when any worker exceeds 80% of budget ceiling
- **Discussion pause visibility** — progress widget shows "AWAITING DISCUSSION" when auto-mode pauses for slice discussion
- **New commands** — `/gsd update`, `/gsd export`, and "Export Milestone Report" in the command palette

### Fixed
- **Agent errors displayed in chat** — non-retryable errors (invalid API key, permission denied) now surface as red system entries instead of being silently swallowed

## [0.2.45] — 2026-03-17

### Added
- **Auto-mode progress widget** — sticky progress bar showing current task, phase, progress bars, elapsed time, cost, and active model during auto-mode dispatch
- **Dynamic model routing indicator** — model badge flashes and a toast announces when gsd-pi switches models mid-task
- **Workflow visualizer** — `/gsd visualize` opens a full-page overlay with Progress and Metrics tabs, auto-refreshing every 5 seconds
- **New slash commands** — `/gsd visualize`, `/gsd capture`, `/gsd steer`, `/gsd knowledge`, `/gsd config`

## [0.2.34] — 2026-03-15

### Added
- **Parallel tool execution indicator** — concurrent tools display a pulse-animated badge
- **Provider fallback notifications** — toasts when models auto-switch due to rate limits, and when the original recovers
- **Resume last session** — "Resume" button on welcome screen and `/resume` slash command

## [0.2.25] — 2026-03-14

### Changed
- **Ping-based health monitoring** — long-running tools no longer get killed by hard timeouts; health pings determine liveness

## [0.2.24] — 2026-03-14

### Fixed
- **Duplicate confirmation dialogs** — dialog fingerprinting deduplicates identical requests; sidebar no longer creates orphaned processes
- **Slash command reliability** — 10s watchdog detects unresponsive commands; streaming activity monitor auto-aborts stalled turns
- **Process cleanup** — all timers, watchdogs, and streaming state properly cleaned on process exit; launch guard prevents duplicate processes

## [0.2.23] — 2026-03-14

### Fixed
- **Slash commands during streaming** — commands now execute even when the agent is mid-response
- **Message ordering** — user messages sent during streaming appear in correct order

## [0.2.11] — 2026-03-13

### Added
- **File attachments** — attach files via paperclip button, drag-and-drop, or paste with type-specific chip UI and access validation

### Fixed
- **Infinite node process spawning** — VS Code Electron env vars leaking into subprocess tree caused child processes to crash-restart in a loop (144+ processes, 6.5GB RAM). Environment is now sanitized before spawning.

## [0.2.10] — 2026-03-13

### Fixed
- **Auto-update downloads blocked** — GitHub CDN redirects now accepted in trusted hosts allowlist

## [0.2.9] — 2026-03-13

### Added
- **Scroll-to-bottom button** — floating button appears when scrolled up
- **Message timestamps** — relative time on each message, absolute on hover
- **Welcome screen quick actions** — clickable chips for common commands
- **Copy full response** — hover over assistant turn to copy entire response
- **Toast notifications** — brief auto-dismissing feedback for actions
- **Collapsible thinking blocks** — collapsed by default with line count, open during streaming
- **Resizable input area** — drag-to-resize handle
- **Multi-select question UI** — checkbox toggle + confirm for multi-option questions
- **Thinking level picker** — dropdown to select thinking level, model-aware (disables on non-reasoning models)
- **Context usage bar** — progress bar below header with green/amber/red thresholds
- **Workflow state badge** — shows active milestone/slice/task and auto-mode phase in header
- **Session history** — browse, search, rename, and resume previous conversations
- **Process resilience** — spawn hardening, health monitoring, tool watchdog, force-restart UI

### Fixed
- **Dialog reliability** — dialogs no longer auto-reject silently; timeout race condition fixed; hidden-panel dialogs trigger native notifications
- **Slash command reliability** — commands work reliably after startup, restart, and crash recovery

### Security
- Path traversal, command injection, URL validation, download validation, and DOMPurify hardening across all user-facing surfaces

### Changed
- **Smart auto-scroll** — respects manual scroll position
- **Error boundaries** — all message handlers wrapped with unique error codes for reporting

## [0.2.1] - 2026-03-12

### Changed
- **Modular architecture** — split monolithic 2,149-line webview into 7 focused modules with dependency injection
- **DOMPurify** — markdown HTML sanitization and URL scheme allowlisting

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
