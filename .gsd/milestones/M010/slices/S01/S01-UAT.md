# S01: Parallel Tool Indicator & New Event Handling — UAT

## Prerequisites
- VS Code with Rokket GSD extension installed
- gsd-pi 2.12+ available

## Test 1: Parallel Tool Indicator
1. Open the GSD chat panel
2. Send a prompt that triggers multiple tool calls simultaneously (e.g., ask the agent to read several files at once)
3. **Verify:** Tool cards for concurrently running tools display a ⚡ badge
4. **Verify:** The ⚡ badge pulses while tools are in-flight
5. **Verify:** Sequential (non-overlapping) tool calls do NOT show the ⚡ badge

## Test 2: Provider Fallback Notification
1. Trigger a rate limit on the primary provider (or simulate by switching provider config mid-session)
2. **Verify:** A toast notification appears showing the from→to provider switch (e.g., "Switched from anthropic to openai")
3. **Verify:** The model badge in the header updates to reflect the fallback model

## Test 3: Provider Restoration
1. After a fallback switch, wait for the original provider to recover
2. **Verify:** A toast notification confirms the original provider is restored
3. **Verify:** The model badge reverts to the original model

## Test 4: Session Shutdown
1. Trigger a `session_shutdown` event (e.g., stop the gsd-pi process gracefully)
2. **Verify:** The chat UI shows a clean "session ended" state — no crash banner, no disconnect error
3. **Verify:** The streaming indicator stops and process status shows stopped
