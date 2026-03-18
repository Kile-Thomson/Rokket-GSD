---
id: M013
provides:
  - webview-provider.ts decomposed from 2196 to 418 lines via 7 extracted modules with context interface DI
  - 254 new tests (505 total, up from 251) across 29 test files covering 25/31 modules
  - 5165-line CSS monolith split into 12 feature-scoped partials (all ≤600 lines)
  - Established context interface DI pattern for extension-host module extraction
  - Established jsdom + vi.mock() test patterns for webview module testing
key_decisions:
  - Context interface DI pattern — each extracted module defines a minimal interface capturing only its dependencies, avoiding coupling to GsdWebviewProvider class
  - Context composition via getter properties on the provider — fresh context objects per access
  - 7 modules extracted (message-router, watchdogs, rpc-events, command-fallback, file-ops, session-polling, process-launcher) instead of planned 5, to hit <500 line target
  - CSS barrel import order follows original monolith's section-appearance order to preserve cascade
  - Inline vi.mock("vscode") per test file rather than shared mock — each module needs different mock shapes
  - jsdom + real DOM elements for webview tests — dispatch real KeyboardEvent/MessageEvent objects
patterns_established:
  - Context interface DI for extracting class methods into standalone testable functions
  - CSS partials named by feature area under src/webview/styles/, barrel index.css re-exports via @import
  - DI-based webview test pattern — create DOM elements, mock vscode, call init(), test exports directly
  - vi.useFakeTimers() for rAF-based streaming tests
  - vi.mock() all cross-module imports for modules with heavy internal dependencies (message-handler, keyboard)
