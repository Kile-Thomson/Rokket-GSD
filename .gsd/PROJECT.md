# Project

## What This Is

Rokket GSD is a VS Code extension that wraps the GSD (gsd-pi) AI coding agent into a native chat panel. It provides a full-featured chat UI with streaming message rendering, tool call visualization, model switching, slash commands, and workflow automation — all running inside VS Code as a sidebar or editor tab.

## Core Value

A seamless, performant chat UI for the GSD agent inside VS Code — streaming responses render smoothly, tool calls are visualized in real time, and the agent can be steered mid-execution.

## Current State

**Version:** 0.2.0 — fully functional and usable.

### What works:
- Sequential segment-based streaming renderer (text, thinking, tool calls render in arrival order via rAF batching)
- Full markdown rendering with syntax-highlighted code blocks, tables, images
- Tool call visualization with category icons, collapsible output, duration tracking, smart truncation
- Subagent results rendered as rich markdown
- Model picker (grouped by provider, context window, reasoning tags)
- Thinking level dropdown picker (model-aware, shows available levels with descriptions)
- Slash command menu with 11 GSD subcommands + 5 built-in actions
- Inline UI dialogs (confirm/select/input) rendered in chat flow
- Image paste/drop with base64 attachment support
- Steer-while-streaming (send messages while agent is working)
- Auto-compaction and auto-retry overlay indicators
- Process resilience: direct node spawn (no cmd.exe wrapper), 180s tool watchdog, 30s health monitoring, force-kill/restart UI
- Crash recovery with restart button
- `!command` bash shortcut
- Status bar integration (streaming state, model, cost)
- File path click-to-open and URL link handling
- Tool call grouping — consecutive read-only tools collapse into expandable summary rows
- Copy button on all code blocks
- VS Code theme-aware styling
- Session history panel — browse, search, rename, and resume previous conversations
- One-liner install scripts for macOS/Linux (bash) and Windows (PowerShell)

### What's incomplete or missing:
- `fork_conversation` is wired but produces no UI feedback
- `followUpQueue` is declared but never used
- `tool_permission_response` handler is empty

## Architecture / Key Patterns

**Tech stack:** TypeScript, esbuild (bundler), marked (markdown), vanilla DOM (no framework)

**Three-layer architecture:**
```
Webview (IIFE, browser) ←→ Extension Host (CJS, Node) ←→ gsd --mode rpc (child process)
       postMessage                stdin/stdout JSONL
```

**Key patterns:**
- **Message protocol:** 25 webview→extension message types, 22 extension→webview types (defined in `src/shared/types.ts`)
- **Sequential segment rendering:** Each assistant turn is an ordered array of `TurnSegment` (text/thinking/tool). Segments are appended as they arrive with no re-renders of earlier segments. DOM updates batched via `requestAnimationFrame`.
- **Multi-session support:** Each sidebar/tab gets its own `sessionId`, RPC client, and child process
- **No framework:** Vanilla DOM manipulation throughout — keeps bundle small (~136KB VSIX)
- **CSS variables:** All styling uses VS Code's CSS custom properties for theme awareness

**File structure:**
```
src/extension/index.ts            — Entry point, commands, status bar (95 lines)
src/extension/rpc-client.ts       — JSON-RPC client over stdin/stdout (374 lines)
src/extension/webview-provider.ts — Webview lifecycle, message routing (828 lines)
src/shared/types.ts               — Message protocol types (153 lines)
src/webview/state.ts              — Types + shared mutable state (123 lines)
src/webview/helpers.ts            — Pure functions, markdown, tool helpers (308 lines)
src/webview/slash-menu.ts         — Slash command palette (228 lines)
src/webview/model-picker.ts       — Model selection overlay (162 lines)
src/webview/ui-dialogs.ts         — Inline confirm/select/input dialogs (140 lines)
src/webview/renderer.ts           — Entry rendering + streaming segments (368 lines)
src/webview/index.ts              — DOM setup, events, message routing, UI updates (1055 lines)
src/webview/styles.css            — Theme-aware styling (1,716 lines)
```

## Operating Notes

- **Changelog:** `CHANGELOG.md` at project root must be updated on every slice completion and PR merge. Use [Keep a Changelog](https://keepachangelog.com/) format. Group entries under Added, Changed, Fixed, Removed. Reference the slice or PR that produced the change.

- **Releases:** Distribution is via GitHub Releases with a `.vsix` artifact attached. A GitHub Actions workflow (`.github/workflows/release.yml`) handles this automatically:
  1. Bump `version` in `package.json`
  2. Commit and push
  3. Tag: `git tag v<version> && git push origin v<version>`
  4. CI builds, packages, and creates a GitHub Release with the `.vsix` attached
  
  After every PR merge to main, check if the version should be bumped and a release tag pushed. Users install the `.vsix` via VS Code's "Extensions: Install from VSIX..." command.

- **VSIX hygiene:** `.vscodeignore` controls what ships in the package. Only `dist/`, `resources/`, `package.json`, `readme.md`, `changelog.md`, and install scripts should be included. Never ship `.gsd/`, `src/`, `node_modules/`, `.map` files, or other dev artifacts.

## Milestone Sequence

- [x] M001: Polish & Hardening — Fix type safety gaps, remove dead code, add missing message types, clean up technical debt
- [x] M002: Conversation History — Browse, search, and resume previous sessions from the chat panel. Direct filesystem parsing of session JSONL files + RPC switch_session for switching.
- [x] M003: Process Resilience & Hang Protection — Spawn hardening, tool watchdog timers, health monitoring, abort UI, force-kill recovery
- [x] M004: Header Enhancements — GSD workflow state badge, ~30% header size bump
- [x] M005: UI Interactions & Polish — Thinking dropdown picker, delete current session, context bar, visual refinements ✅
- [x] M006: Testing & Quality — Unit tests (73 passing), ESLint, CI pipeline (lint + test on push/PR)
- [x] M007: UX Polish & Interaction Improvements — Scroll FAB, timestamps, quick actions, copy response, toasts, thinking collapse, input resize (edit/resend descoped)
- [ ] M008: Hardening, Performance & UX — Error surfacing, tool call grouping, loading states, accessibility, index.ts decomposition
