# Architecture

Rokket GSD VS Code Extension — post-remediation architecture reference.

> **Audience:** New contributors and AI agents working on the codebase.
> **Last updated:** April 2026 (v0.3.45 — Telegram integration, M025 tech debt refactor)

---

## Overview

The extension uses a **three-layer architecture** with strict communication boundaries:

```
┌──────────────────────┐     postMessage      ┌──────────────────────┐   stdin/stdout JSONL   ┌──────────────────┐
│   Webview (IIFE)     │ ◄──────────────────► │  Extension Host (CJS) │ ◄──────────────────► │  gsd-pi (RPC)    │
│   Browser sandbox    │                      │  Node.js process      │                      │  Child process   │
│   Vanilla DOM        │                      │  VS Code API access   │                      │  AI agent engine │
└──────────────────────┘                      └──────────┬───────────┘                      └──────────────────┘
                                                         │ IPC
                                              ┌──────────▼───────────┐
                                              │  Telegram Bridge     │
                                              │  Poller (child proc) │
                                              │  OpenAI Whisper      │
                                              └──────────────────────┘
```

**Layer 1 — Webview (IIFE, browser environment):**
The chat UI runs inside a VS Code webview as a single IIFE bundle (~197KB minified). It uses vanilla DOM manipulation — no framework. It communicates with the extension host exclusively via `postMessage`. The webview has no access to Node.js APIs, the filesystem, or the VS Code API.

**Layer 2 — Extension Host (CJS, Node.js):**
The extension host runs as a CommonJS module inside VS Code's Node.js process (~91KB bundled). It manages the webview lifecycle, routes messages between webview and RPC client, handles file operations, and maintains per-session state. It has full access to the VS Code API (`vscode.*`).

**Layer 3 — gsd-pi (child process):**
The GSD AI agent runs as a child process spawned with `--mode rpc`. Communication uses JSON-RPC over stdin/stdout with newline-delimited JSON (JSONL). The extension host writes requests to stdin and reads events/responses from stdout.

**Layer 4 — Telegram Bridge (optional, child process):**
The Telegram bridge runs as an isolated child process coordinated by the extension host. It polls the Telegram Bot API for incoming messages, routes them to GSD sessions via topic-to-session mapping, and formats GSD responses back to Telegram HTML. Voice messages are transcribed via OpenAI Whisper before forwarding. The bridge communicates with the extension host over IPC.

### Communication Boundaries

| Boundary | Transport | Format | Direction |
|---|---|---|---|
| Webview ↔ Extension Host | `postMessage` | Typed discriminated unions | Bidirectional |
| Extension Host ↔ gsd-pi | stdin/stdout | JSON-RPC JSONL | Bidirectional |
| Extension Host ↔ Telegram Poller | IPC (child process) | Typed messages | Bidirectional |
| Telegram Poller ↔ Telegram API | HTTPS | Bot API JSON | Bidirectional |
| Extension Host ↔ OpenAI Whisper | HTTPS | Multipart form | Request/Response |

The webview never communicates directly with gsd-pi or Telegram. All interactions are mediated by the extension host.

---

## Message Flow

A user prompt flows through the system as follows:

```
User types in <textarea>
    │
    ▼
index.ts  ──  captures Enter / click, builds WebviewToExtensionMessage { type: "prompt", message }
    │
    ▼  postMessage
    │
message-dispatch.ts  ──  switch on msg.type, extracts payload
    │
    ▼  calls client.prompt()
    │
rpc-client.ts  ──  serializes JSON-RPC request, writes to child process stdin
    │
    ▼  stdin JSONL
    │
gsd-pi  ──  processes prompt, streams events back on stdout
    │
    ▼  stdout JSONL (streaming events)
    │
rpc-events.ts  ──  parses event, maps to ExtensionToWebviewMessage, calls postToWebview()
    │
    ▼  postMessage
    │
message-handler.ts  ──  switch on msg.type, updates state, calls renderer
    │
    ▼
renderer.ts  ──  builds/updates DOM elements for the assistant turn
    │
    ▼
User sees streaming response
```

### Key Message Types at Each Boundary

