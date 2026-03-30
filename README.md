<p align="center">
  <img src="resources/rokket-icon.png" alt="Rokket GSD" width="128" />
</p>

<h1 align="center">Rokket GSD</h1>

<h3 align="center">The GSD-PI / GSD V2 VS Code Extension</h3>

<p align="center">
  Built on <a href="https://github.com/gsd-build/gsd-2">GSD-2</a> by <a href="https://github.com/glittercowboy">Glittercowboy</a> (Lex Christopherson), based on <a href="https://github.com/badlogic/pi-mono">Pi Mono</a> by <a href="https://github.com/badlogic">Mario Zechner</a> ❤️
</p>

<p align="center">
  A full-featured VS Code frontend for the <a href="https://github.com/gsd-build/gsd-2">GSD-2 (gsd-pi)</a> AI coding agent.<br>
  Streaming chat, real-time tool visualization, parallel worker monitoring,<br>
  model switching, session history, and full workflow automation.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.76-blue" alt="Version" />
  <img src="https://img.shields.io/badge/gsd--pi-v2.12--v2.58-blue" alt="gsd-pi compatibility" />
  <img src="https://img.shields.io/badge/VS%20Code-1.94%2B-blue" alt="VS Code" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform" />
</p>

---

## What Is This?

<img width="1670" height="1005" alt="RokketGSD" src="https://github.com/user-attachments/assets/e68aea08-cb2c-415f-ad2e-dbad08d39dbc"/>

Rokket GSD turns the `gsd-pi` CLI into a native VS Code experience. Streaming responses, 40+ tool visualizations, async subagent monitoring, parallel worker dashboards, model controls, four built-in themes, and deep workflow integration. Everything runs inside your editor.

The extension spawns GSD as a child process over JSON-RPC (`gsd --mode rpc`), giving the agent full access to your workspace, tools, and configured providers while you get a proper UI on top.

---

## ✨ Highlights

<table>
<tr>
<td width="50%">

🔄 **Auto-Updates**<br>
One-click install from GitHub Releases

📂 **Session History**<br>
Search, rename, resume right where you left off

⌨️ **35 Slash Commands**<br>
Full GSD workflow from a single `/` keystroke

🧠 **Model Picker**<br>
Grouped by provider with context size and reasoning tags

🎯 **Steer While Streaming**<br>
Redirect the agent mid-task without waiting

🎨 **Four UI Themes**<br>
Classic, Phosphor, Clarity, and Forge

</td>
<td width="50%">

💬 **Streaming Chat**<br>
Per-token text rendering with live DOM updates

🔧 **40+ Tool Visualizations**<br>
Category icons, key args, collapsible output — spinners animate continuously

📊 **Parallel Worker Dashboard**<br>
Per-worker state, budget bars, and stale detection

⚡ **Live Auto-Mode Progress**<br>
Task, phase, cost, elapsed time, and active model

💰 **Budget Alerts**<br>
Warning toast when workers cross 80% of ceiling

🛡️ **Process Resilience**<br>
Built for multi-hour sessions with crash recovery

⚡ **Async Subagent Parallelism**<br>
Spawn multiple agents in one call, monitor live progress

🧪 **865 Tests, 60%+ Coverage**<br>
CI coverage gate enforced on every push

</td>
</tr>
</table>

---

## ⚠️ Prerequisites

> [!IMPORTANT]
> **Rokket GSD is a frontend for the GSD agent. It does not include the agent itself.**

You need a working GSD environment before installing:

