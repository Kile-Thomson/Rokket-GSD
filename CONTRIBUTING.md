# Contributing to Rokket GSD

Thanks for your interest in contributing to Rokket GSD!

## Reporting Bugs

Open an [issue](https://github.com/Kile-Thomson/Rokket-GSD/issues/new?template=bug_report.md) with:

- Your OS and VS Code version
- The `gsd-pi` version (`gsd --version`)
- Steps to reproduce
- What you expected vs what happened
- Any relevant console output (Help > Toggle Developer Tools)

## Feature Requests

Open an [issue](https://github.com/Kile-Thomson/Rokket-GSD/issues/new?template=feature_request.md) describing the feature and why it would be useful.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. `npm install` and `npm run build` to verify the build works
3. Make your changes
4. Run `npm test` and ensure all tests pass
5. Open a PR with a clear description of the change

### Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/Rokket-GSD.git
cd Rokket-GSD
npm install
npm run watch
# Press F5 in VS Code to launch Extension Development Host
```

## Architecture Overview

The extension uses a **three-layer architecture**:

```
Webview (IIFE)  ◄── postMessage ──►  Extension Host (CJS)  ◄── stdin/stdout JSONL ──►  gsd-pi (RPC)
```

- **Webview** — The chat UI runs in a VS Code webview as a single IIFE bundle. It uses vanilla DOM manipulation (no framework) and communicates with the extension host exclusively via `postMessage`. No access to Node.js or the VS Code API.
- **Extension Host** — A CommonJS module running in VS Code's Node.js process. It manages the webview lifecycle, routes messages between webview and gsd-pi, handles file operations, and maintains per-session state. Full access to `vscode.*` APIs.
- **gsd-pi** — The AI agent runs as a child process spawned with `--mode rpc`. Communication uses JSON-RPC 2.0 over stdin/stdout with newline-delimited JSON (JSONL).

The webview never communicates directly with gsd-pi — all interactions are mediated by the extension host.

For the full architecture reference including message flow diagrams, CSS token system, and RPC protocol details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Test Guide

### Running Tests

```bash
# Run all tests
npx vitest --run

# Run tests with coverage report
npx vitest --run --coverage

# Run a specific test file
npx vitest --run src/extension/watchdogs.test.ts

# Run tests in watch mode (re-runs on file changes)
npx vitest
```

### Coverage Target

The project enforces a **60% line coverage** threshold (configured in `vitest.config.ts`). CI will fail if coverage drops below this. Run `npx vitest --run --coverage` locally to check before pushing.

### Adding a New Test File

**Extension tests** (Node.js environment):
- Place test files alongside the source: `src/extension/my-module.test.ts`
- Tests run in the default Node.js environment
- Mock the VS Code API using `vi.mock('vscode')` — see `src/extension/watchdogs.test.ts` for a mock factory pattern

**Webview tests** (jsdom environment):
- Place test files in `src/webview/__tests__/my-module.test.ts`
- Add the jsdom environment directive at the top of the file:
  ```typescript
  // @vitest-environment jsdom
  ```
- This gives you `document`, `window`, and DOM APIs in tests
- See `src/webview/__tests__/renderer.test.ts` for patterns on mocking `helpers.ts` functions

### Mock Patterns

**Mock factory pattern** (used in `watchdogs.test.ts`):
```typescript
vi.mock('vscode', () => ({
  window: { showWarningMessage: vi.fn() },
  // ... other VS Code APIs you need
}));
```

**Module mock pattern** (used in `renderer.test.ts`):
```typescript
vi.mock('../helpers', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
  escapeHtml: vi.fn((text: string) => text),
}));
```

### Test Conventions

- Use `describe` blocks to group related tests
- Use clear test names: `it('should abort streaming when cancel is clicked')`
- Keep tests focused — one behavior per test
- Prefer `vi.fn()` over manual stubs for better assertion support

## Module Map

A condensed orientation guide to every source file, organized by layer. For full details including LOC counts and key exports, see [ARCHITECTURE.md](ARCHITECTURE.md).

### Extension Host — `src/extension/`

| File | Responsibility |
|---|---|
| `index.ts` | Entry point — registers commands, status bar, webview provider |
| `webview-provider.ts` | Webview lifecycle, session management, context adapter orchestration |
| `message-dispatch.ts` | Routes all webview-to-extension message types to handlers |
| `rpc-client.ts` | JSON-RPC client — spawns gsd-pi, manages stdin/stdout communication |
| `rpc-events.ts` | Forwards RPC streaming events to webview as typed messages |
| `polling.ts` | Periodic polling for stats, health, and workflow state |
| `html-generator.ts` | Generates webview HTML with CSP nonce and script/style tags |
| `session-state.ts` | Per-session state container (replaces individual Maps) |
| `session-list-service.ts` | Lists and manages session JSONL files on disk |
| `state-parser.ts` | Parses `.gsd/STATE.md` for workflow state |
| `dashboard-parser.ts` | Parses `.gsd/` project files for dashboard data |
| `metrics-parser.ts` | Parses `.gsd/metrics.json` for cost/token metrics |
| `captures-parser.ts` | Parses `.gsd/captures/` for pending capture items |
| `auto-progress-poller.ts` | Polls auto-mode progress and aggregates worker data |
| `auto-progress.ts` | Auto-mode progress state tracking and event handling |
| `command-fallback.ts` | Detects missing agent turns after `/gsd` commands, sends fallback prompts |
| `watchdogs.ts` | Prompt, slash-command, and activity watchdog timers |
| `file-ops.ts` | File operations — open, diff, export, copy, temp files |
| `health-check.ts` | Process health monitoring via RPC ping |
| `update-checker.ts` | GitHub release checking, download, and install |
| `parallel-status.ts` | Parallel worker status aggregation |

### Shared — `src/shared/`

| File | Responsibility |
|---|---|
| `types.ts` | Message protocol types, state interfaces, all data structures |

### Webview — `src/webview/`

| File | Responsibility |
|---|---|
| `index.ts` | DOM setup, event binding, CSS imports, initialization |
| `state.ts` | Webview-side types and shared mutable state |
| `helpers.ts` | Pure functions — markdown rendering, escaping, formatting, sanitization |
| `message-handler.ts` | Dispatches all extension-to-webview messages, updates state, calls renderer |
| `renderer.ts` | Chat entry rendering, streaming segment DOM management |
| `slash-menu.ts` | Slash command palette — fuzzy filter, keyboard navigation |
| `model-picker.ts` | Model selection overlay with provider grouping |
| `thinking-picker.ts` | Thinking level selection overlay |
| `ui-dialogs.ts` | Inline confirm, select, and text input dialogs (agent-initiated) |
| `dashboard.ts` | Dashboard panel — milestone progress, cost, metrics |
| `keyboard.ts` | Keyboard shortcuts — global bindings, overlay navigation |
| `ui-updates.ts` | UI state updates — header, footer, input area, indicators |
| `a11y.ts` | Accessibility utilities — focus traps, focus save/restore |
| `visualizer.ts` | Workflow visualizer overlay — milestone/slice/task tree |
| `auto-progress.ts` | Auto-mode progress bar rendering and updates |
| `toasts.ts` | Toast notification rendering |
| `tool-grouping.ts` | Groups consecutive tool calls for collapsed display |
| `session-history.ts` | Session history sidebar — list, switch, rename, delete |
| `file-handling.ts` | File attachment handling — paste, drag-drop, picker |

### CSS — `src/webview/styles/`

16 CSS files in strict cascade order. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full import order and the design token system.

## RPC Protocol Quick Reference

The extension communicates with gsd-pi over JSON-RPC 2.0 (JSONL over stdin/stdout). These are the key methods for extension developers:

| Method | Description |
|---|---|
| `prompt` | Send a user prompt — triggers streaming response events |
| `abort` | Abort the current streaming response |
| `getState` | Get current agent state (model, streaming status, session info) |
| `getMessages` | Get all messages in the current session |
| `fork` | Fork conversation from a specific entry |
| `switchSession` | Switch to an existing session by file path |

For the full list of 24 RPC methods and 22 event types, see the [RPC Protocol section in ARCHITECTURE.md](ARCHITECTURE.md#rpc-protocol).

### Code Style

- TypeScript throughout, no `any` unless unavoidable
- No frameworks in the webview (vanilla DOM)
- Run `npm run lint` before submitting

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