**Webview → Extension (WebviewToExtensionMessage):**
- `prompt` — user sends a message
- `steer` / `follow_up` — mid-stream steering or follow-up
- `interrupt` / `cancel_request` — abort current generation
- `new_conversation` / `switch_session` / `fork_conversation` — session management
- `set_model` / `set_thinking_level` — model configuration
- `get_state` / `get_session_stats` — state queries
- ~50 total message types defined in `src/shared/types.ts`

**Extension → Webview (ExtensionToWebviewMessage):**
- `state` — full GsdState snapshot
- `agent_start` / `agent_end` — agent lifecycle
- `turn_start` / `turn_end` — turn lifecycle
- `message_start` / `message_update` / `message_end` — streaming message events
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end` — tool call lifecycle
- `error` / `process_exit` / `process_status` / `process_health` — error and process state
- ~35 total message types defined in `src/shared/types.ts`

**RPC Events (stdout from gsd-pi):**
- `agent_start` / `agent_end` — agent lifecycle boundaries
- `text_delta` — streaming text content
- `thinking_delta` — streaming thinking content
- `tool_use` — tool call initiation
- `tool_result` — tool execution result
- `extension_ui_request` — interactive UI prompts from the agent
- `model_routed` / `fallback_provider_switch` — model routing events

---

## Module Map

### Extension Host — `src/extension/` (~8,400 LOC)

| File | LOC | Responsibility | Key Exports |
|---|---|---|---|
| `index.ts` | 111 | Entry point — registers commands, status bar, webview provider | `activate()` |
| `webview-provider.ts` | 450 | Webview lifecycle, session management, context adapter orchestration | `GsdWebviewProvider` |
| `message-dispatch.ts` | 905 | Routes all `WebviewToExtensionMessage` types to handlers | `handleWebviewMessage()`, `MessageDispatchContext` |
| `rpc-client.ts` | 732 | JSON-RPC client — spawns gsd-pi, manages stdin/stdout communication | `GsdRpcClient`, `sanitizeEnvForChildProcess()` |
| `rpc-events.ts` | 256 | Forwards RPC streaming events to webview as typed messages | `handleRpcEvent()`, `RpcEventContext` |
| `polling.ts` | 126 | Periodic polling for stats, health, and workflow state | `startStatsPolling()`, `startHealthMonitoring()`, `refreshWorkflowState()` |
| `html-generator.ts` | 41 | Generates webview HTML with CSP nonce and script/style tags | `getWebviewHtml()` |
| `session-state.ts` | 147 | Per-session state container (replaces 17+ individual Maps) | `SessionState`, `createSessionState()`, `cleanupSessionState()` |
| `session-list-service.ts` | 242 | Lists and manages session JSONL files on disk | `listSessions()`, `deleteSession()` |
| `state-parser.ts` | 85 | Parses `.gsd/STATE.md` for workflow state | `parseStateFile()` |
| `dashboard-parser.ts` | 251 | Parses `.gsd/` project files for dashboard data | `buildDashboardData()` |
| `metrics-parser.ts` | 292 | Parses `.gsd/metrics.json` for cost/token metrics | `loadMetricsLedger()`, `buildMetricsData()` |
| `captures-parser.ts` | 35 | Parses `.gsd/captures/` for pending capture items | `loadCaptures()` |
| `auto-progress-poller.ts` | 316 | Polls auto-mode progress and aggregates worker data | `AutoProgressPoller` |
| `auto-progress.ts` | 316 | Auto-mode progress state tracking and event handling | `AutoProgressTracker` |
| `command-fallback.ts` | 405 | Detects missing agent turns after `/gsd` commands, sends fallback prompts | `armGsdFallbackProbe()`, `startGsdFallbackTimer()` |
| `watchdogs.ts` | 327 | Prompt, slash-command, and activity watchdog timers | `startPromptWatchdog()`, `clearPromptWatchdog()`, `startActivityMonitor()` |
| `file-ops.ts` | 307 | File operations — open, diff, export, copy, temp files | `handleOpenFile()`, `handleExportHtml()`, `handleAttachFiles()` |
| `health-check.ts` | 270 | Process health monitoring via RPC ping | `HealthChecker` |
| `update-checker.ts` | 570 | GitHub release checking, download, and install | `downloadAndInstallUpdate()`, `fetchReleaseNotes()` |
| `parallel-status.ts` | 128 | Parallel worker status aggregation | `ParallelStatusTracker` |

### Telegram Bridge — `src/extension/telegram/` (2,094 LOC)

| File | LOC | Responsibility | Key Exports |
|---|---|---|---|
| `bridge.ts` | 787 | Orchestrates Telegram↔GSD session bridging, message routing | `TelegramBridge` |
| `api.ts` | 300 | Telegram Bot API client — polling, sending, file downloads | `TelegramApi` |
| `topicManager.ts` | 219 | Maps Telegram topics/threads to GSD sessions | `TopicManager` |
| `poller-server.ts` | 190 | Runs Telegram polling in a child process for isolation | `PollerServer` |
| `setup.ts` | 170 | Guided setup wizard for Telegram bot configuration | `runTelegramSetup()` |
| `poller-coordinator.ts` | 136 | Coordinates poller lifecycle (start/stop/restart) | `PollerCoordinator` |
| `poller-client.ts` | 112 | Client-side IPC to communicate with poller process | `PollerClient` |
| `formatter.ts` | 77 | Formats GSD responses for Telegram (markdown→Telegram HTML) | `formatForTelegram()` |
| `config.ts` | 55 | Telegram configuration loading and validation | `TelegramConfig` |
| `poller-ipc.ts` | 48 | Shared IPC message types between poller client/server | `PollerIpcMessage` |

### Shared — `src/shared/` (477 LOC)

| File | LOC | Responsibility | Key Exports |
|---|---|---|---|
| `types.ts` | 477 | Message protocol types, state interfaces, data structures | `WebviewToExtensionMessage`, `ExtensionToWebviewMessage`, `GsdState`, `AgentMessage`, `SessionStats`, `StreamDelta`, `toGsdState()` |

### Webview — `src/webview/` (8,542 LOC)

| File | LOC | Responsibility | Key Exports |
|---|---|---|---|
| `index.ts` | 745 | DOM setup, event binding, CSS imports (16 modules), initialization | `— (IIFE entry point)` |
| `state.ts` | 238 | Webview-side types and shared mutable state | `AppState`, `ChatEntry`, `AssistantTurn`, `TurnSegment`, `ToolCallState` |
| `helpers.ts` | 639 | Pure functions — markdown rendering, escaping, formatting, sanitization | `renderMarkdown()`, `escapeHtml()`, `formatDuration()`, `scrollToBottom()` |
| `message-handler.ts` | 1,125 | Dispatches all `ExtensionToWebviewMessage` types, updates state, calls renderer | `handleMessage()`, `init()` |
| `renderer.ts` | 884 | Entry rendering, streaming segment DOM management, incremental updates | `renderEntry()`, `appendStreamingSegment()`, `finalizeStreaming()` |
| `slash-menu.ts` | 345 | Slash command palette — fuzzy filter, keyboard navigation, execution | `SlashMenu` |
| `model-picker.ts` | 243 | Model selection overlay with provider grouping | `ModelPicker` |
| `thinking-picker.ts` | 289 | Thinking level selection overlay | `ThinkingPicker` |
| `ui-dialogs.ts` | 472 | Inline confirm, select, and text input dialogs (agent-initiated) | `handleExtensionUiRequest()` |
| `dashboard.ts` | 492 | Dashboard panel — milestone progress, cost, metrics visualization | `renderDashboard()` |
| `keyboard.ts` | 529 | Keyboard shortcuts — global bindings, overlay navigation, focus management | `initKeyboard()` |
| `ui-updates.ts` | 429 | UI state updates — header, footer, input area, overlay indicators | `updateAllUI()`, `updateHeaderUI()`, `updateFooterUI()` |
| `a11y.ts` | 53 | Accessibility utilities — focus traps, focus save/restore | `createFocusTrap()`, `saveFocus()`, `restoreFocus()` |
| `visualizer.ts` | 591 | Workflow visualizer overlay — milestone/slice/task tree rendering | `renderVisualizer()` |
| `auto-progress.ts` | 383 | Auto-mode progress bar rendering and updates | `renderAutoProgress()` |
| `toasts.ts` | 30 | Toast notification rendering | `showToast()` |
| `tool-grouping.ts` | 292 | Groups consecutive tool calls for collapsed display | `groupConsecutiveTools()`, `buildGroupSummaryLabel()` |
| `session-history.ts` | 520 | Session history sidebar — list, switch, rename, delete sessions | `renderSessionList()` |
| `file-handling.ts` | 243 | File attachment handling — paste, drag-drop, picker | `initFileHandling()` |

### CSS — `src/webview/styles/` (16 files)

| File | Responsibility |
|---|---|
| `tokens.css` | 85 design tokens (`--gsd-*` custom properties) |
| `base.css` | Reset, typography, scrollbar, selection styles |
| `layout.css` | App shell, panels, sidebar layout |
| `entries.css` | Chat entry styling — user, assistant, system messages |
| `tools.css` | Tool call cards, execution indicators, result display |
| `dashboard.css` | Dashboard panel layout, charts, metrics cards |
| `input.css` | Prompt input area, attachment previews, send button |
| `footer.css` | Footer bar — status, model display, thinking level |
| `overlays.css` | Modal overlays — settings, session history, changelog |
| `toasts.css` | Toast notification positioning and animation |
| `misc.css` | Utility classes, scrollbar tweaks, edge cases |
| `auto-progress.css` | Auto-mode progress bar styling |
| `parallel.css` | Parallel worker status cards |
| `themes/phosphor.css` | Phosphor theme — terminal/CRT aesthetic |
| `themes/clarity.css` | Clarity theme — clean, minimal light-friendly |
| `themes/forge.css` | Forge theme — warm, industrial tones |

---

## CSS Architecture

### Design Token System

The extension uses a semantic token layer to decouple component styles from VS Code's theming system:

```
VS Code theme (--vscode-*)  →  Design tokens (--gsd-*)  →  Component CSS
```

**`src/webview/styles/tokens.css`** defines 85 `--gsd-*` custom properties organized into categories:

- **Spacing:** `--gsd-space-xxs` through `--gsd-space-xxl` (2px–20px scale)
- **Sizing:** `--gsd-radius-xs` through `--gsd-radius-xl` (border radii)
- **Colors:** Surface, text, border, and accent colors mapped from `--vscode-*` with literal fallbacks
- **Component tokens:** Component-specific properties like `--gsd-input-bg`, `--gsd-entry-border`, `--gsd-tool-bg`
- **Typography:** Font sizes and weights for headings, body, and code
- **Transitions:** Duration and easing tokens for animations

Every token has a `--vscode-*` or literal fallback so the UI renders correctly even without a theme override.

### Import Order

CSS modules are imported in `src/webview/index.ts` in a strict cascade order:

```
1.  tokens.css         — Design tokens (must be first)
2.  base.css           — Reset and typography
3.  layout.css         — App shell structure
4.  entries.css        — Chat entry styles
5.  tools.css          — Tool call styles
6.  dashboard.css      — Dashboard panel
7.  input.css          — Prompt input area
8.  footer.css         — Footer bar
9.  overlays.css       — Modal overlays
10. toasts.css         — Toast notifications
11. misc.css           — Utilities
12. auto-progress.css  — Auto-mode progress bar
13. parallel.css       — Parallel worker status
14. phosphor.css       — Theme: Phosphor
15. clarity.css        — Theme: Clarity
16. forge.css          — Theme: Forge
```

Themes are loaded last so their overrides take precedence.

### Theme Override Pattern

Themes override `--gsd-*` tokens using a `data-theme` attribute selector on the app root:

```css
/* tokens.css — default values */
:root {
  --gsd-surface-primary: var(--vscode-editor-background, #1e1e1e);
}

/* themes/phosphor.css — theme override */
.gsd-app[data-theme="phosphor"] {
  --gsd-surface-primary: #050505;
}
```

Components only reference `--gsd-*` tokens, never `--vscode-*` directly. This means:
1. Adding a new theme = adding one CSS file with token overrides
2. Components never need theme-specific selectors
3. VS Code theme changes propagate automatically through the `--vscode-*` → `--gsd-*` mapping

---

## RPC Protocol

### Transport

JSON-RPC 2.0 over stdin/stdout with newline-delimited JSON (JSONL). Each message is a single JSON object terminated by `\n`.

The extension host writes requests to the child process's stdin and reads responses/events from stdout. Stderr is captured for logging but not part of the protocol.

### Request Format

```json
{"jsonrpc":"2.0","id":1,"method":"prompt","params":{"message":"Hello","images":[]}}
```

### Response Format

```json
{"jsonrpc":"2.0","id":1,"result":{}}
```

### Event Format (notifications — no id)

```json
{"jsonrpc":"2.0","method":"event","params":{"type":"text_delta","delta":"Hello"}}
```

### RPC Methods

| Method | Parameters | Description |
|---|---|---|
| `prompt` | `{ message, images?, streamingBehavior? }` | Send a user prompt; triggers streaming response |
| `steer` | `{ message, images? }` | Steer the agent mid-stream (interrupts current generation) |
| `followUp` | `{ message, images? }` | Send a follow-up without interrupting |
| `abort` | `{}` | Abort the current streaming response |
| `getState` | `{}` | Get current agent state (model, streaming status, session info) |
| `getMessages` | `{}` | Get all messages in the current session |
| `getForkMessages` | `{}` | Get messages for fork context (used after fork) |
| `setModel` | `{ provider, modelId }` | Switch the active model |
| `setThinkingLevel` | `{ level }` | Set thinking depth (`off` \| `minimal` \| `low` \| `medium` \| `high` \| `xhigh`) |
| `cycleThinkingLevel` | `{}` | Cycle to the next thinking level |
| `newSession` | `{}` | Start a new conversation session |
| `switchSession` | `{ sessionPath }` | Switch to an existing session by file path |
| `fork` | `{ entryId }` | Fork conversation from a specific entry |
| `setSessionName` | `{ name }` | Rename the current session |
| `compact` | `{ customInstructions? }` | Compact context window |
| `setAutoCompaction` | `{ enabled }` | Toggle auto-compaction |
| `setAutoRetry` | `{ enabled }` | Toggle auto-retry on errors |
| `abortRetry` | `{}` | Cancel pending auto-retry |
| `setSteeringMode` | `{ mode }` | Set steering mode (`all` \| `one-at-a-time`) |
| `setFollowUpMode` | `{ mode }` | Set follow-up mode (`all` \| `one-at-a-time`) |
| `getCommands` | `{}` | Get available slash commands |
| `getAvailableModels` | `{}` | Get available models from all providers |
| `getSessionStats` | `{}` | Get token/cost/message statistics |
| `executeBash` | `{ command }` | Execute a bash command via the agent |
| `ping` | `{}` | Health check (10s timeout) |

### Event Types (streamed from gsd-pi)

| Event Type | Description |
|---|---|
| `agent_start` | Agent begins processing |
| `agent_end` | Agent finishes (includes final messages) |
| `turn_start` | New assistant turn begins |
| `turn_end` | Assistant turn completes (includes message + tool results) |
| `message_start` | New message in the stream |
| `message_update` | Streaming delta (text, thinking, or tool call) |
| `message_end` | Message complete |
| `tool_execution_start` | Tool call begins (name, args) |
| `tool_execution_update` | Tool call partial result |
| `tool_execution_end` | Tool call finished (result, error flag, duration) |
| `auto_compaction_start` | Context compaction triggered |
| `auto_compaction_end` | Context compaction finished |
| `auto_retry_start` | Auto-retry initiated (attempt, delay) |
| `auto_retry_end` | Auto-retry resolved (success/failure) |
| `extension_ui_request` | Agent requests interactive UI (confirm, select, input) |
| `model_routed` | Model was automatically routed |
| `fallback_provider_switch` | Provider fallback activated |
| `fallback_provider_restored` | Provider restored from fallback |
| `fallback_chain_exhausted` | All fallback providers failed |
| `process_exit` | Child process exited |
| `process_status` | Process lifecycle state change |
| `process_health` | Health check result |
| `extension_error` | Error in an extension component |

---

## Data Flow

### State Flow: RPC → Extension → Webview

```
gsd-pi (getState response)
    │
    ▼  RpcStateResult (loose shape, [key: string]: unknown)
    │
toGsdState()  ——  src/shared/types.ts
    │
    ▼  GsdState (strict interface)
    │
webview-provider.ts  ──  postToWebview({ type: "state", data: gsdState })
    │
    ▼  postMessage
    │
message-handler.ts  ──  state.gsdState = msg.data
    │
    ▼
ui-updates.ts  ──  updates header, footer, input area based on GsdState fields
```

**`GsdState`** is the canonical state snapshot. It contains:
- `model` — current model info (id, name, provider)
- `thinkingLevel` — current thinking depth
- `isStreaming` / `isCompacting` — activity flags
- `sessionFile` / `sessionId` / `sessionName` — session identity
- `messageCount` / `pendingMessageCount` — message counters
- `autoCompactionEnabled` — auto-compaction toggle
- `steeringMode` / `followUpMode` — interaction modes

### Streaming Message Flow: Events → TurnSegments → DOM

During streaming, gsd-pi emits a sequence of events that build up the assistant's response:

```
turn_start  ──────────────────────────────────────────────────────►
    │
message_start  ───►  message_update (text_delta)  ───►  message_end
    │                     │
    │                     ▼
    │              Append to TurnSegment { type: "text", chunks: [...] }
    │
tool_execution_start  ───►  tool_execution_update  ───►  tool_execution_end
    │                            │
    │                            ▼
    │                     Update ToolCallState in AssistantTurn.toolCalls
    │                     TurnSegment { type: "tool", toolCallId }
    │
turn_end  ────────────────────────────────────────────────────────►
```

**`AssistantTurn`** (defined in `src/webview/state.ts`) contains:
- `segments: TurnSegment[]` — ordered array of text, thinking, and tool segments
- `toolCalls: Map<string, ToolCallState>` — lookup for tool call state by ID
- `isComplete: boolean` — set to true on `turn_end`

**`TurnSegment`** is a discriminated union:
- `{ type: "text", chunks: string[] }` — accumulated text deltas
- `{ type: "thinking", chunks: string[] }` — accumulated thinking deltas
- `{ type: "tool", toolCallId: string }` — reference to a tool call

The renderer (`src/webview/renderer.ts`) uses **sequential segment rendering**:
1. Each segment gets its own DOM element, appended in order
2. Text segments are updated incrementally — new chunks are appended without re-rendering earlier content (O(1) amortized, not O(n²))
3. Tool segments show a card with name, arguments, running indicator, and result
4. DOM updates are batched via `requestAnimationFrame` for smooth rendering
5. A 300-entry cap with scroll-preserving pruning prevents memory growth in long sessions

### Session State

Each webview (sidebar or tab) has an independent `SessionState` (defined in `src/extension/session-state.ts`):

```typescript
SessionState {
  client: GsdRpcClient | null       // RPC client for this session's gsd-pi process
  webview: vscode.Webview | null    // The webview instance
  panel: vscode.WebviewPanel | null // Tab panel (null for sidebar)
  statsTimer / healthTimer / ...    // Polling timers
  promptWatchdog                    // Prompt timeout detection
  slashWatchdog                     // Slash command timeout detection
  costFloor                         // Minimum cost display (persists across restarts)
  lastEventTime                     // Used by watchdogs for stale detection
}
```

The `webview-provider.ts` module maintains a `Map<string, SessionState>` and provides context adapter interfaces (`MessageDispatchContext`, `RpcEventContext`, `PollingContext`, etc.) to the extracted modules, keeping them decoupled from the provider class.

---

## Build & Bundle

**Bundler:** esbuild with two entry points:

| Entry | Target | Format | Output |
|---|---|---|---|
| `src/extension/index.ts` | `node` | `cjs` | `dist/extension.js` (~91KB) |
| `src/webview/index.ts` | `browser` | `iife` | `dist/webview.js` (~197KB) |

CSS files imported in `src/webview/index.ts` are bundled by esbuild into a single `dist/webview.css`.

The extension is packaged as a `.vsix` via `vsce`. Only `dist/`, `resources/`, `package.json`, `readme.md`, `changelog.md`, and install scripts are included (controlled by `.vscodeignore`).

---

## Testing

**Framework:** Vitest with jsdom environment for webview tests.

- Extension tests: `src/extension/*.test.ts` — Node.js environment, mock VS Code API via `__test-utils__/vscode-mock.ts`
- Webview tests: `src/webview/__tests__/*.test.ts` — jsdom environment (`// @vitest-environment jsdom` directive)
- Coverage target: 60% line coverage (CI-enforced via `vitest.config.ts`)
- Run: `npx vitest --run` (all tests) or `npx vitest --run --coverage` (with coverage report)
- Current: 1370 tests across 66 files
