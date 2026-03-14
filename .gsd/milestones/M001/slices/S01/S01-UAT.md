# S01: Webview Module Split — UAT

**Non-blocking.** Run these checks at your convenience. Report failures and they'll be addressed in a future slice.

## Prerequisites
- Build the extension: `npm run build`
- Launch Extension Development Host (F5 in VS Code)

## Test Script

### 1. Basic Load
- [ ] Extension activates — rocket icon visible in activity bar
- [ ] Click rocket icon — sidebar opens with welcome screen
- [ ] Welcome screen shows ASCII art, version, model info, keyboard hints

### 2. Send a Prompt
- [ ] Type a message and press Enter — user bubble appears
- [ ] Streaming text renders incrementally (no flicker)
- [ ] Thinking block appears as collapsible `<details>` (if model supports thinking)
- [ ] Tool calls appear with category icons, spinner while running, ✓/✗ when done
- [ ] Tool call output is collapsible (click header to expand/collapse)
- [ ] Code blocks have syntax highlighting and a Copy button
- [ ] File paths in backticks are clickable — opens file in editor

### 3. Slash Commands
- [ ] Type `/` — slash menu appears with commands
- [ ] Arrow keys navigate the menu
- [ ] Enter selects a command
- [ ] Escape closes the menu
- [ ] Type `/gsd ` — filters to GSD subcommands
- [ ] Select `/compact` — triggers context compaction
- [ ] Select `/model` — opens model picker
- [ ] Select `/new` — resets conversation, shows welcome screen

### 4. Model Picker
- [ ] Click Model button in header — picker overlay opens
- [ ] Models grouped by provider
- [ ] Current model marked with ● dot
- [ ] Click a different model — picker closes, header badge updates
- [ ] Click outside picker — closes it

### 5. Inline UI Dialogs
- [ ] Trigger an agent action that asks a question (e.g. ask it to confirm something)
- [ ] Dialog renders inline in chat with buttons
- [ ] Clicking a button resolves the dialog (shows ✓/✗/⊘ summary)

### 6. Steer While Streaming
- [ ] While agent is streaming, type a message and press Enter
- [ ] Steer message appears as user bubble, agent acknowledges the redirect

### 7. Header & Footer
- [ ] Model badge shows current model name
- [ ] Thinking badge shows thinking level — click cycles it
- [ ] Cost badge shows session cost after usage
- [ ] Context badge shows usage percentage
- [ ] Footer shows working directory, token stats, model info
