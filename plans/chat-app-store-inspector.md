# Store Inspector for Chat UI

## Context

The chat web UI currently has no way to inspect the internal state of the protocol's central store. For the v2 protocol, a `StoreV2` instance holds users, agents, messages, chains, and channels — all invisible to the user. This feature adds a button (only visible when the active protocol has a store) that opens a slide-out drawer showing all store contents, enabling real-time inspection of protocol internals.

The simple and claude-code protocols have no store, so the button won't appear for them.

## Plan

### 1. Add `snapshot()` to `StoreV2`

**`src/protocols/default_v2/types.ts`** — Add `StoreSnapshot` interface:
```ts
export interface StoreSnapshot {
    users: UserV2[];
    agents: AgentV2[];
    messages: MessageV2[];
    chains: Record<string, Chain>;
    channels: Record<string, Channel>;
}
```

**`src/protocols/default_v2/store.ts`** — Add method to `StoreV2` class:
```ts
snapshot(): StoreSnapshot {
    return {
        users: [...this.users],
        agents: [...this.agents],
        messages: [...this.messages],
        chains: Object.fromEntries(this.chains),
        channels: Object.fromEntries(this.channels),
    };
}
```

### 2. Expose store snapshot on `DefaultProtocolV2`

**`src/protocols/default_v2/protocol.ts`** — Add public method:
```ts
getStoreSnapshot(): StoreSnapshot {
    return this.store.snapshot();
}
```

**`src/protocols/default_v2/index.ts`** — Re-export the type:
```ts
export type { StoreSnapshot } from "./types.ts";
```

Do NOT modify the `Protocol` interface — use duck-typing on the server side.

### 3. Add `hasStore` to protocol registration

**`src/factory.ts`** — Add optional field to `ProtocolRegistration`:
```ts
hasStore?: boolean;
```

Set `hasStore: true` on the `v2` registration only.

### 4. Signal store support from API

**`apps/chat/src/routes/api/chat/init/+server.ts`** — Include `hasStore` in init response:
```ts
const reg = getProtocolRegistration(protocolId);
// add to json response: hasStore: reg?.hasStore ?? false
```

### 5. New store API endpoint

**`apps/chat/src/routes/api/chat/store/+server.ts`** (new file) — `GET` endpoint:
- Takes `?sessionId=` query param
- Looks up session, duck-type checks `protocol.getStoreSnapshot`
- Returns `{ snapshot }` JSON
- Returns 400 if protocol has no store

### 6. Client-side types and API

**`apps/chat/src/lib/types.ts`** — Add client-side mirror types: `StoreSnapshot`, `StoreUser`, `StoreAgent`, `StoreMessage`, `StoreChain`, `StoreChannel`.

**`apps/chat/src/lib/api.ts`** — Add `fetchStoreSnapshot(sessionId)` function. Update `initSession` return type to include `hasStore: boolean`.

### 7. StoreInspector component

**`apps/chat/src/lib/components/StoreInspector.svelte`** (new file)

- Slide-out drawer from the right, ~400px wide, dark zinc theme
- Props: `open: boolean`, `sessionId: string`, `onClose: () => void`
- Fetches snapshot when opened, has a refresh button
- Five tabs: **Messages** (default), **Agents**, **Users**, **Chains**, **Channels**
- Resolve agent/user IDs to names in message display using a local lookup map
- Color-coded message type badges (REQUEST=indigo, ACK=green, RESPONSE=blue, ERROR=red, etc.)
- Agent status indicators (idle=zinc, working=yellow, offline=red)
- Truncated UUIDs (first 8 chars)
- Backdrop click or X button to close

### 8. Wire up in `+page.svelte`

**`apps/chat/src/routes/+page.svelte`**:
- Add state: `hasStore`, `storeInspectorOpen`
- Capture `hasStore` from `initSession` response
- Reset on protocol change
- Conditionally render a "Store Inspector" button in a header bar above the chat area (only when `hasStore` is true)
- Render `<StoreInspector>` component

## Files to modify
- `src/protocols/default_v2/types.ts`
- `src/protocols/default_v2/store.ts`
- `src/protocols/default_v2/protocol.ts`
- `src/protocols/default_v2/index.ts`
- `src/factory.ts`
- `apps/chat/src/routes/api/chat/init/+server.ts`
- `apps/chat/src/routes/api/chat/store/+server.ts` (new)
- `apps/chat/src/lib/types.ts`
- `apps/chat/src/lib/api.ts`
- `apps/chat/src/lib/components/StoreInspector.svelte` (new)
- `apps/chat/src/routes/+page.svelte`

## Verification
1. Start the chat app with `bun run dev` from `apps/chat`
2. Select the "simple" protocol — no store button should appear
3. Switch to "v2" protocol — "Store Inspector" button appears in the header
4. Click the button — drawer slides open, shows loading, then store data across tabs
5. Send a message, then click refresh in the inspector — new messages appear
6. Click backdrop or X — drawer closes
