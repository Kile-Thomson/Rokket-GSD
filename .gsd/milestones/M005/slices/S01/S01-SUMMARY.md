---
slice: S01
title: Thinking dropdown + history delete
status: done
---

# S01: Thinking Dropdown + History Delete

## What Was Delivered

1. **Thinking level dropdown picker** — replaces the blind cycling button with a proper dropdown overlay
   - Shows only levels available for the current model (derived from `reasoning` boolean on AvailableModel)
   - XHigh level only shown for Opus 4.6 models (matches `supportsXhigh()` in pi-ai)
   - Active level highlighted with dot indicator
   - Non-reasoning models: badge shows "N/A" with disabled styling, clicking does nothing
   - Calls `set_thinking_level` directly instead of `cycle_thinking_level`

2. **Delete current session** — removed the guard that prevented deleting the active session
   - Delete button now appears on all sessions in history
   - Deleting the current session shows a specific confirm message, then triggers new conversation
   - Flow: delete file → hide panel → clear chat → create new session

## Key Decisions

- Derived model reasoning capability from `AvailableModel.reasoning` rather than adding new RPC
- XHigh detection matches backend: checks model ID for "opus-4-6" or "opus-4.6"
- Thinking picker follows exact same overlay pattern as model-picker (positioning, close behavior, animations)

## Files Changed

- `src/webview/thinking-picker.ts` (new) — dropdown overlay module
- `src/webview/index.ts` — wiring, header badge logic, DOM layout
- `src/webview/session-history.ts` — delete guard removed, current session flow
- `src/webview/styles.css` — thinking picker styles, disabled badge, entrance animations

## What's Next

S02: Visual polish — context bar, stats, header, animations
