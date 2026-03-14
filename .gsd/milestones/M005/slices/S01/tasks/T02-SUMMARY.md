---
task: T02
title: Wire thinking dropdown into index.ts and update header UI
status: done
---

# T02: Wire thinking dropdown into index.ts and update header UI

## What Changed

- Replaced blind `cycle_thinking_level` click handler with `thinkingPicker.toggle()`
- Added thinking picker container to DOM layout
- Made thinking badge model-aware: shows "N/A" with disabled styling for non-reasoning models
- Added Escape key handling for thinking picker
- Wired `thinking_level_changed` to refresh picker if visible
- Added entrance animation to model picker and session history panels (consistency)

## Files Changed

- `src/webview/index.ts` — import, DOM element, init, badge logic, keyboard, message handler
- `src/webview/styles.css` — entrance animation on model picker + session history

## Verification

- `npm run build` passes cleanly