1. **[Node.js](https://nodejs.org/) 18+** with npm
2. **[Git](https://git-scm.com/)**
3. **[VS Code](https://code.visualstudio.com/) 1.94+**
4. **`gsd-pi` installed globally:**
   ```bash
   npm install -g gsd-pi
   ```
5. **A configured AI provider** in GSD (Anthropic, OpenAI, Google, etc. via API key or OAuth)

> [!TIP]
> Run `gsd` in a terminal first to verify it works before installing the extension. If `gsd` doesn't work in your terminal, the extension won't work either.

---

## 📦 Installation

### One-Liner (macOS / Linux / Git Bash)

```bash
curl -sL https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.sh | bash
```

### One-Liner (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.ps1 | iex
```

<details>
<summary><strong>Manual Install</strong></summary>

```bash
git clone https://github.com/Kile-Thomson/Rokket-GSD.git
cd Rokket-GSD
npm install
npm run build
npx vsce package --no-dependencies
code --install-extension rokket-gsd-*.vsix --force
```

Then reload VS Code (`Ctrl+Shift+P` > "Developer: Reload Window").

> [!TIP]
> If `code --install-extension` succeeds silently but the extension doesn't appear, install manually: VS Code > Extensions > `...` menu > "Install from VSIX..." > select the `.vsix` file.

</details>

---

## 🚀 Features

### 📂 Session History & Resume

- **Browse previous sessions** with searchable panel showing titles, dates, and message counts
- **Resume any session** with a single click, full context and conversation state injected on load
- **Resume from welcome screen** with the "↩ Resume" chip or `/resume` slash command
- **Rename sessions** with meaningful names for easy lookup later
- **Delete sessions** to clean up old conversations
- **Each session gets its own GSD process** with fully isolated state

### ⌨️ Slash Commands

Type `/` to open the command palette with 35 commands:

<details>
<summary><strong>GSD Workflow</strong> (25 commands)</summary>

| Command | What it does |
|---------|-------------|
| `/gsd` | Contextual wizard - picks the next action |
| `/gsd auto` | Start auto-execution mode |
| `/gsd next` | Execute the next task |
| `/gsd stop` | Stop auto-mode |
| `/gsd status` | Project dashboard with milestones, slices, tasks |
| `/gsd visualize` | Open workflow visualizer overlay |
| `/gsd capture` | Capture a thought during auto-mode |
| `/gsd steer` | Redirect auto-mode priorities |
| `/gsd discuss` | Discuss without executing |
| `/gsd quick` | Execute ad-hoc task with GSD guarantees |
| `/gsd queue` | Queue future milestones |
| `/gsd knowledge` | View or add to project knowledge base |
| `/gsd config` | View or modify GSD configuration |
| `/gsd prefs` | View or set preferences |
| `/gsd doctor` | Diagnose and fix issues |
| `/gsd forensics` | Post-mortem analysis of auto-mode failures |
| `/gsd mode` | Switch workflow mode (solo/team) |
| `/gsd help` | Categorized command reference |
| `/gsd migrate` | Migrate project artifacts |
| `/gsd remote` | Remote question channels (Slack, Discord, Telegram) |
| `/gsd do` | Natural language routing to the right command |
| `/gsd note` | Quick idea capture (append, list, promote) |
| `/gsd update` | Update GSD artifacts and status |
| `/gsd export` | Export milestone report (supports `--html --all`) |
| `/gsd rate` | Token usage rates and profile defaults |

</details>

<details>
<summary><strong>Built-in Actions</strong> (10 commands)</summary>

| Command | What it does |
|---------|-------------|
| `/compact` | Compact context to reduce token usage |
| `/export` | Export conversation as HTML |
| `/model` | Open model picker |
| `/thinking` | Cycle thinking level |
| `/new` | Start a new conversation |
| `/history` | Browse and switch sessions |
| `/copy` | Copy last assistant message |
| `/resume` | Resume last session |
| `/auto-compact` | Toggle auto-compaction on/off |
| `/auto-retry` | Toggle auto-retry on transient errors |

</details>

### 🧠 Model & Thinking Controls

- **Model picker** grouped by provider with section headers, context window size, and reasoning capability tags
- **Thinking level dropdown** with off / minimal / low / medium / high / xhigh and descriptions for each level
- **Model-aware thinking** hides levels your model doesn't support. Extended thinking only shows for models that handle it.
- **Context usage bar** below the header with color-coded thresholds (green at 0-70%, amber at 70-90%, red at 90%+)
- **Live session stats** showing token count, session cost, and context pressure at a glance
- **Dynamic model routing indicator** flashes the model badge and announces via toast when gsd-pi switches models mid-task

### 💬 Streaming Chat

- **Sequential segment rendering** - text, thinking blocks, and tool calls stream in arrival order with no re-renders or layout jumps
- **Full markdown** with syntax-highlighted code blocks, tables, blockquotes, headings, inline code, and images
- **Copy buttons** on every code block and full assistant responses
- **Image paste and drag-drop** directly into the input area
- **File attachments** via button, drag-and-drop, or paste with type-specific icons and removable chips
- **Message timestamps** with relative times that update live and absolute times on hover
- **Thinking blocks** collapsed by default with line count indicator, expanded during streaming
- **Steer while streaming** to redirect the agent mid-task without stopping it
- **Steer persistence** — messages sent during auto-mode are saved to `OVERRIDES.md` and apply to all future tasks, not just the current turn
- **Drag-to-resize input area** for longer messages
- **`!command` shortcut** to run bash commands directly without the agent

### 🔧 Tool Execution Visualization
<img width="1749" height="775" alt="subagents" src="https://github.com/user-attachments/assets/90e4d43d-18ca-4a87-b5e9-7cd90afd50ce" />

- **Live tool calls** with category-specific icons and color accents for 40+ tools
- **Rich key arg display** for lsp, browser_*, github_*, gsd_*, mcp_call, bash, and more
- **Collapsible output** with smart truncation for large results
- **Parallel tool indicator** with ⚡ badge and pulse animation when tools run concurrently
- **Tool call grouping** collapses consecutive read-only tools (file reads, searches, browser reads) into expandable summary rows
- **Subagent results** rendered as full markdown with usage pills showing token and cost breakdowns
- **Async subagent cards** — live-updating cards for background agents showing turns, usage, cost, and model. Cards transition from running (spinner) to done (green ✓) or error (red) as agents complete.
- **Clickable file paths** that open directly in VS Code
- **Shimmer animation** on running tools so you always know what's active
- **Duration tracking** on every completed tool call

### ⚡ Auto-Mode Progress

- **Live progress widget** sticky above the input showing current task, phase, progress bars, elapsed time, cost, and active model
- **Phase rendering** with distinct labels and icons: Executing, Planning, Validating (✓), Completing, Blocked, Replanning
- **Discussion-pause visibility** shows 💬 "Awaiting Discussion" with a `/gsd discuss` hint when auto-mode pauses for slice discussion
- **Pending captures badge** (📌) in the progress widget for `/gsd capture` thoughts awaiting triage
- **Workflow state badge** in the header showing active milestone, slice, task, and current phase
- **Auto-mode indicator** with ⚡ Auto, ▸ Next, ⏸ Paused states
- **Health widget** — ambient system health bar in the footer showing system status, budget, provider issues, and environment errors
- **Model health indicator** — green/amber/red dot next to the model name reflecting current system health

### 📊 Parallel Worker Dashboard

- **Worker cards** during parallel auto-mode showing per-worker milestone ID, state badge, current unit, and cost
- **State badges** for Running, Paused, Stopped, and Error with distinct colors
- **Budget usage bars** per worker with green/orange/red thresholds at 80% and 100%
- **Budget alert toast** fires a VS Code warning when any worker crosses 80% of `budget_ceiling`
- **Stale worker detection** dims workers with old heartbeats and shows a "(stale)" label
- **Graceful degradation** to standard single-worker display when no parallel data exists

### 📈 Workflow Visualizer

- **Full-page overlay** via `/gsd visualize` with three tabs
- **Progress tab** with milestone header, progress bars, slice/task breakdown, milestone registry, blockers, and next action
- **Metrics tab** with cost breakdown, tool call counts, model usage, token breakdown, and context usage
- **Health tab** with system health status, budget info, environment warnings, and active model
- **Auto-refresh** every 5 seconds during active auto-mode
- **Dashboard panel** with milestone registry, slice/task progress, cost projections, and activity log

### 🤖 Agent Interaction

- **Inline UI dialogs** for confirm, select, input, and editor prompts rendered directly in the chat flow (no modal popups)
- **Multi-select support** with checkbox-style selection and confirm button
- **Auto-compaction indicator** overlay banner when context is being compacted
- **Auto-retry indicator** with countdown timer and abort button when the provider rate-limits
- **Provider fallback alerts** via toast when GSD auto-switches models due to rate limits, and again when the original provider recovers
- **Crash recovery** with restart button and full state cleanup

### 🎨 VS Code Integration

- **Activity bar icon** (rocket) with sidebar panel
- **Flexible layout** - open as sidebar or editor tab
- **Status bar** showing streaming state, active model, and session cost
- **Working indicator** with pulsing amber glow on the rocket logo while the agent is active
- **Theme-aware** - works with any VS Code color theme (light, dark, high contrast)
- **Four built-in themes**: Classic, Phosphor, Clarity, and Forge
- **Auto-updates** from GitHub Releases with one-click install notification
- **HTML export** from the command palette ("Rokket GSD: Export Milestone Report")
- **What's New overlay** on version upgrade with changelog viewer
- **Welcome screen quick actions** with clickable chips for Auto, Status, and Review
- **Scroll-to-bottom FAB** when scrolled up
- **Toast notifications** for action feedback

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message (or steer while agent is working) |
| `Esc` | Stop the agent |
| `Ctrl+Shift+G` | Focus the GSD input from anywhere in VS Code |
| `Ctrl+Shift+N` | New conversation (when GSD is focused) |

> [!TIP]
> Enable `gsd.useCtrlEnterToSend` in settings if you want `Enter` for newlines and `Ctrl+Enter` to send.

### 🔒 Security

- **DOMPurify sanitization** on all rendered markdown
- **URL scheme allowlist** restricting clickable links to http, https, and vscode
- **Path traversal protection** with workspace boundary validation and symlink resolution
- **Command injection prevention** using args arrays instead of shell interpolation
- **Environment isolation** stripping Electron/VS Code env vars before spawning GSD
- **Download validation** restricting update installs to GitHub URLs only
- **No secrets in DOM** - API keys and tokens are never rendered in the webview

---

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gsd.theme` | `"forge"` | UI theme: `classic`, `phosphor`, `clarity`, or `forge` |
| `gsd.processWrapper` | `""` | Custom executable path for the GSD process |
| `gsd.environmentVariables` | `[]` | Extra env vars to set when launching GSD |
| `gsd.useCtrlEnterToSend` | `false` | Use `Ctrl+Enter` to send instead of `Enter` |
| `gsd.preferredLocation` | `"panel"` | Default open location: `"sidebar"` or `"panel"` |
| `gsd.autoUpdate` | `true` | Check for new versions on GitHub Releases |
| `gsd.githubToken` | `""` | GitHub token for update checks (also reads `GH_TOKEN` / `GITHUB_TOKEN` env vars) |

---

## 🛡️ Process Resilience

Built to handle real-world agent sessions that run for hours:

- **Health monitoring** with periodic pings to detect hung processes
- **Environment isolation** stripping Electron/VS Code env vars to prevent subprocess crashes
- **Graceful shutdown** handling `session_shutdown` events cleanly
- **Force-kill and restart** via UI button for stuck processes
- **Duplicate spawn prevention** via mutex per session
- **Dialog deduplication** fingerprinting identical confirmation requests
- **Buffer overflow protection** with full reset (not truncation) to preserve JSON-RPC protocol integrity

---

## 🏗️ Architecture

```
┌─────────────────────┐    postMessage     ┌─────────────────────┐
│   Webview (Chat UI) │ <───────────────> │   Extension Host     │
│                     │                   │                      │
│  Streaming render   │                   │  Dialog mapping      │
│  Tool visualization │                   │  File operations     │
│  Model/thinking     │                   │  Update checker      │
│  Session history    │                   │  Status bar          │
│  Slash commands     │                   │  Health monitoring   │
│  Worker dashboard   │                   │  Parallel polling    │
└─────────────────────┘                   └──────────┬───────────┘
                                                     │ stdin/stdout
                                                     │ JSON-RPC
                                          ┌──────────▼───────────┐
                                          │   gsd --mode rpc     │
                                          │   (Child Process)    │
                                          └──────────────────────┘
```

- **Webview** - vanilla DOM (no framework), ~9K lines of TypeScript, esbuild-bundled IIFE. Sequential segment-based renderer with `requestAnimationFrame` batching for smooth streaming.
- **Extension Host** - ~12K lines of TypeScript managing the GSD child process, routes messages, handles file operations, monitors health, polls parallel worker status.
- **GSD Process** - the full `gsd-pi` agent running via JSON-RPC over stdin/stdout. Each session gets its own process.

The extension ships as a ~151KB `.vsix` with no runtime dependencies beyond VS Code and the `gsd` CLI.

---

<details>
<summary><strong>🔨 Development</strong></summary>

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
| `npm test` | Run unit tests (Vitest, 865 tests across 44 files) |
| `npm run lint` | Run ESLint |
| `npm run package` | Package as `.vsix` |

### Project Structure

```
src/
  extension/
    index.ts                # Entry point, commands, status bar
    rpc-client.ts           # JSON-RPC client over stdin/stdout
    webview-provider.ts     # Webview lifecycle, message routing
    auto-progress.ts        # Auto-mode progress polling
    parallel-status.ts      # Parallel worker status reader
    dashboard-parser.ts     # Dashboard data aggregation
    metrics-parser.ts       # Cost/token metrics parsing
    captures-parser.ts      # Pending capture count parsing
    state-parser.ts         # GSD workflow state parsing
    update-checker.ts       # Auto-update from GitHub Releases
    session-list-service.ts # Session history filesystem parser
    session-state.ts        # Per-session state management
  shared/
    types.ts                # Message protocol types (extension <> webview)
  webview/
    index.ts                # DOM setup, events, initialization
    renderer.ts             # Streaming segment renderer
    message-handler.ts      # Inbound message routing
    auto-progress.ts        # Auto-mode progress bar + worker cards
    visualizer.ts           # Workflow visualizer overlay
    dashboard.ts            # GSD dashboard overlay
    model-picker.ts         # Model selection overlay
    thinking-picker.ts      # Thinking level dropdown
    slash-menu.ts           # Slash command palette (35 commands)
    ui-dialogs.ts           # Inline confirm/select/input dialogs
    tool-grouping.ts        # Read-only tool collapse logic
    session-history.ts      # Session browser panel
    helpers.ts              # Markdown, formatting, tool display
    ui-updates.ts           # Header, footer, overlay updates
    keyboard.ts             # Keyboard shortcut handling
    state.ts                # Shared mutable state
    styles.css              # Theme-aware styling (~2,000 lines)
resources/
  gsd-logo.svg              # Activity bar icon
  rokket-icon.png            # Extension icon
```

</details>

---

## Known Limitations

- **Requires `gsd-pi`** - this is a UI wrapper, not a standalone agent. The `gsd` CLI must be installed and configured separately.
- **Not on the VS Code Marketplace** - install via `.vsix` from [GitHub Releases](https://github.com/Kile-Thomson/Rokket-GSD/releases) or the install scripts above.
- **Some GSD custom UI commands** still rely on TUI widgets that VS Code webviews cannot render directly. `/gsd status` (and `/gsd auto` when requesting status) is supported via Rokket GSD's structured dashboard renderer; other widget-dependent commands produce text-only output.

---

## License

MIT

---

<p align="center">
  <strong>▲ ROKKETEK</strong><br>
  <sub>Built by <a href="https://github.com/Kile-Thomson">Kile Thomson</a></sub>
</p>
