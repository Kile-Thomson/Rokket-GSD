# bug(claude-code-cli): `ask_user_questions` self-cancels — UI context is captured from `before_provider_request`, which never fires for a `streamSimple` provider

## Problem

Under the `claude-code` provider (Claude Code subscription inference), every `ask_user_questions` / MCP `elicitInput` call returns `{"response":null,"cancelled":true}` **with no interactive dialog ever rendering**. The question tool card appears, then instantly resolves to "Cancelled" without any user input.

This is a **different root cause** from the already-fixed watchdog/timeout issues (#768, #736, #1150, #1151). Those all concern an elicitation that *is* wired but gets aborted by a watchdog or the SDK's 60s default. Here, the elicitation handler (`onElicitation`) is **never wired in the first place**, so the SDK auto-declines immediately.

## Root cause

The elicitation handler is only attached when a UI context is present:

`dist/resources/extensions/claude-code-cli/stream-adapter.js` (~L2047, L2068–2071):

```js
const uiContext = claudeOptions?.extensionUIContext ?? capturedClaudeCodeUIContext;
// ...
...(uiContext
    ? { onElicitation: createClaudeCodeElicitationHandler(uiContext) }
    : {}),
```

Core calls `streamSimple` with a plain `SimpleStreamOptions` that carries no `extensionUIContext`, so `uiContext` falls back to the module-level `capturedClaudeCodeUIContext`. That value is set by a single extension hook in `dist/resources/extensions/claude-code-cli/index.js`:

```js
pi.on("before_provider_request", (_event, ctx) => {
    setClaudeCodeUIContext(ctx.hasUI ? ctx.ui : undefined);
});
```

**`before_provider_request` never fires for this provider.** It is emitted from inside the standard HTTP providers (`anthropic.js`, `openai-*.js`, `google.js`, …) via `options.onPayload(params, model)`, right before they POST the request body. It is not an Agent-level lifecycle event. The `claude-code` provider registers `streamSimple` and builds its own prompt inside the SDK adapter; it never calls `options.onPayload`, so the hook never runs. `capturedClaudeCodeUIContext` stays `undefined`, `onElicitation` is skipped, and every elicitation auto-declines.

The read path itself is fine: `createClaudeCodeElicitationHandler` → `promptElicitationWithDialogs` uses `ui.select`/`ui.input`, both of which emit `extension_ui_request` over RPC and render correctly in an RPC host. The only broken link is the capture event.

## Proof (live 1.17 capture)

Driving a real `ask_user_questions` elicitation through 1.17 over JSON-RPC and deliberately sending **no** response:

- gsd-pi emits one `select` `extension_ui_request` and then **blocks indefinitely** waiting for an answer — it does **not** auto-cancel server-side.
- `agent_end` is never emitted while the question is open; the turn genuinely blocks.
- Zero cancel frames appear across a 180s window with no client response.

So the auto-decline is not a server-side turn-end cancel — it's the SDK declining because `onElicitation` was never passed to `sdk.query`, which only happens when `uiContext` is falsy.

## Precedent in your own codebase

The peer `cursor-cli` provider already captures UI context from a lifecycle event that **does** fire — `dist/resources/extensions/cursor-cli/index.js` (~L40):

```js
pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || process.env.GSD_NON_INTERACTIVE === "1") return;
    // ...
});
```

`claude-code-cli` should use the same class of event.

## Proposed fix

In `extensions/claude-code-cli/index.js`, capture from lifecycle events that fire for a `streamSimple` provider and carry `ctx.ui`/`ctx.hasUI`:

```js
const captureUiContext = (_event, ctx) => {
    try { setClaudeCodeUIContext(ctx?.hasUI ? ctx.ui : undefined); } catch { /* ignore */ }
};
pi.on("session_start", captureUiContext);
pi.on("model_select", captureUiContext);
pi.on("before_agent_start", captureUiContext);   // fires every prompt, before the agent loop
pi.on("before_provider_request", captureUiContext); // no-op today; kept for forward-compat
```

`before_agent_start` is the reliable one: it fires on every user prompt before the agent loop, with the shared `ctx` whose `ctx.ui`/`ctx.hasUI` resolve to the live RPC UI context.

## Reproduction

1. Install `@opengsd/gsd-pi@1.17.0`.
2. Run pi over an RPC host (e.g. a VS Code webview) with the `claude-code` provider selected.
3. Trigger any `ask_user_questions` call.
4. Observe: the question card renders, then instantly resolves to `cancelled:true` with no interactive dialog; `response` is `null`.

## Environment

- `@opengsd/gsd-pi` **1.17.0**
- Provider: `claude-code` (Claude Code subscription inference, `streamSimple`)
- Host: RPC (VS Code extension webview)

## Notes

This regresses on updates: a prior local patch to the runtime mirror (`~/.gsd/agent/extensions/claude-code-cli/index.js`) is overwritten whenever the mirror is re-seeded from the package, reintroducing the single-hook version. A fix in the published package is the durable resolution.
