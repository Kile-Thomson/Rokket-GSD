# S01: Session List & Switch — UAT

## Test Scenarios

### 1. History button visible
- [ ] Open the GSD sidebar panel
- [ ] Verify a "History" button with clock icon appears in the header toolbar (between Export and Model)

### 2. Session list loads
- [ ] Click the History button
- [ ] Verify the session history overlay appears
- [ ] Verify it shows previous sessions with preview text, relative timestamp, and message count
- [ ] If this is the current session, verify it's highlighted with a blue dot

### 3. Switch to a previous session
- [ ] Click a session that is NOT the current one
- [ ] Verify the chat area clears and loads the selected session's conversation
- [ ] Verify user messages and assistant responses render correctly (markdown, code blocks)
- [ ] Verify the history panel closes after switching
- [ ] Send a new message to verify the session is fully active

### 4. Empty state
- [ ] Open a workspace with no previous GSD sessions
- [ ] Click History
- [ ] Verify it shows "No previous sessions" with a chat bubble icon

### 5. Escape closes panel
- [ ] Open the History panel
- [ ] Press Escape
- [ ] Verify the panel closes

### 6. Click-outside closes panel
- [ ] Open the History panel
- [ ] Click anywhere outside the panel (e.g., the chat area)
- [ ] Verify the panel closes

### 7. Current session highlighted
- [ ] Start a new conversation
- [ ] Click History
- [ ] Verify the just-created session appears and is highlighted as current

### 8. New conversation after switch
- [ ] Switch to a previous session via History
- [ ] Click the "New" button to start a new conversation
- [ ] Verify the chat clears and a fresh session begins
