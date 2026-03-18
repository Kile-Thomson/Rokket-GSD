# S02: Dynamic Model Routing Display

## Tasks

- [x] **T01: Model change detection & message type** `est:15min`
- [x] **T02: Header badge flash animation** `est:15min`
- [x] **T03: Model routing toast** `est:15min`
- [x] **T04: Tests & verification** `est:15min`

## Approach

### T01: Model change detection & message type
The `AutoProgressPoller` already has model change detection via `onModelChanged` callback. Add a `model_routed` message type to the protocol. Fire it from the extension host when the callback triggers.

### T02: Header badge flash animation
When `model_routed` message arrives, update the model badge in the header with the new model, and trigger a CSS flash animation (brief highlight + scale bump) to make the change visually obvious.

### T03: Model routing toast
When `model_routed` arrives, show a toast: "Model routed: sonnet → haiku". Uses existing toast infrastructure.

### T04: Tests & verification
Build, lint, test. Verify no regressions.
