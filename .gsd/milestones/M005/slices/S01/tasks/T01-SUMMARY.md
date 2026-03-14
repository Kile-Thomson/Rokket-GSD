---
task: T01
title: Create thinking dropdown picker module
status: done
---

# T01: Create thinking dropdown picker module

## What Changed

Created `src/webview/thinking-picker.ts` — a new overlay module for selecting thinking/reasoning levels, following the established model-picker pattern.

## Key Decisions

- Derive model capability from `AvailableModel.reasoning` boolean rather than adding a new RPC call
- XHigh detection matches the backend `supportsXhigh()` logic: checks for "opus-4-6" or "opus-4.6" in model ID
- Descriptions kept terse to fit in the narrow sidebar width (240px picker)

## Files Changed

- `src/webview/thinking-picker.ts` (new) — overlay module with init/show/hide/toggle/refresh API
- `src/webview/styles.css` — thinking picker styles, disabled badge state, shared `gsd-picker-in` animation

## Verification

- `npm run build` passes cleanly
