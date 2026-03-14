# M006: Testing & Quality — Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

## Project Description

Rokket GSD VS Code extension — a chat UI wrapping the GSD AI coding agent in a VS Code sidebar/tab. ~7500 lines of TypeScript across extension host (Node/CJS) and webview (browser/IIFE), zero tests, no linting.

## Why This Milestone

Seven milestones of feature work with no test safety net. Regressions can only be caught manually. No linting means inconsistent code quality and no CI gate. As the codebase grows, this becomes increasingly expensive.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Run `npm test` and see passing unit tests covering core logic
- Run `npm run lint` and see clean output
- See CI run tests and lint on every PR/push

### Entry point / environment

- Entry point: CLI (`npm test`, `npm run lint`)
- Environment: local dev + CI (GitHub Actions)
- Live dependencies involved: none (unit tests only, no RPC subprocess)

## Completion Class

- Contract complete means: tests pass, lint passes, CI pipeline runs green
- Integration complete means: CI runs on push/PR in GitHub Actions
- Operational complete means: none

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- `npm test` passes with meaningful coverage of pure logic modules
- `npm run lint` passes clean
- CI workflow runs both on push to main

## Risks and Unknowns

- Webview code is heavily DOM-coupled — testing it properly would require jsdom setup. Pure logic extraction is the pragmatic path.
- Extension host code uses `vscode` API — needs mocking for unit tests.

## Existing Codebase / Prior Art

- `src/extension/state-parser.ts` (85 lines) — pure parsing logic, highly testable
- `src/extension/health-check.ts` (268 lines) — has side effects but testable with mocks
- `src/extension/session-list-service.ts` (242 lines) — filesystem-dependent
- `src/webview/helpers.ts` (327 lines) — mix of pure functions and DOM helpers
- `src/shared/types.ts` (252 lines) — type definitions only
- `tsconfig.json` — strict mode enabled
- `.github/workflows/release.yml` — existing CI for releases, no test step

## Scope

### In Scope

- Test framework setup (vitest — fast, TS-native, no config overhead)
- Unit tests for pure logic: helpers, state-parser, markdown rendering, formatting
- ESLint + Prettier setup
- CI pipeline: lint + test on push/PR
- `npm test` and `npm run lint` scripts

### Out of Scope / Non-Goals

- Integration tests with live RPC subprocess
- E2E tests with VS Code Extension Host
- Webview DOM tests (would need jsdom — not worth the complexity now)
- 100% coverage targets
- Pre-commit hooks

## Technical Constraints

- Must work with esbuild build pipeline (no webpack/tsc conflicts)
- Tests must not require VS Code runtime
- CI must run on ubuntu-latest (GitHub Actions)
