# S02: Validate-Milestone Phase & New Slash Commands — UAT

**Milestone:** M014
**Written:** 2026-03-19

## UAT Type

- UAT mode: mixed (artifact-driven for phase rendering and slash menu; live-runtime for command palette)
- Why this mode is sufficient: Phase rendering and slash menu entries are fully testable via unit tests. The VS Code command requires manual verification in the extension host.

## Preconditions

- Extension built successfully (`npm run build` passes)
- All tests pass (`npx vitest run` — 254 tests, 0 failures)
- VS Code has the extension loaded (either via F5 debug launch or installed VSIX)

## Smoke Test

Run `npx vitest run src/webview/__tests__/auto-progress.test.ts src/webview/__tests__/slash-menu.test.ts` — all 22 tests pass, confirming phase rendering and slash menu entries are correct.

## Test Cases

### 1. Validate-milestone phase renders with checkmark

1. In auto-progress test, create progress data with `phase: "validate-milestone"`
2. Call `autoProgress.update(data)`
3. Query `.gsd-auto-progress-phase` span
4. **Expected:** Text content contains both "VALIDATING" and "✓"

### 2. Slash menu includes "gsd update" entry

1. Call `buildItems()` from `slash-menu.ts`
2. Find item with `name === "gsd update"`
3. **Expected:** Item exists with `description === "Update GSD artifacts and status"` and `sendOnSelect === true`

### 3. Slash menu includes "gsd export" entry

1. Call `buildItems()` from `slash-menu.ts`
2. Find item with `name === "gsd export"`
3. **Expected:** Item exists with `description === "Export milestone report (HTML)"` and `sendOnSelect === undefined`

### 4. Export report command appears in command palette

1. Open VS Code with the extension active
2. Press Ctrl+Shift+P to open the command palette
3. Type "Export Milestone Report"
4. **Expected:** "Rokket GSD: Export Milestone Report" appears in the command list

### 5. Export report command with no active session

1. Ensure no GSD session is running
2. Execute "Rokket GSD: Export Milestone Report" from the command palette
3. **Expected:** Info message appears: "Start a GSD session first to export a milestone report."

### 6. Export report command with active session

1. Start a GSD session in the sidebar
2. Execute "Rokket GSD: Export Milestone Report" from the command palette
3. **Expected:** Panel focuses and `/gsd export --html --all` is sent as a prompt to the active session

## Edge Cases

### Unknown phase string fallback

1. Create progress data with `phase: "some-unknown-phase"`
2. Call `autoProgress.update(data)`
3. **Expected:** Phase span shows "SOME-UNKNOWN-PHASE" (uppercased, no crash, no checkmark)

### Slash menu filtering for /gsd u

1. Type `/gsd u` in the chat input
2. **Expected:** "gsd update" appears in filtered slash menu results

### Slash menu filtering for /gsd e

1. Type `/gsd e` in the chat input
2. **Expected:** "gsd export" appears in filtered slash menu results (along with any other "e" matches)

### Export report prompt failure

1. Start a GSD session, then trigger a network/process error during export
2. **Expected:** Error message shown to user and error logged to GSD output channel

## Failure Signals

- `formatPhase("validate-milestone")` returns raw string instead of "VALIDATING" — phase case missing
- Slash menu shows no "gsd update" or "gsd export" entries — subcommands not added to array
- "Export Milestone Report" not in command palette — missing from package.json contributes.commands
- Command throws at invocation — `exportReport()` method missing from WebviewProvider
- No info message when running without session — session-check logic broken

## Not Proven By This UAT

- Full end-to-end HTML export output (requires live gsd-pi with milestone data)
- Export file creation on disk (depends on gsd-pi export command implementation)
- Visual appearance of "✓ VALIDATING" in the actual webview (unit test verifies text content, not CSS styling)

## Notes for Tester

- Tests 1-3 are automated and run as part of the CI suite. Tests 4-6 require manual VS Code interaction.
- The `/gsd export` slash menu entry intentionally does NOT have `sendOnSelect: true` — this lets the user append arguments like `--html --all` before sending.
- The `gsd.exportReport` command hardcodes `/gsd export --html --all` as the prompt — it's a convenience shortcut for the most common export case.
