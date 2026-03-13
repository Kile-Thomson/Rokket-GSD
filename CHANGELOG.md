# Changelog

All notable changes to Rokket GSD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
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
