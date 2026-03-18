# S03: Mid-Execution Capture & Badge

## Tasks

- [x] **T01: Capture badge in auto-progress widget** `est:20min`
- [x] **T02: CAPTURES.md parser in extension host** `est:15min`
- [x] **T03: Wire capture count into auto-progress data** `est:10min`
- [x] **T04: Tests & verification** `est:15min`

## Approach

### T01: Capture badge in auto-progress widget
`/gsd capture` already works as a prompt via the existing slash menu — it sends the text to the RPC process. The pi extension handles capture storage. We need to show the pending capture count as a badge in the auto-progress widget (when count > 0).

Add `pendingCaptures` field to `AutoProgressData`. Render as a small badge next to the progress bars: "📌 3 pending".

### T02: CAPTURES.md parser
Parse `.gsd/CAPTURES.md` from the extension host to count pending captures. Format: H3 sections with `**Status:** pending|triaged|resolved`. Count entries where status is "pending".

### T03: Wire capture count into auto-progress data
AutoProgressPoller reads CAPTURES.md count during each poll and includes it in the `auto_progress` message.

### T04: Tests & verification
Unit test for CAPTURES.md parser. Build, lint, test.
