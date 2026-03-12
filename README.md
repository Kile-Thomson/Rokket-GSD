# 🚀 Rokket GSD

A VS Code extension that wraps the [GSD (gsd-pi)](https://github.com/badlogic/pi-mono) AI coding agent into a native chat panel — full tool visualization, model switching, and workflow automation built in.

**Built by [Kile Thomson](https://github.com/Kile-Thomson) under the Rokketek brand.**

---

## Quick Install

### Prerequisites

- [VS Code](https://code.visualstudio.com/) 1.94+
- [Node.js](https://nodejs.org/) 18+ with npm
- [Git](https://git-scm.com/)
- `gsd` CLI installed globally: `npm install -g gsd-pi`
- A valid API key configured in GSD (e.g. Anthropic, OpenAI)

### One-liner (macOS / Linux / Git Bash)

```bash
curl -sL https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.sh | bash
```

Or manually:

```bash
git clone https://github.com/Kile-Thomson/Rokket-GSD.git /tmp/rokket-gsd && cd /tmp/rokket-gsd && npm install && npm run build && npx vsce package --no-dependencies && code --install-extension *.vsix --force && cd - && rm -rf /tmp/rokket-gsd
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Kile-Thomson/Rokket-GSD/main/install.ps1 | iex
```

Or manually:

```powershell
git clone https://github.com/Kile-Thomson/Rokket-GSD.git $env:TEMP\rokket-gsd; cd $env:TEMP\rokket-gsd; npm install; npm run build; npx vsce package --no-dependencies; code --install-extension (Get-ChildItem *.vsix).FullName --force; cd $env:USERPROFILE; Remove-Item -Recurse -Force $env:TEMP\rokket-gsd
```

### Step by step

```bash
# 1. Clone the repo
git clone https://github.com/Kile-Thomson/Rokket-GSD.git
cd Rokket-GSD

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build

# 4. Package as VSIX
npx vsce package --no-dependencies

# 5. Install into VS Code
code --install-extension rokket-gsd-0.2.1.vsix --force

# 6. Reload VS Code (Ctrl+Shift+P → "Developer: Reload Window")
```

> **Note:** If `code --install-extension` appears to succeed silently but the extension doesn't appear, manually extract the VSIX:
> ```bash
> # Find your VS Code extensions directory
> # Windows: %USERPROFILE%\.vscode\extensions\
> # macOS:   ~/.vscode/extensions/
> # Linux:   ~/.vscode/extensions/
>
> mkdir -p ~/.vscode/extensions/rokketek.rokket-gsd-0.2.1
> cd ~/.vscode/extensions/rokketek.rokket-gsd-0.2.1
> unzip /path/to/rokket-gsd-0.2.1.vsix
> cp -r extension/* . && rm -rf extension extension.vsixmanifest "[Content_Types].xml"
> ```

---

## Features

### Chat UI
- Sequential streaming — text, thinking, and tool calls render in the order they arrive with no re-renders
- Streaming markdown responses with syntax-highlighted code blocks
- Tables, blockquotes, headings — all rendered properly
- Copy button on every code block
- Image paste/drop into the input area

### Tool Execution
- Live tool call visualization with category icons and color accents
- Collapsible tool output with smart truncation
- Subagent results rendered as full markdown (tables, code blocks, headings)
- File paths in output are clickable — opens them in VS Code

### Agent Interaction
- **Steer while streaming** — send a message while the agent is working to redirect it
- **Inline UI dialogs** — confirm/select/input prompts rendered directly in the chat flow
- **Auto-compaction & retry indicators** — overlay banners when context compaction or retry is in progress
- **Crash recovery** — restart button if the GSD process crashes

### Model & Thinking
- **Model picker** — switch AI models grouped by provider, showing context window and capabilities
- **Thinking level** — cycle through off/minimal/low/medium/high/xhigh with one click
- Live token count, cost tracking, and context usage bar in the header

### Slash Commands
- Type `/` to see all available commands
- `/gsd next`, `/gsd auto`, `/gsd status`, `/gsd queue` — all GSD subcommands individually listed
- `/compact`, `/export`, `/model`, `/thinking`, `/new` — built-in actions
- Arrow keys to navigate, Enter to select

### Shortcuts
- `!command` — run a bash command directly without going through the agent
- `Enter` to send (or steer while agent is working)
- `Esc` to stop the agent
- `Ctrl+Shift+G` — focus the input from anywhere in VS Code

### VS Code Integration
- Activity bar icon (rocket) with sidebar panel
- Open as a sidebar or full editor tab
- Status bar showing streaming state, model name, and session cost
- Inline chat dialogs for agent questions and confirmations
- Theme-aware — works with any VS Code color theme

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gsd.processWrapper` | `""` | Custom executable path for the GSD process |
| `gsd.environmentVariables` | `[]` | Env vars to set when launching GSD |
| `gsd.useCtrlEnterToSend` | `false` | Use Ctrl+Enter to send (Enter for newlines) |
| `gsd.preferredLocation` | `"panel"` | Default open location: `"sidebar"` or `"panel"` |

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Rokket GSD: Open | — | Opens in preferred location |
| Rokket GSD: Open in New Tab | — | Opens as editor tab |
| Rokket GSD: Open in Side Bar | — | Opens in sidebar |
| Rokket GSD: New Conversation | `Ctrl+Shift+N` | Starts fresh session |
| Rokket GSD: Focus Input | `Ctrl+Shift+G` | Focuses the input field |

---

## Architecture

```
┌─────────────────────┐    postMessage     ┌─────────────────────┐
│   Webview (Chat UI) │ ◄───────────────► │   Extension Host     │
│   Markdown render   │                   │   Dialog mapping     │
│   Tool visualization│                   │   File operations    │
│   Model/thinking UI │                   │   Status bar         │
└─────────────────────┘                   └──────────┬───────────┘
                                                     │ stdin/stdout
                                                     │ JSON-RPC
                                          ┌──────────▼───────────┐
                                          │   gsd --mode rpc     │
                                          │   (Child Process)    │
                                          └──────────────────────┘
```

The extension spawns `gsd --mode rpc` as a child process and communicates via JSON lines over stdin/stdout. The webview renders the chat UI and sends messages to the extension host, which forwards them to GSD and relays events back.

The webview uses a sequential segment-based rendering model — text, thinking, and tool calls are appended as ordered segments within each assistant turn. DOM updates are batched via `requestAnimationFrame` for smooth streaming without layout thrashing.

---

## Development

```bash
git clone https://github.com/Kile-Thomson/Rokket-GSD.git
cd Rokket-GSD
npm install
npm run watch    # Watch mode — rebuilds on file changes
# Press F5 in VS Code to launch Extension Development Host
```

### Project Structure

```
src/
  extension/
    index.ts              # Extension entry point, commands, status bar
    rpc-client.ts         # JSON-RPC client wrapping gsd child process
    webview-provider.ts   # Webview lifecycle, message routing, HTML generation
  shared/
    types.ts              # Shared types between extension and webview
  webview/
    index.ts              # Chat UI logic, rendering, slash menu, model picker
    styles.css            # All styling (VS Code theme-aware)
resources/
  gsd-logo.svg            # Activity bar icon (rocket)
  rokket-icon.png         # Marketplace icon
```

---

## License

MIT

---

<p align="center">
  <strong>▲ ROKKETEK</strong><br>
  <sub>Built by Kile Thomson</sub>
</p>
