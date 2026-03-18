# S02: Resume Last Session — UAT

## Prerequisites
- VS Code with Rokket GSD extension installed
- At least one prior GSD session in history

## Test 1: Resume from Welcome Screen
1. Open a fresh GSD chat panel (no active session)
2. **Verify:** A `↩ Resume` chip/button is visible on the welcome screen
3. Click the `↩ Resume` button
4. **Verify:** The most recent session loads with its full conversation history

## Test 2: Resume via Slash Command
1. Open the GSD chat panel
2. Type `/resume` in the input box
3. Select the "Resume last session" option from the slash menu
4. **Verify:** The most recent session loads

## Test 3: No Prior Sessions
1. Open a fresh GSD panel with no session history (clean workspace)
2. **Verify:** The `↩ Resume` chip is hidden (not visible on the welcome screen)

## Test 4: Resume Error Handling
1. If session files are corrupted or missing, attempt to resume
2. **Verify:** An error message appears (not a crash or unhandled exception)
