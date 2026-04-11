
# Chat Persistence

## Context

The chat app currently stores all state in-memory: the server-side `sessions` Map and each protocol's internal conversation history are lost on page refresh or server restart. The goal is to save chats to disk so the user can return to previous conversations with full protocol context restored (Claude remembers prior messages).

The key constraint: **don't modify protocol code**. Instead, we extract/inject the protocol's internal conversation histories from the session layer using JS runtime access to TypeScript `private` fields.

## Approach

- **Server-side JSON files** in `apps/chat/data/chats/` (one file per chat)
- Each file stores: metadata (title, protocol, timestamps), display messages (`ChatMessage[]`), and serialized protocol conversation histories
- **Auto-save** after each message exchange
- **Sidebar** shows chat history list with new-chat/load/delete actions
- On load: create fresh protocol via factory, initialize it, then inject saved conversation histories back into the protocol's private fields

### Protocol State Strategy

**SimpleProtocol**: Save/restore `histories` Map directly (it's clean `[{role:"user",...},{role:"assistant",...}]` pairs). Access via `(protocol as any).histories`.

**V2**: Each `ProtocolAgentV2` has `chainHistory` containing tool_use/tool_result blocks with runtime UUIDs that won't exist in a restored session. Strategy: simplify the history to text-only user/assistant turns before saving. On restore, inject this simplified history so agents have conversation context without stale UUID references. Access via `(protocol as any).protocolAgents` -> `(agent as any).chainHistory`. The `agent.agent.name` property is public (`readonly`, not `private`).

**ClaudeCode**: Not restorable (external CLI). Display messages load but conversation starts fresh.

## Implementation Steps

### 1. Types (`apps/chat/src/lib/types.ts`)
Add interfaces: `SavedChat`, `ProtocolState`, `ChatListItem`, `SerializedMessageParam`

### 2. Persistence layer (`apps/chat/src/lib/server/persistence.ts`) — NEW
File I/O for chat JSON files:
- `DATA_DIR` resolved via `import.meta.url` -> `apps/chat/data/chats/`
- `saveChatToFile(chat)` — atomic write (temp file + rename)
- `loadChatFromFile(chatId)` — parse JSON, null on missing/corrupt
- `listChats()` — scan directory, return sorted by `updatedAt` desc
- `deleteChatFile(chatId)` — unlink

### 3. Protocol state utils (`apps/chat/src/lib/server/protocol-state.ts`) — NEW
- `extractProtocolState(session: Session): ProtocolState`
  - SimpleProtocol: deep-clone `(protocol as any).histories` Map -> Record
  - V2: iterate `(protocol as any).protocolAgents`, extract each agent's `chainHistory.get(session.chainId)`, simplify to text-only turns via `simplifyHistory()` helper
  - ClaudeCode: return empty histories
- `restoreProtocolState(session: Session, state: ProtocolState): void`
  - SimpleProtocol: `histories.set(agentName, savedHistory)` for each agent
  - V2: `(agent as any).chainHistory.set(session.chainId, savedHistory)` for each agent matched by name
  - ClaudeCode: no-op
- `simplifyHistory(history: MessageParam[]): SerializedMessageParam[]` — strips tool_use/tool_result blocks, keeps user text and assistant text turns

### 4. Session layer (`apps/chat/src/lib/server/sessions.ts`)
Add optional `overrideChainId` param to `createSession()` so loaded chats reuse their original chainId (critical for V2 chain continuity).

### 5. API routes — NEW
- `GET /api/chat/history` → `+server.ts` — returns `{ chats: ChatListItem[] }`
- `POST /api/chat/save` → `+server.ts` — body: `{ sessionId, messages, chatId? }` — extracts protocol state, saves to file, returns `{ chatId }`
- `POST /api/chat/load` → `+server.ts` — body: `{ chatId }` — loads file, creates session with restored protocol state, returns `{ sessionId, agents, protocolId, messages, chatId }`
- `DELETE /api/chat/history/[id]` → `+server.ts` — deletes chat file

### 6. Frontend API (`apps/chat/src/lib/api.ts`)
Add: `listChats()`, `saveChat(sessionId, messages, chatId?)`, `loadChat(chatId)`, `deleteChat(chatId)`

### 7. Page state (`apps/chat/src/routes/+page.svelte`)
- New state: `activeChatId`, `savedChats`
- `handleSaveChat()` — called after each successful send, auto-saves
- `handleLoadChat(chatId)` — loads chat, restores all state
- `handleNewChat()` — resets state, starts fresh session
- `handleDeleteChat(chatId)` — deletes and resets if active
- Load chat list in `onMount`
- Pass new props/callbacks to Sidebar

### 8. Sidebar UI (`apps/chat/src/lib/components/Sidebar.svelte`)
New layout (top to bottom):
1. Header "Agent Chat" + "New Chat" button
2. Chat history list (scrollable) — each item: title, protocol badge, timestamp; active chat highlighted; delete button on hover
3. Protocol selector (existing)
4. Agent list (existing)

Title auto-generated from first user message (truncated to ~50 chars).

### 9. Gitignore
Add `data/` to `apps/chat/.gitignore`

## Key Files

| File | Action |
|------|--------|
| `apps/chat/src/lib/types.ts` | modify — add persistence types |
| `apps/chat/src/lib/server/persistence.ts` | create — file I/O |
| `apps/chat/src/lib/server/protocol-state.ts` | create — extract/restore protocol state |
| `apps/chat/src/lib/server/sessions.ts` | modify — add chainId override param |
| `apps/chat/src/routes/api/chat/history/+server.ts` | create — GET list |
| `apps/chat/src/routes/api/chat/save/+server.ts` | create — POST save |
| `apps/chat/src/routes/api/chat/load/+server.ts` | create — POST load |
| `apps/chat/src/routes/api/chat/history/[id]/+server.ts` | create — DELETE |
| `apps/chat/src/lib/api.ts` | modify — add 4 API functions |
| `apps/chat/src/routes/+page.svelte` | modify — save/load state management |
| `apps/chat/src/lib/components/Sidebar.svelte` | modify — chat list UI |
| `apps/chat/.gitignore` | modify — add `data/` |

## Verification

1. Start the chat app (`bun --env-file=../../.env vite dev` from `apps/chat/`)
2. Send a few messages — verify `data/chats/` contains a JSON file with correct structure
3. Refresh the page — verify chat list appears in sidebar, click to load, verify messages display and protocol context is restored (send a follow-up message referencing earlier context)
4. Test "New Chat" — verify fresh session, old chat still in list
5. Test delete — verify file removed, chat disappears from sidebar
6. Test with both `simple` and `v2` protocols
