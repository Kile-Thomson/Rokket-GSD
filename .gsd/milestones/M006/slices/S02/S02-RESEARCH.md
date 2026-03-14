# S02: ESLint + CI pipeline — Research

**Date:** 2026-03-13

## Summary

The codebase has ~20 TypeScript source files, no ESLint config, and one CI workflow (`release.yml`) that only builds+packages on push to main. S01 established `npm test` with vitest. This slice adds `npm run lint` with ESLint and a new CI workflow that runs both lint and test on push to main and PRs.

ESLint flat config (`eslint.config.mjs`) with `typescript-eslint` is the modern standard. The project targets ES2022 with strict TS — `typescript-eslint` recommended rules will catch real issues without excessive noise. A separate CI workflow file (`ci.yml`) is cleaner than modifying the release workflow.

## Recommendation

1. **ESLint:** Install `eslint` + `typescript-eslint` + `@eslint/js`. Use flat config (`eslint.config.mjs`) with `tseslint.configs.recommended`. No Prettier — not in scope per milestone context.
2. **Lint script:** Add `"lint": "eslint src/"` to package.json scripts.
3. **CI workflow:** New `.github/workflows/ci.yml` — triggers on push to main and PRs. Steps: checkout, setup-node, npm ci, npm run lint, npm test. Ubuntu-latest, Node 20 (matching release.yml).
4. **Fix lint errors:** Run lint, fix any issues before declaring clean. Expect some `@typescript-eslint/no-explicit-any` and unused-variable warnings given the codebase style.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| TS-aware linting | typescript-eslint | Industry standard, understands TS types, works with flat config |
| Base JS rules | @eslint/js | Official ESLint recommended ruleset |
| CI pipeline | GitHub Actions | Already used for releases, no new infra |

## Existing Code and Patterns

- `.github/workflows/release.yml` — existing CI pattern to mirror (ubuntu-latest, Node 20, npm ci). New workflow should match setup steps.
- `vitest.config.ts` — already includes `src/**/*.test.ts`. Lint config should also include test files.
- `tsconfig.json` — `strict: true`, targets ES2022. typescript-eslint will use this for type-aware rules if enabled.
- `package.json` scripts — `test` exists, need to add `lint`.

## Constraints

- **No Prettier** — out of scope per milestone definition
- **esbuild bundler** — ESLint config must not conflict with esbuild (it won't — they're independent)
- **Test files co-located** — lint must cover `*.test.ts` files too
- **CI must run on ubuntu-latest** — per milestone context
- **Don't modify release.yml** — it handles versioning/packaging; CI concerns are separate

## Common Pitfalls

- **Too many lint errors on first run** — Start with `recommended` (not `strict`) config. Suppress specific noisy rules if needed rather than mass-disabling.
- **Linting dist/ or node_modules** — Flat config scopes to `src/` via the lint script argument. Add explicit ignores for `dist/` in config.
- **Type-aware rules slow in CI** — Skip `recommendedTypeChecked` for now; `recommended` is sufficient and doesn't need a TS project reference.

## Open Risks

- **Volume of existing lint errors** — Unknown until first run. Could be trivial or could require significant fixes. Mitigation: fix auto-fixable issues, selectively disable rules that produce excessive noise without value.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| ESLint | — | none found (standard tooling, no skill needed) |
| GitHub Actions | — | none found (simple workflow, no skill needed) |

## Sources

- ESLint flat config and typescript-eslint are well-established; no external research needed.
