# S02: Dead Code & Type Safety

**Goal:** Remove dead code, add missing message types to the ExtensionToWebviewMessage union, eliminate `as any` casts in message handlers, and remove duplicate RPC methods.
**Demo:** Extension builds with zero TypeScript errors, no `as any` casts in message handlers, no dead code, all message types properly typed.

## Must-Haves

- Empty `tool_permission_response` handler removed (or implemented if actually needed)
- Duplicate `compact`/`compactContext` RPC methods consolidated
- Missing types added to `ExtensionToWebviewMessage`: `available_models`, `bash_result`, `thinking_level_changed`
- All `as any` casts in webview/index.ts message handler replaced with proper types
- All `as any` casts in webview-provider.ts replaced with proper types
- `npm run build` succeeds with no errors

## Tasks

- [ ] **T01: Add missing message types and remove dead code** `est:20m`
  - Why: Type safety and dead code removal are intertwined — missing types cause `as any`, dead handlers create confusion
  - Files: `src/shared/types.ts`, `src/extension/webview-provider.ts`, `src/extension/rpc-client.ts`
  - Do:
    1. Add `available_models`, `bash_result`, `thinking_level_changed` to `ExtensionToWebviewMessage` union
    2. Remove empty `tool_permission_response` handler from webview-provider.ts (verify it's never called from gsd RPC)
    3. Remove duplicate `compactContext` method from rpc-client.ts (keep `compact`)
    4. Add proper return types for RPC methods that currently return `Promise<unknown>`
  - Verify: `npm run build` succeeds

- [ ] **T02: Eliminate as-any casts in message handlers** `est:25m`
  - Why: `as any` hides type errors and prevents TypeScript from catching bugs
  - Files: `src/webview/index.ts`, `src/extension/webview-provider.ts`
  - Do:
    1. In webview/index.ts: replace all 18 `msg as any` casts with proper type narrowing using the ExtensionToWebviewMessage union
    2. In webview-provider.ts: replace 7 `as any` casts with proper RPC response types
    3. Use discriminated union pattern — `msg.type` narrows the type, then access fields directly
  - Verify: `npm run build` succeeds, grep confirms zero `as any` in these files

## Files Likely Touched

- `src/shared/types.ts` — add missing message types, add RPC response types
- `src/extension/webview-provider.ts` — remove empty handler, type RPC calls
- `src/extension/rpc-client.ts` — remove duplicate method, add return types
- `src/webview/index.ts` — replace `as any` casts with typed narrowing
