---
id: T01
parent: S02
milestone: M006
provides:
  - ESLint flat config with typescript-eslint
  - npm run lint script
  - CI workflow for lint + test
key_files:
  - eslint.config.mjs
  - .github/workflows/ci.yml
  - package.json
key_decisions:
  - Disabled no-explicit-any project-wide — VS Code extension message-passing uses any pervasively at API boundaries
  - Configured no-unused-vars to ignore _-prefixed params/vars (standard pattern for required but unused parameters)
patterns_established:
  - Empty catch blocks use /* ignored */ comment to satisfy no-empty
  - Unused destructured array elements use , to skip (e.g. [, value])
observability_surfaces:
  - none
duration: 1 task
verification_result: passed
completed_at: 2026-03-13
blocker_discovered: false
---

# T01: Install ESLint, configure, fix errors, and add CI workflow

**Installed ESLint with typescript-eslint flat config, fixed all 106 lint errors, and added CI workflow running lint + test on push/PR.**

## What Happened

Installed eslint, @eslint/js, and typescript-eslint as devDependencies. Created eslint.config.mjs with flat config using recommended rulesets. Disabled `no-explicit-any` (64 hits across message-passing boundaries — not worth typing) and configured `no-unused-vars` to allow `_`-prefixed names. Fixed remaining 42 errors: removed unused imports (execFileSync, GsdState), added `/* ignored */` to 16 empty catch blocks, replaced unused destructured vars with `, `, prefixed unused-but-required params with `_`, removed dead assignments (userScrolledUp, extPath), fixed useless regex escapes, and converted `let text = ""` to `let text: string` to eliminate a dead initial assignment. Created `.github/workflows/ci.yml` mirroring the release workflow's setup pattern.

## Verification

- `npm run lint` — exits 0, no errors
- `npm test` — 73 tests pass (2 files, no regressions)
- `ci.yml` — triggers on push to main and pull_request, runs checkout → setup-node@v4 (node 20) → npm ci → lint → test

### Slice-level verification
- [x] `npm run lint` exits 0
- [x] `npm test` passes (73 tests)
- [x] `ci.yml` has correct triggers and steps

## Diagnostics

none

## Deviations

none

## Known Issues

none

## Files Created/Modified

- `eslint.config.mjs` — new flat ESLint config
- `.github/workflows/ci.yml` — new CI workflow
- `package.json` — added lint script and eslint devDependencies
- `src/extension/rpc-client.ts` — removed unused import, fixed unused vars and empty catches
- `src/extension/health-check.ts` — fixed empty catch
- `src/extension/update-checker.ts` — fixed empty catches
- `src/extension/webview-provider.ts` — eslint-disable for dynamic require, fixed unused vars and empty catches
- `src/webview/helpers.ts` — fixed useless regex escapes
- `src/webview/index.ts` — removed unused import/vars, fixed destructuring, dead assignments
- `src/webview/renderer.ts` — prefixed unused var with _
- `src/webview/session-history.ts` — prefixed unused var with _
- `src/webview/ui-dialogs.ts` — fixed unused destructured var
