# GitHub Issue: ctx.ui.custom() returns undefined in RPC mode

**Target repo:** glittercowboy/gsd-pi
**Status:** Draft — needs manual submission (no repo access)

## Title

ctx.ui.custom() returns undefined in RPC mode, silently breaking showNextAction() flows

## Body

### Summary

In RPC mode, `ctx.ui.custom()` returns `undefined` immediately without emitting any event to the RPC caller. This causes `showNextAction()` — and any flow that depends on it — to silently complete without taking action. No error is thrown, no event is emitted, and the command handler returns normally, making it invisible to the caller that anything went wrong.

### Root Cause

In `src/modes/rpc/rpc-mode.ts`, `createExtensionUIContext` defines:

```javascript
async custom() {
    // Custom UI not supported in RPC mode
    return undefined;
}
```

Unlike `select()`, `confirm()`, and `input()` — which emit `extension_ui_request` events and await responses — `custom()` returns `undefined` inline without any RPC communication.

`showNextAction()` in `src/resources/extensions/shared/next-action-ui.ts` calls `ctx.ui.custom()`. When the return value is `undefined`, no action branch matches and the function exits silently.

### When It Fails

Any `/gsd` or `/gsd auto` invocation that routes through `showNextAction()`:

- No active milestone → `showSmartEntry()` → `showNextAction()` → silent
- Phase is `complete` → same path
- Pre-planning without context file → same path  
- Crash recovery (asks resume/continue) → `showNextAction()` → silent
- `dispatchNextUnit()` merge guard or step-mode confirmation → same
- Slice just completed, needs next slice selection → same
- Multiple branch points in `guided-flow.ts` (13+ call sites)

Also: `handleStatus()` in `commands.ts` calls `ctx.ui.custom()` directly for the dashboard overlay.

### When It Works

The narrow path that bypasses `showNextAction()` entirely:
- Active milestone exists
- Phase is not `complete` or `pre-planning`
- Active slice and task in progress
- No crash recovery needed
- No merge guards triggered
- Not in step mode

In this case, `startAuto()` goes directly to `dispatchNextUnit()` → `ctx.prompt()`, which emits agent events normally.

### Reproduction

1. Set up a project with phase `complete` (or no active milestone)
2. Start pi in RPC mode (`--mode rpc`)
3. Wait for initialization
4. Send `{"type": "prompt", "message": "/gsd auto", "id": "req-1"}`
5. Receive `{"type": "response", "id": "req-1", "command": "prompt", "success": true}`
6. No further events — command silently completed

### Suggested Fix

Option A — Fallback in `showNextAction()`:

When `ctx.ui.custom()` returns `undefined`, fall back to `ctx.ui.select()` which IS implemented in RPC mode:

```typescript
const result = await ctx.ui.custom<string>(...);
if (result === undefined) {
    const labels = allActions.map(a => {
        const tag = a.recommended ? " (recommended)" : "";
        return `${a.label}${tag}`;
    });
    const selected = await ctx.ui.select(opts.title, labels);
    if (selected === undefined) return "not_yet";
    const idx = labels.indexOf(selected);
    return idx >= 0 ? allActions[idx].id : "not_yet";
}
return result;
```

Option B — Implement `custom()` in RPC mode:

Emit an `extension_ui_request` event with method `custom` and the component data, allowing the RPC caller to render the UI and respond. This is more work but enables richer UX for RPC consumers.

### Impact

`/gsd` and `/gsd auto` only work in RPC mode when the project happens to be in the narrow state where no interactive decision is needed. For all other states — including common ones like "milestone complete, what next?" or "no active work" — the commands silently do nothing.
