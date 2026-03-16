# M011: Codebase Quality & Robustness

**Vision:** Clean up every issue found in the full codebase audit — type safety, dead code, missing event handling, cross-platform bugs, and architectural debt — without changing any user-facing behavior.

## Success Criteria

- CI passes: lint, test, build all green
- Every message type in `WebviewToExtensionMessage` and `ExtensionToWebviewMessage` has a corresponding handler
- No duplicate type definitions across modules
- `webview-provider.ts` is under 800 lines with clear module boundaries
- All pi RPC events the extension receives are handled (no silent drops)
- HTML export works on Windows, macOS, and Linux

## Key Risks / Unknowns

- Webview provider refactor could break session lifecycle edge cases — mitigated by incremental extraction and existing test suite

## Proof Strategy

- Session lifecycle risk → retire in S03 by proving all 193+ tests pass after decomposition

## Verification Classes

- Contract verification: `npm run lint`, `npm test`, `npm run build`
- Integration verification: Manual smoke test — launch extension, send prompt, verify streaming works
- Operational verification: None
- UAT / human verification: None

## Milestone Definition of Done

This milestone is complete only when all are true:

- All three slices pass their verification
- `npm run lint && npm test && npm run build` all succeed
- No user-facing behavior has changed
- webview-provider.ts is decomposed into focused modules

## Slices

- [x] **S01: Type Safety & Dead Code Cleanup** `risk:low` `depends:[]`
  > After this: CI passes (lint + test + build), all message types are enforced by TypeScript, no dead code remains
- [x] **S02: Event Handling & Diagnostics** `risk:low` `depends:[]`
  > After this: fallback_chain_exhausted shows a user-friendly message, export works cross-platform, rpc-client diagnostics go to Output panel, tool icons cover all pi tools
- [x] **S03: WebviewProvider Decomposition** `risk:medium` `depends:[S01,S02]`
  > After this: webview-provider.ts is split into focused modules (ProcessManager, WatchdogManager, SessionState), all tests still pass, no behavior change

## Boundary Map

### S01 → S03

Produces:
- Clean `WebviewToExtensionMessage` union (all sent types declared)
- Clean `AppState` interface (extensionVersion declared)
- Deduplicated types in `shared/types.ts` (dashboard-parser imports from shared)

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- `fallback_chain_exhausted` handler in message-handler.ts
- `rpc-client.ts` using `emit("log")` instead of `console.warn`
- Cross-platform export in webview-provider.ts

Consumes:
- nothing (independent of S01)
