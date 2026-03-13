# S02: ESLint + CI pipeline

**Goal:** Linting enforced and CI runs both lint + test on every push/PR.
**Demo:** `npm run lint` passes clean locally; `.github/workflows/ci.yml` exists and would run lint + test on push to main and PRs.

## Must-Haves

- ESLint flat config with typescript-eslint recommended rules
- `npm run lint` script passes with zero errors
- GitHub Actions CI workflow runs lint + test on push to main and PRs
- CI workflow uses ubuntu-latest and Node 20 (matching release.yml)

## Verification

- `npm run lint` — exits 0 with no errors
- `npm test` — still passes (no regressions)
- `cat .github/workflows/ci.yml` — workflow triggers on push to main and pull_request, runs lint and test steps

## Tasks

- [x] **T01: Install ESLint, configure, fix errors, and add CI workflow** `est:45m`
  - Why: Single deliverable — linting + CI are tightly coupled and low-complexity
  - Files: `package.json`, `eslint.config.mjs`, `.github/workflows/ci.yml`
  - Do: Install eslint + typescript-eslint + @eslint/js. Create flat config with recommended rules and dist/ ignore. Add lint script. Run lint, fix all errors (auto-fix where possible, manual fixes for remainder). Create ci.yml matching release.yml setup pattern (ubuntu-latest, Node 20, npm ci) with lint and test steps.
  - Verify: `npm run lint` exits 0, `npm test` passes, ci.yml has correct triggers and steps
  - Done when: Both lint and test pass clean, CI workflow file exists with push/PR triggers

## Files Likely Touched

- `package.json`
- `eslint.config.mjs`
- `.github/workflows/ci.yml`
- Various `src/**/*.ts` files (lint fixes)
