<p align="center">
  <img src="resources/rokket-icon.png" alt="Rokket GSD" width="128" />
</p>

<h1 align="center">Rokket GSD</h1>

<p align="center">
  <strong>A VS Code extension that puts the <a href="https://github.com/badlogic/pi-mono">GSD (gsd-pi)</a> AI coding agent into a native chat panel.</strong><br>
  Full tool visualization, model switching, session history, and workflow automation — all inside VS Code.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.45-blue" alt="Version" />
  <img src="https://img.shields.io/badge/VS%20Code-1.94%2B-blue" alt="VS Code" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform" />


---

## What Is This?
</p><img width="3075" height="1335" alt="RokketGSD" src="https://github.com/user-attachments/assets/c9041d72-0dc0-4415-adcd-3414445c3f16" />

Rokket GSD wraps the `gsd-pi` CLI agent in a polished VS Code chat UI. Instead of running GSD in a terminal, you get streaming responses, rich tool call visualization, model switching, session history, and full workflow automation — without leaving your editor.

It communicates with GSD over JSON-RPC (`gsd --mode rpc`), so the agent runs as a child process with full access to your workspace, tools, and configured providers.

---

## ⚠️ Prerequisites

> **Rokket GSD is a frontend for the GSD agent — it does not include the agent itself.**

You need a working GSD environment before installing this extension:

