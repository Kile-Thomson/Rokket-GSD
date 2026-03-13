# Changelog

All notable changes to Rokket GSD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.8] — 2026-03-13

### Fixed
- UI dialogs (question popups) now force-scroll into view when rendered
- Removed `/gsd status` from slash menu — requires TUI widget support the extension doesn't have
- Removed click-to-edit on user message bubbles — removed pointer cursor and hover brightness effect

### Security
- Path traversal: `deleteSession` now validates paths are inside the sessions directory
- Command injection: health check uses `execFileSync` with args array instead of shell interpolation
- URL validation: `open_url` restricted to http/https schemes only
- Path validation: `open_file` and `open_diff` restricted to workspace directory
- Download validation: update installer only accepts GitHub URLs
- DOMPurify: removed blanket `ALLOW_DATA_ATTR: true`, explicit attribute allowlist instead
- Session ID injection: uses `JSON.stringify()` instead of string interpolation in HTML template

### Changed
- Error boundaries: both webview and extension message handlers wrapped in try/catch with unique error IDs
- Error codes: key errors tagged with `[GSD-ERR-XXX]` prefix for user reporting
- Stream error handlers added to stdout/stderr to prevent unhandled error crashes
- RPC request leak fixed: `send()` failures inside `request()` now clean up pending entries
- Force-restart race condition fixed: concurrent restarts on same session prevented via mutex
- Update checker: 30s API timeout, 2min download timeout, 5-redirect limit, 1MB response cap
- Output channel properly disposed on extension deactivation

## [Unreleased]

### Added
- Scroll-to-bottom FAB — floating ↓ button appears when scrolled up, click to jump to latest (M007/S01)
- Message timestamps — relative time on each message, updates every 30s, absolute on hover (M007/S01)
- Welcome screen quick actions — clickable chips for Auto, Status, Review (M007/S01)
- Copy full response button — hover over assistant turn to copy entire response (M007/S02)
- Toast notification system — brief auto-dismissing feedback for actions (M007/S02)
- Thinking blocks default collapsed with line count indicator, open during streaming (M007/S02)
- User message edit/resend — click a sent message to load it into the input (M007/S03)
- Drag-to-resize input area — pull the handle to make the input taller (M007/S03)
- Multi-select UI for ask_user_questions — checkbox toggle + confirm (M005 fix)

### Changed
- Smart auto-scroll — only scrolls to bottom if already near bottom, respects manual scroll position (M007/S01)
- Thinking level changes show as toasts instead of system messages (M007/S02)

### Added (M005)
- Thinking level dropdown picker — click the 🧠 badge to select from available levels (M005/S01)
- Model-aware thinking: non-reasoning models show disabled "N/A" badge, XHigh only for Opus 4.6
- Delete current session from history — starts a fresh conversation automatically (M005/S01)
- Context usage progress bar below header — green/amber/red color zones at 70%/90% thresholds (M005/S02)
- Visual separator between model/thinking and cost/context badge groups (M005/S02)
- Tool call shimmer animation on running tools (M005/S02)
- Smooth entrance animation on all overlay panels (model picker, thinking picker, history)
- Tool completion border-fade transition (M005/S02)

### Changed
- Thinking badge now opens a dropdown instead of cycling through levels (M005/S01)
- Streaming cursor uses smooth pulse animation instead of hard blink (M005/S02)
- Footer stats use labeled tokens (in/out/cache) with dot separators (M005/S02)
- Tool spinner uses subtler track color (M005/S02)
- Cost badge has bolder font-weight (M005/S02)

### Added (M004)
- GSD workflow state badge in header — shows active milestone/slice/task and phase (M004/S01)
- Auto-mode indicator (⚡ Auto, ▸ Next, ⏸ Paused) in workflow badge
- Phase-specific badge colors: blue (active), green (auto/complete), yellow (paused), red (blocked)
- STATE.md parser reads workflow state from disk, refreshes on agent turns and every 30s

### Changed
- Header components ~30% larger: badges (12px font, 28px height), buttons (12px font, 16px icons), brand (18px logo, 15px title)
- Header min-height increased from 36px to 46px
- Action button SVGs increased from 14×14 to 18×18
- Responsive breakpoints updated for new sizing

### Added (previous)
- Session history panel — browse and resume previous conversations (M002/S01)
- History button in header toolbar with clock icon
- Click a previous session to switch — chat loads full conversation history
- Historical message rendering with tool calls, thinking blocks, and markdown
- Session list shows name/preview, relative timestamps, and message count
- Current session highlighted in the list
- Session directory resolution for workspace-specific session files
- Search/filter sessions by name and message content (M002/S02)
- Keyboard navigation in session list (arrow keys, Enter to select, Escape to close)
- Rename current session from the history panel (pencil icon, inline editing)
- Delete old sessions with confirmation dialog (trash icon on hover)

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
