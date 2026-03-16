# S03: Loading States & Async UX — UAT

**Milestone:** M008
**Written:** 2026-03-14

## UAT Type

- UAT mode: mixed (artifact-driven + live-runtime)
- Why this mode is sufficient: Tests lock the DOM patterns; live-runtime confirms spinners are visually correct and transitions feel smooth

## Preconditions

- Extension built and loaded in VS Code (`npm run build` or F5 dev host)
- No cached dashboard/changelog data (fresh extension activation preferred)

## Smoke Test

Open the GSD sidebar. The dashboard area should show a spinner briefly, then render dashboard content. If the spinner never appears or content never loads, something is broken.

## Test Cases

### 1. Dashboard loading spinner

1. Open VS Code with the extension active
2. Open the GSD sidebar panel
3. Watch the dashboard area during initial load
4. **Expected:** A spinner (`.gsd-loading-spinner` inside `.gsd-dashboard`) appears briefly, then is replaced by dashboard content. No spinner remains after data loads.

### 2. Changelog loading spinner

1. Open the GSD sidebar
2. Trigger the changelog view (click the changelog button in the header)
3. Watch the changelog area during fetch
4. **Expected:** A spinner appears in the `#gsd-changelog` container, then is replaced by changelog content (release notes cards). No spinner persists alongside the content.

### 3. Model picker loading state

1. Open the GSD sidebar
2. Open the model picker dropdown
3. If model list hasn't loaded yet, observe the picker content
4. **Expected:** When no models are available, a spinner/loading indicator appears with class `gsd-model-picker-loading`. Once models load, the spinner is replaced by the model list.

### 4. Copy button hidden during streaming

1. Start a conversation that produces a multi-line response
2. While the response is still streaming (text appearing), inspect the assistant message entry
3. **Expected:** No copy button (`.gsd-copy-response-btn`) is visible on the streaming message. The message element has the `streaming` CSS class.

### 5. Copy button visible after streaming completes

1. Wait for the assistant response from test case 4 to finish streaming
2. Inspect the completed assistant message
3. **Expected:** A copy button (`.gsd-copy-response-btn`) appears on the message. The `streaming` class is removed from the message element.

## Edge Cases

### Rapid navigation away from changelog

1. Trigger changelog load
2. Immediately navigate away (e.g., start a new chat) before changelog finishes loading
3. **Expected:** No orphaned spinners remain in the DOM. Navigating back and re-triggering changelog works normally.

### Empty response from assistant

1. If the assistant returns an empty or very short response (e.g., just "OK")
2. **Expected:** Copy button still appears after completion if there is text content. If truly empty, no copy button (gated by content check).

## Failure Signals

- Spinner persists indefinitely alongside loaded content (replace pattern broken)
- Copy button visible during active streaming
- Copy button never appears after streaming completes
- Multiple spinners stacked in the same container
- Console errors during dashboard/changelog/model fetch

## Requirements Proved By This UAT

- None (no REQUIREMENTS.md)

## Not Proven By This UAT

- Actual network failure handling (what happens if changelog fetch fails)
- Performance of spinner animations under load
- Accessibility of loading states (covered by S04)

## Notes for Tester

- Spinners may be very brief on fast connections — use network throttling in devtools if you need to observe them
- The `streaming` class is the authoritative signal for whether a message is still in progress
- All 10 automated tests in `loading-states.test.ts` cover these same flows at the DOM level