1. **[Node.js](https://nodejs.org/) 18+** with npm
2. **[Git](https://git-scm.com/)**
3. **[VS Code](https://code.visualstudio.com/) 1.94+**
4. **`gsd-pi` installed globally:**
   ```bash
   npm install -g gsd-pi
   ```
5. **A valid API key** configured in GSD (Anthropic, OpenAI, Google, etc.)
   - Run `gsd` in a terminal first to verify it works before installing the extension

If `gsd` doesn't work in your terminal, the extension won't work either.

---

## Installation

### One-Liner (macOS / Linux / Git Bash)

```bash
curl -sL https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.sh | bash
```

### One-Liner (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.ps1 | iex
```

### Manual Install

```bash
git clone https://github.com/Kile-Thomson/Rokket-GSD.git
cd Rokket-GSD
npm install
npm run build
npx vsce package --no-dependencies
code --install-extension rokket-gsd-*.vsix --force
```

Then reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window").

### Auto-Updates

The extension checks for new releases on GitHub automatically. When an update is available, you'll get a notification with one-click install. No need to re-clone or rebuild.

> **Troubleshooting:** If `code --install-extension` succeeds silently but the extension doesn't appear, install manually: open VS Code → Extensions → `⋯` menu → "Install from VSIX..." → select the `.vsix` file.

---

## Features

### 🎨 VS Code Native

- **Activity bar icon** (rocket) with sidebar panel
- **Flexible layout** — open as sidebar or editor tab
- **Status bar** showing streaming state, model name, and session cost
- **Theme-aware** — works with any VS Code color theme (light, dark, high contrast)
- **Working indicator** — rocket logo pulses with an amber glow while the agent is active
- **Auto-updates** — checks GitHub Releases automatically, one-click install
- **Drag-to-resize** input area
- **Scroll-to-bottom FAB** — floating button appears when scrolled up
- **Toast notifications** — brief auto-dismissing feedback for actions

### 💬 Streaming Chat UI

- **Sequential rendering** — text, thinking blocks, and tool calls stream in the order they arrive, no re-renders or layout jumps
- **Full markdown** — syntax-highlighted code blocks, tables, blockquotes, headings, inline code, images
- **Copy buttons** on every code block and full assistant responses
- **Image paste/drop** — paste screenshots or drag images directly into the input
- **File attachments** — attach files via button, drag-and-drop, or paste with type-specific icons
- **Message timestamps** — relative times that update live, absolute on hover

### 🔧 Tool Execution Visualization

- **Live tool calls** with category-specific icons and color accents
- **Collapsible output** with smart truncation for large results
- **Parallel tool indicator** — ⚡ badge when tools run concurrently (gsd-pi 2.12+)
- **Tool call grouping** — consecutive read-only tools (file reads, searches) auto-collapse into summary rows
- **Subagent results** rendered as full markdown with tables, code blocks, and headings
- **Clickable file paths** — file paths in output open directly in VS Code
- **Shimmer animation** on running tools so you always know what's active

### 🤖 Agent Interaction

- **Steer while streaming** — send a message while the agent is working to redirect it mid-task
- **Inline UI dialogs** — confirm, select, and input prompts rendered directly in the chat flow (no modal popups)
- **Multi-select support** — checkbox-style multi-select for agent questions
- **Auto-compaction indicator** — overlay banner when context is being compacted
- **Auto-retry indicator** — shows retry status with countdown when the provider rate-limits
- **Provider fallback alerts** — toast notifications when GSD auto-switches models due to rate limits, and when the original provider recovers
- **Crash recovery** — restart button if the GSD process crashes, with full state cleanup
- **`!command` shortcut** — prefix with `!` to run a bash command directly without the agent

### 🧠 Model & Thinking Controls

- **Model picker** — switch models grouped by provider, showing context window size and reasoning capabilities
- **Thinking level picker** — dropdown to select off / minimal / low / medium / high / xhigh with descriptions
- **Model-aware thinking** — non-reasoning models show a disabled badge; extended thinking levels only appear for models that support them
- **Live metrics** — token count, session cost, and context usage bar in the header
- **Context bar** — color-coded progress bar (green → amber → red) at 70% and 90% thresholds

### ⚡ GSD Workflow Integration

- **Auto-mode progress widget** — live sticky bar during dispatch showing current task, phase, progress bars, elapsed time, cost, and active model (3-second polling)
- **Workflow visualizer** — `/gsd visualize` opens a full-page overlay with Progress and Metrics tabs, auto-refreshes every 5 seconds
- **Dynamic model routing indicator** — badge flashes and toast announces when gsd-pi switches models mid-task
- **Pending captures badge** — 📌 count in the progress widget for `/gsd capture` thoughts
- **Workflow state badge** — shows active milestone, slice, task, and current phase directly in the header
- **Auto-mode indicator** — ⚡ Auto, ▸ Next, ⏸ Paused, ✓ Complete status in the badge
- **Welcome screen quick actions** — clickable chips for Auto, Status, and Review to get started fast
- **Session resume** — "↩ Resume" button on welcome screen and `/resume` slash command to pick up where you left off

### 📋 Slash Commands

Type `/` to open the command palette:

| Command | Description |
|---------|-------------|
| `/gsd auto` | Start auto-execution mode |
| `/gsd next` | Execute the next task |
| `/gsd stop` | Stop auto-mode |
| `/gsd status` | Show progress dashboard |
| `/gsd queue` | Queue a milestone |
| `/gsd visualize` | Open workflow visualizer overlay |
| `/gsd capture` | Capture a thought during auto-mode |
| `/gsd steer` | Redirect auto-mode priorities |
| `/gsd knowledge` | View or add to project knowledge base |
| `/gsd config` | View or modify GSD configuration |
| `/compact` | Compact the context window |
| `/export` | Export the conversation |
| `/model` | Switch AI model |
| `/thinking` | Change thinking level |
| `/new` | Start a new conversation |
| `/resume` | Resume the last session |

All 16 GSD subcommands are individually listed with descriptions.

### 📂 Session History

- **Browse previous sessions** — searchable panel with session titles, dates, and message counts
- **Resume any session** — click to switch back to a previous conversation
- **Rename sessions** — give sessions meaningful names
- **Delete sessions** — remove old conversations you no longer need

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message (or steer while agent is working) |
| `Esc` | Stop the agent |
| `Ctrl+Shift+G` | Focus the GSD input from anywhere in VS Code |
| `Ctrl+Shift+N` | New conversation (when GSD is focused) |

> **Tip:** Enable `gsd.useCtrlEnterToSend` in settings if you want `Enter` for newlines and `Ctrl+Enter` to send.

### 🔒 Security

- **DOMPurify sanitization** on all rendered markdown
- **URL scheme allowlist** — only `http`, `https`, and `vscode` links are clickable
- **Path traversal protection** — file operations validated against workspace boundaries
- **Command injection prevention** — child process spawning uses args arrays, not shell interpolation
- **Environment isolation** — VS Code's Electron env vars are stripped before spawning GSD to prevent subprocess issues
- **No secrets in DOM** — API keys and tokens are never rendered in the webview

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gsd.processWrapper` | `""` | Custom executable path for the GSD process |
| `gsd.environmentVariables` | `[]` | Extra env vars to set when launching GSD |
| `gsd.useCtrlEnterToSend` | `false` | Use `Ctrl+Enter` to send instead of `Enter` |
| `gsd.preferredLocation` | `"panel"` | Default open location: `"sidebar"` or `"panel"` |
| `gsd.autoUpdate` | `true` | Check for new versions on GitHub Releases |
| `gsd.githubToken` | `""` | GitHub token for update checks (also reads `GH_TOKEN` / `GITHUB_TOKEN` env vars) |

---

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Rokket GSD: Open | — | Opens in preferred location |
| Rokket GSD: Open in New Tab | — | Opens as editor tab |
| Rokket GSD: Open in Side Bar | — | Opens in sidebar |
| Rokket GSD: New Conversation | `Ctrl+Shift+N` | Starts a fresh session |
| Rokket GSD: Focus Input | `Ctrl+Shift+G` | Focuses the input field |

---

## Architecture

```
┌─────────────────────┐    postMessage     ┌─────────────────────┐
│   Webview (Chat UI) │ ◄───────────────► │   Extension Host     │
│                     │                   │                      │
│  • Streaming render │                   │  • Dialog mapping    │
│  • Tool viz         │                   │  • File operations   │
│  • Model/thinking   │                   │  • Update checker    │
│  • Session history  │                   │  • Status bar        │
│  • Slash commands   │                   │  • Health monitoring  │
└─────────────────────┘                   └──────────┬───────────┘
                                                     │ stdin/stdout
                                                     │ JSON-RPC
                                          ┌──────────▼───────────┐
                                          │   gsd --mode rpc     │
                                          │   (Child Process)    │
                                          └──────────────────────┘
```

- **Webview** — vanilla DOM (no framework), ~12K lines of TypeScript, esbuild-bundled IIFE. Sequential segment-based renderer with `requestAnimationFrame` batching for smooth streaming.
- **Extension Host** — manages the GSD child process, routes messages, handles file operations, monitors health.
- **GSD Process** — the full `gsd-pi` agent running via JSON-RPC over stdin/stdout. Each session gets its own process.

The extension ships as a single ~140KB `.vsix` — no runtime dependencies beyond VS Code and the `gsd` CLI.

---

## Process Resilience

The extension is built to handle real-world agent sessions that run for hours:

- **Health monitoring** — periodic pings detect hung processes
- **Environment isolation** — strips Electron/VS Code env vars to prevent subprocess crashes
- **Graceful shutdown** — `session_shutdown` events produce clean end states
- **Force-kill & restart** — UI button to force-terminate and restart a stuck process
- **Duplicate spawn prevention** — mutex prevents concurrent processes for the same session
- **Dialog deduplication** — identical confirmation dialogs are fingerprinted and linked

---

## Development

```bash
git clone https://github.com/Kile-Thomson/Rokket-GSD.git
cd Rokket-GSD
npm install
npm run watch    # Rebuilds on file changes
# Press F5 in VS Code to launch Extension Development Host
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Production build (extension + webview) |
| `npm run watch` | Watch mode with auto-rebuild |
| `npm test` | Run unit tests (Vitest) |
| `npm run lint` | Run ESLint |
| `npm run package` | Package as `.vsix` |

### Project Structure

```
src/
  extension/
    index.ts                # Entry point, commands, status bar
    rpc-client.ts           # JSON-RPC client over stdin/stdout
    webview-provider.ts     # Webview lifecycle, message routing
    update-checker.ts       # Auto-update from GitHub Releases
    session-list-service.ts # Session history filesystem parser
    state-parser.ts         # GSD workflow state parsing
    dashboard-parser.ts     # Dashboard data aggregation
    metrics-parser.ts       # Cost/token metrics parsing
    captures-parser.ts      # Pending capture count parsing
    auto-progress.ts        # Auto-mode progress polling
  shared/
    types.ts                # Message protocol types (extension ↔ webview)
  webview/
    index.ts                # DOM setup, events, initialization
    renderer.ts             # Streaming segment renderer
    message-handler.ts      # Inbound message routing
    ui-updates.ts           # Header, footer, overlay updates
    helpers.ts              # Markdown, formatting, utilities
    slash-menu.ts           # Slash command palette
    model-picker.ts         # Model selection overlay
    thinking-picker.ts      # Thinking level dropdown
    ui-dialogs.ts           # Inline confirm/select/input dialogs
    auto-progress.ts        # Auto-mode progress bar widget
    visualizer.ts           # Workflow visualizer overlay
    session-history.ts      # Session browser panel
    tool-grouping.ts        # Read-only tool collapse logic
    dashboard.ts            # GSD dashboard overlay
    keyboard.ts             # Keyboard shortcut handling
    state.ts                # Shared mutable state
    styles.css              # Theme-aware styling (~1,800 lines)
resources/
  gsd-logo.svg              # Activity bar icon
  rokket-icon.png            # Extension icon
```

---

## Known Limitations

- **Requires `gsd-pi`** — this is a UI wrapper, not a standalone agent. The `gsd` CLI must be installed and configured separately.
- **GSD custom UI commands** (like `/gsd status` dashboard) require TUI widget support that VS Code's webview doesn't provide. These commands work but may produce text-only output.
- **Not on the VS Code Marketplace** — install via `.vsix` from [GitHub Releases](https://github.com/Kile-Thomson/Rokket-GSD/releases) or the install scripts above.

---

## License

MIT

---

<p align="center">
  <strong>▲ ROKKETEK</strong><br>
  <sub>Built by <a href="https://github.com/Kile-Thomson">Kile Thomson</a></sub>
</p>
