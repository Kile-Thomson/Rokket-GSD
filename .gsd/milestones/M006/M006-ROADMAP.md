# M006: Testing & Quality

**Vision:** A reliable quality foundation — unit tests for core logic, linting for consistency, and CI to enforce both on every change.

## Success Criteria

- `npm test` runs and passes with unit tests covering state-parser, helpers, and markdown rendering
- `npm run lint` runs clean with ESLint
- CI pipeline runs lint + test on push to main and on PRs
- No test requires VS Code runtime or live RPC process

## Key Risks / Unknowns

- Webview helpers mix pure functions with DOM access — need to identify which are testable without jsdom
- Extension modules import `vscode` — test files must avoid triggering those imports

## Proof Strategy

- DOM-coupling risk → retire in S01 by testing only genuinely pure functions
- vscode import risk → retire in S01 by testing state-parser (no vscode imports)

## Verification Classes

- Contract verification: `npm test` passes, `npm run lint` passes
- Integration verification: CI workflow runs green on push
- Operational verification: none
- UAT / human verification: none

## Milestone Definition of Done

This milestone is complete only when all are true:

- All slices complete
- `npm test` passes locally
- `npm run lint` passes locally
- CI workflow exists and would run on push/PR

## Slices

- [x] **S01: Test framework + unit tests for pure logic** `risk:medium` `depends:[]`
  > After this: `npm test` runs vitest with passing tests for state-parser, helpers (pure functions), and markdown rendering
- [x] **S02: ESLint + CI pipeline** `risk:low` `depends:[S01]`
  > After this: `npm run lint` passes clean, CI workflow runs lint + test on push/PR

## Boundary Map

### S01 → S02

Produces:
- vitest config and `npm test` script
- test file patterns and conventions

Consumes:
- nothing (first slice)
