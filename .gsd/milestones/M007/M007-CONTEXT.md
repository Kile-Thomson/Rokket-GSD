# M007: UX Polish & Interaction Improvements — Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

## Project Description

Rokket GSD VS Code extension — a chat UI wrapping the GSD AI coding agent in a VS Code sidebar/tab.

## Why This Milestone

The core chat experience works well but lacks standard UX patterns that users expect from a modern chat interface. Missing: scroll-to-bottom when reviewing history, timestamps, quick actions on the welcome screen, response copying, toast feedback, thinking block management, message editing, and input resizing.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Jump back to the latest message with a floating button after scrolling up
- See when messages were sent via timestamps
- Start common workflows from the welcome screen without typing
- Copy an entire assistant response with one click
- See brief toast feedback for actions like export, model change, compact
- View thinking blocks collapsed by default with a size indicator
- Edit and resend a previous message
- Drag the input area taller for composing long prompts

### Entry point / environment

- Entry point: VS Code extension sidebar / editor tab
- Environment: VS Code webview (browser runtime)
- Live dependencies involved: none (all features are webview-only)

## Completion Class

- Contract complete means: each feature renders correctly and responds to user interaction
- Integration complete means: features work with live GSD streaming sessions
- Operational complete means: none (no lifecycle concerns)

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- All 8 features work in a live GSD session with streaming responses
- Features don't interfere with existing functionality (streaming, tool calls, slash commands)

## Risks and Unknowns

- Low risk overall — all features are self-contained webview changes
- Message edit/resend needs to interact with the RPC layer (re-prompting)

## Existing Codebase / Prior Art

- `src/webview/index.ts` — main DOM setup, event handling, message routing (1055 lines)
- `src/webview/renderer.ts` — entry rendering, streaming segments (368 lines)
- `src/webview/styles.css` — theme-aware styling (1,716 lines)
- `src/webview/helpers.ts` — pure functions, markdown, formatting (308 lines)
- `src/webview/ui-dialogs.ts` — inline confirm/select/input dialogs (140 lines)
- `src/shared/types.ts` — message protocol types

## Scope

### In Scope

- Scroll-to-bottom FAB
- Message timestamps
- Welcome screen quick action chips
- Copy full assistant response button
- Toast notification system
- Collapsible thinking blocks (default collapsed)
- User message edit/resend
- Drag-to-resize input area

### Out of Scope / Non-Goals

- Keyboard shortcut help overlay
- Search within conversation
- Test suite (M006)

## Technical Constraints

- Vanilla DOM only (no framework)
- Must use VS Code CSS variables for theme compatibility
- Bundle size should stay small
