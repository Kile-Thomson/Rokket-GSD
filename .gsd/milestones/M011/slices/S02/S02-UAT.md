# S02: Event Handling & Diagnostics — UAT

## Prerequisites
- VS Code with Rokket GSD extension installed
- gsd-pi 2.12+ available

## Test 1: Fallback Chain Exhausted
1. Simulate or trigger all fallback providers being exhausted
2. **Verify:** A user-friendly error toast appears (not a raw error or silent failure)

## Test 2: HTML Export Cross-Platform
1. Open a GSD chat session with some conversation history
2. Use the export action to save as HTML
3. **Verify:** The exported HTML file opens in the system browser (works on macOS/Linux, not just Windows)

## Test 3: Tool Icons
1. Send prompts that trigger various tool calls: `github_issues`, `mcp_call`, `ask_user_questions`, `web_search`, `async_bash`
2. **Verify:** Each tool card displays a category-appropriate icon (not a generic fallback)