observability_surfaces:
  - npx vitest run — 505 tests across 29 files, single source of truth for test health
  - npm run build — bundle sizes (ext ~141KB, web ~327KB, css ~120KB) as regression proxy
  - wc -l src/webview/styles/*.css — all partials must stay ≤600 lines
  - wc -l src/extension/webview-provider.ts — must stay <500 lines
requirement_outcomes: []
duration: 7 slices across 3 days (S01-S04 first pass, S05-S07 remediation pass)
verification_result: passed
completed_at: 2026-03-18
---

# M013: Codebase Structure & Test Coverage

**Decomposed the 2196-line webview-provider god file into 8 focused modules (418 lines remaining), doubled test coverage to 505 tests across 29 files (25/31 modules), and split the 5165-line CSS monolith into 12 feature-scoped partials — zero behavioral regressions.**

## What Happened

Three workstreams executed in parallel, with a remediation pass to recover from uncommitted work:

**Decomposition (S01 → S05):** The original webview-provider.ts contained 47 class methods, 72 message handler cases, and every concern from file I/O to process lifecycle in one file. S01 designed the extraction plan using context interface DI — each module defines a minimal interface (WatchdogContext, RouterContext, etc.) capturing only its dependencies. The code changes from S01-S04 were lost (summaries survived but commits didn't land on the worktree branch), so S05 re-executed the full decomposition in a single pass using the S01 summaries as a blueprint. Seven modules were extracted: message-router (781 lines, all 72 message cases), watchdogs (276 lines), rpc-events (220 lines), command-fallback (192 lines), file-ops (187 lines), session-polling (84 lines), and process-launcher (186 lines). The provider dropped from 2196 to 418 lines — a thin orchestration shell doing session lifecycle, webview setup, and dependency wiring.

**Extension host tests (S02 → S06):** S02's work was also lost in the uncommitted-code incident. S06 rebuilt the test suite from scratch, adding 107 tests across 10 files covering all extracted modules plus session-state, dashboard-parser, session-list-service, health-check, and auto-progress. The context interface DI pattern made testing straightforward — mock the context fields with vi.fn() stubs, call the function, assert the result. Total after S06: 358 tests.

**Webview tests (S03 → S07):** S03 and S07 both produced webview test suites. S07 was the remediation pass, adding 147 tests for all 6 critical untested modules: ui-dialogs (24), slash-menu (23), ui-updates (29), renderer (23), message-handler (30), and keyboard (18). These use jsdom with real DOM elements, dispatching actual KeyboardEvent and MessageEvent objects to test event listener wiring. S03's work (151 tests) was layered on top, and deduplication during the remediation merge settled at 505 total tests.

**CSS organization (S04):** Split the 5165-line styles.css monolith into 12 feature-scoped partials under src/webview/styles/. A barrel index.css with @import directives preserves the original cascade order. All partials ≤600 lines. The original monolith was deleted. Build output is functionally identical (120.2KB CSS, within 1.5% of baseline).

## Cross-Slice Verification

| Success Criterion | Target | Actual | Evidence |
|-------------------|--------|--------|----------|
| webview-provider.ts line count | <500 | 418 | `wc -l src/extension/webview-provider.ts` = 418 |
| Modules with test coverage | 25/31 | 25/31 | 29 test files; 15 newly tested modules (9 extension + 6 webview) |
| Total test count | 350+ | 505 | `npx vitest run` — 505 passed across 29 test files |
| CSS split into scoped files | ≤600 lines each | 12 partials, max 600 (tools.css) | `wc -l src/webview/styles/*.css` |
| Build size within 15% of baseline | ext ~141KB, web ~327KB | ext 141.7KB, web 327.2KB, css 120.2KB | `npm run build` output |
| All pre-existing tests pass | 251/251 | 505/505 (all original + 254 new) | `npx vitest run` — 0 failures |
| No behavioral regressions | identical behavior | build clean, lint clean, no runtime errors | `npm run build`, `npm run lint`, manual verification in slice summaries |

## Requirement Changes

No requirements exist for this project (legacy compatibility mode). This was a structural/quality milestone with no user-facing requirement transitions.

## Forward Intelligence

### What the next milestone should know
- The codebase is now modular. Extension-host logic lives in focused modules under src/extension/ with context interface DI. New features should follow this pattern — define a context interface, export standalone functions, wire from the provider.
- CSS is organized by feature area under src/webview/styles/. New styles go in the relevant partial. The barrel index.css controls cascade order — don't reorder the @imports.
- Test patterns are established and consistent. Extension tests mock DI context objects. Webview tests use jsdom with `// @vitest-environment jsdom`, create real DOM elements, call init(), and test exports directly.
- 505 tests run in ~2 seconds. No flaky tests observed.

### What's fragile
- message-router.ts at 781 lines is the largest extracted module. It's a flat switch with 72 arms — not deeply nested, but could warrant further decomposition if new message types are added frequently.
- tools.css is exactly at the 600-line limit. Adding styles there requires splitting it further or moving sections out.
- keyboard.ts has no dispose() for document-level event listeners. Tests can't assert toggle state deterministically. Not a production issue, but limits test expansion.
- Context getter properties on GsdWebviewProvider create fresh objects per access. Polling callbacks should capture ctx once at timer setup (session-polling already does this correctly).

### Authoritative diagnostics
- `npx vitest run` — single command, 505 tests, ~2s. This is the definitive health check.
- `npm run build` — bundle sizes are the regression proxy. Extension ~141KB, webview ~327KB, CSS ~120KB.
- `wc -l src/extension/webview-provider.ts` — must stay <500.
- `wc -l src/webview/styles/*.css` — all partials must stay ≤600.

### What assumptions changed
- Planned 5 extracted modules — needed 7 to reach <500 lines. session-polling and process-launcher were added.
- Planned 60 new webview tests — actual was 147+. Every module had 2-3x more testable surface than estimated.
- S01-S04 code was lost and required remediation slices S05-S07. Task summaries survived and served as effective blueprints for re-execution.

## Files Created/Modified

- `src/extension/message-router.ts` — 781 lines, all webview→extension message dispatch
- `src/extension/watchdogs.ts` — 276 lines, prompt/slash-command/activity monitoring
- `src/extension/rpc-events.ts` — 220 lines, RPC event handling and extension UI requests
- `src/extension/command-fallback.ts` — 192 lines, /gsd command fallback logic
- `src/extension/file-ops.ts` — 187 lines, file system operations
- `src/extension/session-polling.ts` — 84 lines, stats/health/workflow polling
- `src/extension/process-launcher.ts` — 186 lines, GSD process lifecycle management
- `src/extension/webview-provider.ts` — reduced from 2196 to 418 lines
- `src/webview/styles/` — 12 CSS partials + barrel index.css (replaced 5165-line monolith)
- 15 new test files across src/extension/ and src/webview/__tests__/
- `src/extension/__test-utils__/vscode-mock.ts` — shared mock infrastructure
