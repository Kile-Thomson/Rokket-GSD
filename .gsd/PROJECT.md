# Project

## What This Is

Rokket GSD is a VS Code extension that wraps the GSD (gsd-pi) AI coding agent into a native chat panel. It provides a full-featured chat UI with streaming message rendering, tool call visualization, model switching, slash commands, and workflow automation — all running inside VS Code as a sidebar or editor tab.

## Core Value

A seamless, performant chat UI for the GSD agent inside VS Code — streaming responses render smoothly, tool calls are visualized in real time, and the agent can be steered mid-execution.

## Current State

**Version:** 0.2.41 — fully functional, published to GitHub Releases.
**gsd-pi compatibility:** v2.12–v2.25

### What works:
- Sequential segment-based streaming renderer (text, thinking, tool calls render in arrival order via rAF batching)
- Full markdown rendering with syntax-highlighted code blocks, tables, images
- Tool call visualization with category icons, collapsible output, duration tracking, smart truncation
- Rich key arg display for 40+ tools (lsp, browser_*, github_*, gsd_*, mcp_call, etc.)
- Subagent results rendered as rich markdown with usage pills
- Model picker (grouped by provider, context window, reasoning tags)
- Thinking level dropdown picker (model-aware, shows available levels with descriptions)
- Slash command menu with 22 GSD subcommands + 8 built-in actions
- Inline UI dialogs (confirm/select/input/editor) rendered in chat flow
- Image paste/drop with base64 attachment support
- File attachment support
- Steer-while-streaming (send messages while agent is working)
- Auto-compaction and auto-retry overlay indicators
- Parallel tool execution indicator (⚡ badge with pulse animation when tools run concurrently)
- Provider fallback notifications (switch, restore, chain exhausted)
- Resume last session (welcome chip + /resume slash command)
- Auto-mode progress bar with milestone/slice/task tracking, cost, model routing
- Dynamic model routing indicator
- Pending captures badge in auto-progress
- Dashboard panel with milestone registry, slice/task progress, metrics, projections
- Process resilience: direct node spawn (no cmd.exe wrapper), health monitoring, force-kill/restart UI
- Crash recovery with restart button
- `!command` bash shortcut
- Status bar integration (streaming state, model, cost)
- File path click-to-open and URL link handling
- Tool call grouping — consecutive read-only tools collapse into expandable summary rows
- Copy button on all code blocks
- VS Code theme-aware styling
- Session history panel — browse, search, rename, delete, and resume previous conversations
- HTML export (cross-platform)
- What's New overlay on version upgrade
- Changelog viewer
- Update notification with install/dismiss/view-release actions
- One-liner install scripts for macOS/Linux (bash) and Windows (PowerShell)

### What's incomplete or missing:
- `fork_conversation` is wired but produces no UI feedback beyond the RPC call
- No dedicated UI for steering/follow-up mode switching (RPC methods exist)

## Architecture / Key Patterns

**Tech stack:** TypeScript, esbuild (bundler), marked (markdown), vanilla DOM (no framework)

**Three-layer architecture:**
```
Webview (IIFE, browser) ←→ Extension Host (CJS, Node) ←→ gsd --mode rpc (child process)
       postMessage                stdin/stdout JSONL
```

**Key patterns:**
- **Message protocol:** ~50 webview→extension message types, ~35 extension→webview types (defined in `src/shared/types.ts`)
- **Sequential segment rendering:** Each assistant turn is an ordered array of `TurnSegment` (text/thinking/tool). Segments are appended as they arrive with no re-renders of earlier segments. DOM updates batched via `requestAnimationFrame`.
- **Multi-session support:** Each sidebar/tab gets its own `sessionId`, RPC client, and child process. Per-session state consolidated in a `SessionState` object.
- **No framework:** Vanilla DOM manipulation throughout — keeps bundle small (~140KB extension, ~327KB webview)
- **CSS variables:** All styling uses VS Code's CSS custom properties for theme awareness
- **GSD command fallback:** RPC mode can't display interactive wizards. Extension detects missing agent turns and sends contextual fallback prompts for all /gsd subcommands.

**File structure:**
```
src/extension/index.ts            — Entry point, commands, status bar
src/extension/rpc-client.ts       — JSON-RPC client over stdin/stdout
src/extension/webview-provider.ts — Webview lifecycle, message routing, session management
src/extension/state-parser.ts     — Parse .gsd/STATE.md for workflow state
src/extension/dashboard-parser.ts — Parse .gsd/ files for dashboard data
src/extension/metrics-parser.ts   — Parse .gsd/metrics.json for cost/token data
src/extension/captures-parser.ts  — Parse .gsd/captures/ for pending captures
src/extension/auto-progress.ts    — Auto-mode progress polling and aggregation
src/shared/types.ts               — Message protocol types
src/webview/state.ts              — Types + shared mutable state
src/webview/helpers.ts            — Pure functions, markdown, tool helpers
src/webview/slash-menu.ts         — Slash command palette
src/webview/model-picker.ts       — Model selection overlay
src/webview/ui-dialogs.ts         — Inline confirm/select/input dialogs
src/webview/renderer.ts           — Entry rendering + streaming segments
src/webview/message-handler.ts    — Webview message dispatch
src/webview/auto-progress.ts      — Auto-mode progress bar rendering
src/webview/dashboard.ts          — Dashboard panel rendering
src/webview/keyboard.ts           — Keyboard shortcuts
src/webview/ui-updates.ts         — UI state updates and DOM manipulation
src/webview/index.ts              — DOM setup, events, initialization
src/webview/styles.css            — Theme-aware styling
```

## Operating Notes

- **Changelog:** `CHANGELOG.md` at project root must be updated on every slice completion and PR merge. Use [Keep a Changelog](https://keepachangelog.com/) format.

- **Releases:** Distribution is via GitHub Releases with a `.vsix` artifact attached. A GitHub Actions workflow (`.github/workflows/release.yml`) handles this automatically:
  1. Bump `version` in `package.json`
  2. Commit and push
  3. Tag: `git tag v<version> && git push origin v<version>`
  4. CI builds, packages, and creates a GitHub Release with the `.vsix` attached

- **VSIX hygiene:** `.vscodeignore` controls what ships in the package. Only `dist/`, `resources/`, `package.json`, `readme.md`, `changelog.md`, and install scripts should be included.

## Milestone Sequence

- [x] M001: Polish & Hardening
- [x] M002: Conversation History
- [x] M003: Process Resilience & Hang Protection
- [x] M004: Header Enhancements
- [x] M005: UI Interactions & Polish
- [x] M006: Testing & Quality
- [x] M007: UX Polish & Interaction Improvements
- [x] M008: Hardening, Performance & UX
- [x] M009: Dashboard Metrics & CLI Parity
- [x] M010: gsd-pi 2.12 Feature Parity
- [x] M011: Codebase Quality & Robustness
- [x] M012: gsd-pi 2.13–2.19 Feature Parity & Auto-Mode Visibility
