# S01: Workflow Badge + Header Sizing — UAT

**Milestone:** M004
**Written:** 2026-03-13

## UAT Type

- UAT mode: live-runtime
- Why this mode is sufficient: Visual UI feature requires checking rendered output in Extension Development Host

## Preconditions

- Extension built (`npm run build`)
- Opened in VS Code Extension Development Host (F5 / Run Extension)
- A `.gsd/STATE.md` exists in the workspace with active milestone/slice/phase data

## Smoke Test

Open the extension sidebar → workflow badge visible in header showing milestone/slice breadcrumb and phase label (e.g., `M004 › S01 · Executing`).

## Test Cases

### 1. Workflow badge shows current state

1. Open extension in a workspace with `.gsd/STATE.md`
2. Look at the header area
3. **Expected:** Badge shows breadcrumb like `M004 › S01 › T03` with phase label

### 2. Self-directed mode

1. Open extension in a workspace with no `.gsd/` directory
2. **Expected:** Badge shows "Self-directed"

### 3. Header elements are visibly larger

1. Compare header with v0.2.6 or prior builds
2. **Expected:** All badges, buttons, brand text, and logo are noticeably larger (~30%)

### 4. Badge updates after agent turn

1. Start an agent interaction that changes STATE.md
2. Wait for agent_end or up to 30s
3. **Expected:** Badge updates to reflect new state

## Edge Cases

### Narrow sidebar (≤350px)

1. Drag sidebar to ≤350px width
2. **Expected:** Workflow badge hidden entirely, layout doesn't break

### Narrow sidebar (≤420px)

1. Drag sidebar to ~400px width
2. **Expected:** Workflow badge truncated, action button labels hidden

### Malformed STATE.md

1. Create a `.gsd/STATE.md` with garbage content
2. **Expected:** Badge shows "Self-directed" (parser returns null gracefully)

## Failure Signals

- Badge missing from header entirely
- Badge shows stale data after agent turns
- Header elements overflow or overlap at narrow widths
- JavaScript errors in webview console related to workflow_state

## Not Proven By This UAT

- Automated test coverage for the parser
- Performance under rapid STATE.md changes
- Correctness of all 13 phase label mappings (only active phase tested live)

## Notes for Tester

- Use browser DevTools (Help → Toggle Developer Tools in Extension Dev Host) to inspect `workflow_state` messages
- The 30s poll means badge may take up to 30s to reflect external STATE.md changes not triggered by agent events
