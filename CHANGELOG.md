# Changelog

All notable changes to Rokket GSD will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Split monolithic webview/index.ts (2,149 lines) into 7 focused modules: state, helpers, slash-menu, model-picker, ui-dialogs, renderer, index (M001/S01)
- All modules use init(deps) pattern for clean dependency injection

### Fixed
- Added DOMPurify for markdown HTML sanitization
- Added URL scheme allowlist via `sanitizeUrl()`
- Fixed bg_shell tool categorization (returns "process" not "shell")

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
