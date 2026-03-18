# S01: Type Safety & Dead Code Cleanup

**Delivered:** Removed dead code, enforced type coverage on all message types, and deduplicated shared types.

## What Was Built

- Removed unused `resetAutoScroll` import (fixed lint CI failure)
- Added `resume_last_session` to `WebviewToExtensionMessage` type union
- Removed dead `copy_last_response` from type union (handled client-side)
- Added `extensionVersion` to `AppState` interface
- Removed dead tool watchdog code (no-op functions, empty map, init params)
- Deduplicated `DashboardSlice`/`Task`/`MilestoneRegistryEntry`/`DashboardData` types — `dashboard-parser.ts` now imports from `shared/types.ts` instead of redefining

## Files Modified

- `src/shared/types.ts` — added missing message types, `extensionVersion` field
- `src/extension/dashboard-parser.ts` — removed duplicate type definitions, imports from shared
- `src/webview/index.ts` — removed dead watchdog code
- `src/webview/message-handler.ts` — removed dead code paths
