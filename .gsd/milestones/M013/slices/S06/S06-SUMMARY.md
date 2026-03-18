---
id: S06
milestone: M013
provides:
  - 10 new test files for extension-host modules
  - src/extension/__test-utils__/vscode-mock.ts (shared mock infra)
  - 107 new tests (358 total, up from 251)
key_files:
  - src/extension/session-state.test.ts
  - src/extension/dashboard-parser.test.ts
  - src/extension/session-list-service.test.ts
  - src/extension/watchdogs.test.ts
  - src/extension/command-fallback.test.ts
  - src/extension/file-ops.test.ts
  - src/extension/rpc-events.test.ts
  - src/extension/health-check.test.ts
  - src/extension/auto-progress.test.ts
  - src/extension/__test-utils__/vscode-mock.ts
key_decisions:
  - Mock DI context objects with vi.fn() stubs — same pattern across all modules
  - vi.useFakeTimers() for timer-based modules (watchdogs, command-fallback, auto-progress)
  - Real filesystem fixtures (mkdtempSync) for dashboard-parser and session-list-service
  - Inline vscode mock per test file rather than shared mock — each module needs different mock shapes
patterns_established:
  - Context interface DI pattern makes modules directly testable without GsdWebviewProvider
  - vi.mock("vscode") with per-file overrides for window, workspace, commands, env
drill_down_paths: []
duration: 15m
verification_result: passed
completed_at: 2026-03-18
---

# S06: Extension Host Test Coverage (remediation)

**Added 107 new tests across 10 test files covering all S05-extracted modules plus session-state, dashboard-parser, session-list-service, health-check, and auto-progress. Total: 358 tests passing.**

## What Happened

Created test files for all extracted extension-host modules using the context interface DI pattern established in S05. Each module's context interface is mocked with vi.fn() stubs, making the tests fast and isolated.

| Test File | Tests | Module Covered |
|-----------|-------|---------------|
| session-state.test.ts | 8 | createSessionState, cleanupSessionState |
| dashboard-parser.test.ts | 10 | buildDashboardData with real filesystem |
| session-list-service.test.ts | 5 | getSessionDir, listSessions, deleteSession |
| watchdogs.test.ts | 22 | All 6 watchdog functions |
| command-fallback.test.ts | 20 | Regexes, probe, timer, fallback |
| file-ops.test.ts | 19 | All 9 file-op handlers |
| rpc-events.test.ts | 20 | handleRpcEvent, handleExtensionUiRequest |
| health-check.test.ts | 5 | runHealthCheck shape and error paths |
| auto-progress.test.ts | 8 | AutoProgressPoller lifecycle |

## Verification

| Check | Result |
|-------|--------|
| `npm test` — 358 tests | ✅ all pass |
| `npm run build` | ✅ clean |
| `npm run lint` | ✅ clean |
| Extension bundle: 138.4KB | ✅ unchanged |

## Forward Intelligence

### What the next slice should know
- vscode mock is per-file (inline vi.mock), not shared. The __test-utils__/vscode-mock.ts is available but most tests define their own mock shape.
- Webview tests (S07) use jsdom environment, not node. Need `// @vitest-environment jsdom` or vitest config override.
- The established pattern: create mock DOM elements, mock vscode, call init(), test exported functions directly.
