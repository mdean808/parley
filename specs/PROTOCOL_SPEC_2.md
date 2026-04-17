# Overview - Parley 2.0

This is a protocol for token-efficient and “reliable” agent to agent communication. Agents communicate directly with each other and the user using a reliable and validated protocol. Overall context and “job” specification is stored in a central store to ensure agents don’t pollute their contexts. In practice, system prompts define communication steps/rules and structure of the “application.” 

**At its heart, this is a protocol for agent-to-agent communication.** Agents are the principals — they address each other directly, own protocol semantics (ACK discipline, sequencing, CANCEL propagation), and drive the conversation. The central store is a shared facilitator: it validates message format, persists the transcript, and routes messages between agents, but it is not an orchestrator and does not act on agents' behalf.

## Responsibilities

The protocol divides work between two parties:

- **Store** — validates message schema, TOON format, chain integrity (state transitions, ownership, CANCEL/expiry), and delivery target resolution. The store persists messages, forwards them to subscribers, and assigns authoritative `id`, `timestamp`, and `sequence` (per-entity per-chain counter). It does NOT police every per-agent commitment — those are agent-side obligations.
- **Agents** — own protocol semantics: choosing when to ACK, which `to` field to mirror, propagating CANCEL to sub-chains they spawned, and periodically re-checking `ttl` during long PROCESS work. Agents SHOULD send an intended `sequence` but the store is authoritative. Agents communicate directly with other agents via the store as a bus; the store is not an orchestrator.

Violations of agent-side obligations are treated as prompt/implementation bugs of that agent, not store errors.

This version of the protocol expands on the following discrepancies in v0.0.1

- [x]  Sequential message chaining — include numerical ordering message chains to ensure conversation flow
- [x]  Claiming —  agents can claim ‘responses’. Claim resolution is implementation-defined
- [x]  Channels — akin to broadcast, messages can be sent to “groups” of agents/users at once.
- [x]  Headers — messages can now have headers so extensions to the protocol can be implemented for customized implementations
- [x]  Versioning — protocol messages should contain the protocol version to ensure compatibility
- [x]  Agent lifecycle — introduces agent status within the central store, active, idle, offline, (maybe implementation defined).
- [x]  Cancel — allow for aborting a message chain, reducing token usage and unnecessary communication

# Terminology

TOON: https://github.com/toon-format/toon

# Architecture

## Central Store

A store containing the state of the communication “room,” containing a list of users, agents, and messages. 

The store has the following operations available:

### Register User

Registers a user within the store.

- **Input**: name
- **Effect**: Creates a new user record
- **Returns**: User record

```yaml
id: randomly generated unique uuid
name: non-unique human-readable name
channels: list of channel names. populated by join channel operations
```

### Get User

Retrieves user information from the store.

- **Input**: user id(s)
- **Effect**: None
- **Returns**: List of users and their information

### Register Agent

Registers an agent within the store.

- **Input**: name, skills
- **Effect**: Creates a new agent record
- **Returns**: Agent record

```yaml
id: randomly generated unique uuid
name: non-unique human-readable name
skills: list of agent skills
channels: list of channel names to listen in. populated by join channel operations
status: implementation-defined status (idle, offline, working)
```

### Get Agent

Retrieves agent information from the store.

- **Input**: agent id(s)
- **Effect**: None
- **Returns**: List of agents and their information

### Query Agents

Searches for agents by skill.

- **Input**: skill(s)
- **Effect**: None
- **Returns**: List of agents matching the provided skills

> Skills should be direct string-matches, or possibly fuzzy search.
> 

### Store Message

Saves a message within the store.

- **Input**: message fields (see below)
- **Effect**: Persists the message
- **Returns**: Message record

See §Messages for the canonical message schema. Store Message accepts a TOON-encoded payload matching that schema.

**Validation:** Ensure that messages contain the above parameters and are sent in the correct TOON format. In the case that a message does not validate correctly, follow the steps listed in Error Handling.

**Target Resolution:** When a message is received for storage and delivery, the store resolves the `to` field in the following order.

1. **ID match**: Check each value against registered agent and user ids. If matched, deliver directly. ID match takes precedence over channel match — if a value somehow matches both (possible in non-UUID test fixtures), it is treated as an id.
2. **Channel match**: Check each value against registered channel names. If matched, resolve to all current channel members and deliver.
3. **Broadcast**: If the value is `*`, deliver to all registered agents/users.
4. **No match**: If a value matches none of the above, the message fails validation. Follow Error Handling.

### Get Message

Retrieves messages from the store.

- **Input**: any message property (id, chainId, from, to, type, etc.)
- **Effect**: None
- **Returns**: List of matching messages

> Supports flexible querying — e.g., get all user's messages, all messages in a chain, or all user messages in a chain.
> 

### Create Chain

Called by the store when a REQUEST with a new `chainId` is stored. 

```yaml
chainId: the uuid shared by all messages in the chain
owner: agent id that has claimed ownership via CLAIM resolution. undefined on non-exclusivity chains and on exclusivity chains prior to resolution
status: active, cancelled, expired
createdAt: UTC timestamp of chain creation (set when origin REQUEST is stored)
```

**Cancelling**: When the chain status is `cancelled`, the store must reject any new messages on the chain, except ACKs of the CANCEL itself.

### Get Chain

Retrieves a chain from the store

- **Input:** `chainId`
- **Effect:** None
- **Returns:** The matching chain record

### Update Chain

Updates chain status or owner after creation

- **Input:** `chainId`
- **Effect:** Update fields in the chain record
- **Returns:** The updated chain record

### **Create Channel**

Creates a new channel in the store.

```yaml
id: randomly generated unique uuid
name: unique human-readable channel name
members: list of agent/user ids
```

- **Input:** name, optional initial member list.
- **Effect**: Creates a new channel record.
- **Returns**: Channel record. Name MUST be unique — if a channel with the same name exists, return an error.

### **Get Channel**

Retrieve channel information from the store

- **Input**: Channel id or name.
- **Effect:** None
- **Returns**: Channel record.

### Join Channel

Adds an agent or user to a channel.

- **Input:** Channel id or name, agent/user id
- **Effect:** Adds the id the channel’s member list. The agent/user’s `channels` field is also updated
- **Returns**: None

### Leave Channel

Removes an agent or user from a channel

- **Input:** Channel id or name, agent/user id
- **Effect:** Removes the id from the channel’s member list and updates the agent/user’s `channels` field
- **Returns**: None

### List Channels

- **Input:** optional filter (e.g., channels a specific agent belongs to).
- **Effect**: None
- **Returns**: List of channel records.

## Agents

An agent contains tools/skills for specific tasks, with custom system prompts. 

Agents *always* receive and send messages in TOON format. If they try to send a message that is not in valid TOON, it MUST be rejected and they are required to try again.

Agents *must* have the following injected into it’s system prompt:

**(PROMPT.md)[./PROMPT.md]**

## Users

A user is a human, and usually sends requests via a broadcast to all agents.

Users can also “mention” specific agents to direct message. 

## Messages

A message is the fundamental unit of communication in the protocol. All messages are encoded in TOON format and validated by the store before delivery. 

```yaml
id: randomly generated unique uuid
version: protocol version (starting at 2 since v1 has no version)
chainId: randomly generated uuid grouping related messages
sequence: per-sender per-chain monotonic integer, assigned by the store (see §Sequencing)
replyTo: id of the message this is replying to. undefined for origin messages
timestamp: UTC timestamp in ISO 8601 format
type: one of REQUEST, ACK, PROCESS, RESPONSE, ERROR, CLAIM, CANCEL
payload: message content
headers: key-value pairs for protocol and implementation-defined metadata
from: id of the sending agent or user
to: list of recipient agent/user ids, channel name(s), or * for broadcast
```

### Reserved Sender: `"store"`

The literal string `"store"` is a reserved sender id used by the store itself for synthesized messages (e.g., CLAIM-rejection ERRORs — see §CLAIM). Agents and users MUST NOT use `"store"` as their `from`, and the store MUST NOT register an agent or user with this id. Messages whose `from` is `"store"` are treated as authoritative store-level communication and are exempt from a few normal agent-side rules (e.g., the ERROR's `to` is not mirrored from the original REQUEST).

### Sending (`to`)

The store will first attempt to match each value in `to` against agent/user IDs first, then channel names, and finally `*` for broadcast. If nothing matches, the store sends an ERROR to the requester.

### Chains

A chain is a group of messages sharing a `chainId`. A chain is started by an origin REQUEST and contains all subsequent ACK / PROCESS / RESPONSE / ERROR / CANCEL messages for that request. Sub-REQUESTs initiated from within PROCESS MUST use a **new** `chainId` — each delegation is its own independent chain. Chains form a tree via `replyTo`: a sub-REQUEST's `replyTo` points at the PROCESS message that spawned it, even though the two live in different chains. CANCEL does not cascade across chains automatically; agents that spawn sub-chains are responsible for propagating CANCEL (see §CANCEL).

`chainId` is just an identifier. Sequential ordering is determined by the `sequence` field, which is scoped per-agent within a chain (see §Sequencing for how the counter is managed).

### Multi-turn chains

A chain MAY contain multiple origin REQUESTs — REQUEST messages whose `replyTo` is `undefined`. Each origin REQUEST initiates its own independent ACK/PROCESS/RESPONSE lifecycle, but all messages share the chain's context (agent conversation history is preserved across turns). Whether to reuse a `chainId` across follow-ups or start a fresh chain per turn is **implementation-defined** — a chat UI might keep one chain per conversation session so agents remember prior exchanges, while an orchestrator might prefer one chain per high-level task.

Clarifications for chains with multiple origin REQUESTs:

- **TTL**: the `ttl` header on the **first** origin REQUEST governs chain expiry. Subsequent origins inherit; their own `ttl` headers are ignored for chain-level expiry purposes (the store MAY still reject a newly-arriving origin whose own `ttl` has already passed, since the agent that would handle it cannot start work).
- **CANCEL authorization**: anyone who has sent an origin REQUEST on the chain, plus the chain `owner` (if resolved on an exclusivity chain), MAY initiate CANCEL. Non-origin participants may not.
- **Follow-ups are REQUEST, not RESPONSE**: RESPONSE is terminal for the sender ("work completed"). Follow-up turns from a user or agent that wish to continue the conversation remain `type: REQUEST`. RESPONSE is never used to reopen discussion on a chain.

### Sequencing

Each message carries a `sequence` field — a per-sender per-chain monotonically increasing integer, starting at `0` for the sender's first message in the chain. The `sequence` field is **advisory on the wire**: agents SHOULD send an intended sequence (incremented by 1 for each message they send in a chain), but the store MAY overwrite the value with its own authoritative per-entity per-chain counter — analogous to how the store assigns `id` and `timestamp`. The stored value is authoritative. This lets implementations side-step coordination problems between automatically-generated messages (e.g., auto-ACKs) and LLM-composed messages that share a chain.

Counters are scoped per `(chainId, from)`: each sender has its own independent counter within a chain, and starting a new chain resets the counter to `0`.

### Threading

The `replyTo` field creates a parent-child relationship between messages. An origin REQUEST as `replyTo: undefined`. All following messages in the lifecycle set `replyTo` to the id of the REQUEST they are responding to.

When an agent in PROCESS sends a new REQUEST to another agent, the sub-REQUEST starts a new chain (new `chainId`, `sequence: 0`) and sets `replyTo` to the id of the PROCESS message that spawned it. This preserves the conversational tree across chains.

### Headers

Headers are key-value string pairs attached to messages. They carry protocol-defined metadata and implementation-specific extensions of the protocol.

**Reserved Headers**

- **`accept`**: `true` or `false`. Required on ACKs that reply to a REQUEST. `true` means the agent accepts the request and commits to responding. `false` means the agent declines — the payload must contain a concise reason (one sentence). ACKs that reply to a CANCEL do not require `accept` (they are bookkeeping, not work commitments).
- **`ttl`**: A UTC timestamp (ISO 8601) representing the expiry of the chain. Set on the initial REQUEST and inherited by all messages in the chain. Agents receiving a message where the current time exceeds `ttl` must not begin work and should send an ERROR with a timeout reason. Agents mid-PROCESS when TTL expires MUST stop work, send an ERROR, and propagate cancellation to any active sub-chains. When TTL expires, the behavior is equivalent to an implicit CANCEL. The store detects expiry, updates the chain status to `expired`, and agents mid-PROCESS follow the same propagation and cleanup rules as CANCEL. The distinction is that no explicit CANCEL message is sent — agents are expected to check TTL before beginning work and periodically during PROCESS. The detection mechanism is implementation-defined — the store MAY check `ttl` on every message access, run a background sweep, or combine both. The essential invariant is that (a) no new messages are accepted on a chain whose `ttl` has passed (except ACKs of any CANCEL that was in flight), and (b) the chain's `status` is set to `expired` no later than the next message that would have been accepted on the chain.
- **`exclusivity`**: `true` or `false`. When `true`, signals that exactly one agent should resolve the REQUEST — recipients MUST CLAIM ownership rather than independently proceeding. Applies to any REQUEST shape (broadcast, channel, or multi-recipient direct). See §CLAIM.

Implementations may define additional headers. Custom headers should use a namespaced key format (e.g., `x-myapp-retry-count`) to avoid collisions with future protocol keys.

### Versioning

The `version` field identifies which protocol version the message originated from. Recipients MUST check the version field before processing. If a message’s version is unsupported, the recipient must respond with ERROR, who’s payload describes the version mismatch. Implementations should not discard version-mismatched messages.

A message that omits the `version` field entirely MUST be treated as version-mismatched — specifically, as v1 or earlier, since v2 is the first version to define the field. Recipients (including the store, for schema validation) MUST respond with ERROR per the version-mismatch rules above rather than silently accept or guess the version.

## Channels

Channels are groupings of agents and users. They scope message delivery — if a message is sent to a channel it is delivered to all current members. 

```yaml
id: randomly generated unique uuid
name: unique human-readable channel name
members: list of agent/user ids
```

# Data Structures

All messages and agent-based communication is done via TOON format to preserve context. An example message is below. 

```yaml
id: asdcd-2dfv3-vvsa3-af3ba
version: 2
chainId: asdcd-2dfv3-vvsa3-af3ba
sequence: 0
replyTo: undefined
timestamp: 2012-04-23T18:25:43.511Z
type: REQUEST
payload: What time is it in Geneva?
headers[2]: HEADER_NAME:header content, HEADER_NAME2: header2 content 
from: asdcd-2dfv3-vvsa3-af3ba
to[2]: asdcd-2dfv3-vvsa3-kadk2,asdcd-2dfv3-vvsa3-af3ba
```

# **Agent Message States**

Messages within a chain follow a defined state lifecycle. Each state transition represents a valid protocol operation. Any message sent outside of these transitions is invalid and MUST be rejected.

| Current State | Valid Next States | Condition / Notes |
| --- | --- | --- |
| REQUEST | ACK (`accept: true`) | Agent accepts the request |
| REQUEST | ACK (`accept: false`) | Agent declines with reasoning. Not obligated to continue, but MAY re-ACK later with `accept: true` if circumstances change |
| REQUEST | ERROR | Agent rejects before ACK (version mismatch, expired TTL, validation failure) — TERMINAL |
| ACK (`accept: true`) | PROCESS | Agent begins work |
| ACK (`accept: true`) | CLAIM | REQUEST carries `exclusivity: true`; agent asserts ownership |
| ACK (`accept: true`) | ERROR | Agent encounters an error after accepting but before PROCESS — TERMINAL |
| CLAIM | PROCESS | Winning agent begins work after claim resolution |
| CLAIM | — | Losing agents receive a store-emitted ERROR (`replyTo` = their CLAIM id) announcing the resolved owner; no further messages on the chain — TERMINAL |
| PROCESS | RESPONSE | Agent completes work — TERMINAL |
| PROCESS | REQUEST | Agent delegates or gathers information; the new REQUEST starts a new chain (see §Chains) |
| PROCESS | ERROR | Agent encounters an error during work — TERMINAL |
| (any non-terminal) | CANCEL | Origin requester or chain owner aborts the chain |
| CANCEL | ACK | Recipient confirms cancellation; this ACK's `replyTo` is the CANCEL message id (not the origin REQUEST id) |

"TERMINAL" marks end states for a given agent on a given chain: no further messages from that agent on that chain are valid. A chain itself ends when all active participants have reached a terminal state, or when its status transitions to `cancelled` / `expired`.

## **Constraints**

- An agent MUST respond to every REQUEST with an ACK. Staying silent is not permitted.
- An agent MUST NOT send a RESPONSE without a preceding ACK (`accept: true`) and PROCESS in the same chain.
- An agent MUST NOT send PROCESS without first sending ACK (`accept: true`).
- A REQUEST initiated from within PROCESS (for delegation or information gathering) begins its own independent state lifecycle, tracked by its own `replyTo` reference.
- An agent that has sent ACK with `accept: true` MUST eventually send either a RESPONSE or an ERROR. It MUST NOT silently abandon work after accepting.
- An agent that has sent ACK with `accept: false` is not obligated to contribute further on the chain. However, `accept: false` is NOT terminal — if the conversation develops such that the agent's skills become relevant, the agent MAY re-ACK with `accept: true` on the same chain and proceed to PROCESS. PROCESS/RESPONSE still require a preceding ACK with `accept: true` from the same agent.
- A message MUST be sent in TOON format.
- An agent MUST NOT send CLAIM without a preceding ACK in the same chain.
- An agent MUST NOT send CLAIM on a REQUEST that does not carry the `exclusivity: true` header.
- On an exclusivity chain (one whose origin REQUEST carried `exclusivity: true`), once ownership has been resolved only the owning agent MAY send PROCESS or RESPONSE. On non-exclusivity chains, `owner` stays `undefined` and multiple agents MAY PROCESS and RESPONSE independently.
- At most one agent MAY own a chain at a time. Non-exclusivity chains have no owner.
- CANCEL MAY be initiated by the origin requester. On an exclusivity chain with a resolved owner, the owner MAY also initiate CANCEL. On non-exclusivity chains, only the origin requester MAY initiate CANCEL.
- After CANCEL, the only valid message on the chain is ACK of the CANCEL.
- CANCEL MUST propagate to all active sub-chains. An agent that has spawned sub-REQUESTs is responsible for propagating CANCEL to those sub-chains.
- An agent that receives a CANCEL for a chain on which it has not yet sent an ACK MAY silently ignore the CANCEL. This is the only exception to the "always ACK" rule — once an agent has ACKed a REQUEST it MUST ACK any subsequent CANCEL on that chain.

# **Protocol Operations**

## REQUEST

1. Sender composes a message of type `REQUEST` with `to` set to  for broadcast or specific agent/user id(s) for direct message.
2. Uses a new, unique `chainId`. `sequence` starts at `0`.
3. Message is stored via Store Message.
4. All recipients are notified of the incoming request according to the implementation.

### Parameters

- **`replyTo`**: `undefined` (origin message)
- **`to`**:  (broadcast) or specific agent/user id(s)

## ACK

1. Upon receiving a REQUEST, an agent MUST respond with an ACK. Agents MUST NOT stay silent.
2. The agent evaluates the request against its skills. If it matches, the agent sets the header `accept: true`. If it does not match, the agent sets `accept: false` and includes a brief reasoning in the payload (one sentence).
3. Increments `sequence` by `1`.
4. Agent sends a message of type `ACK`.
5. Message is stored via Store Message.

An ACK with `accept: true` commits the agent to eventually send RESPONSE or ERROR. An ACK with `accept: false` declines for now — the agent is not obligated to contribute further on this chain. ACK is a non-binding declaration of intent: if the conversation later develops such that the agent's skills become relevant, it MAY re-ACK with `accept: true` on the same chain and proceed with PROCESS/RESPONSE.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: if the original REQUEST is a broadcast, `*`. if a direct message, `from` + `to` of the REQUEST, excluding the sender. if a channel, `channel` from the REQUEST.
- **`headers`**: MUST include `accept: true` or `accept: false`
- **`payload`**: if `accept: false`, a concise reason for declining (one sentence). If `accept: true`, acknowledgement text.

> When multiple agents ACK with `accept: true` on a single broadcast REQUEST, resolution of which agent(s) proceed is implementation-defined. See Extensions for delegation and collaboration patterns.
> 

## CLAIM

1. Agent receives a REQUEST containing the reserved header `exclusivity: true`. `exclusivity` is valid on any REQUEST shape (broadcast, channel, or multi-recipient direct message) where more than one agent could otherwise resolve the request.
2. Agent sends ACK as usual.
3. Agent sends a message of type `CLAIM`. The payload should contain reasoning or capability justification for ownership, as well as increment `sequence` by `1`.
4. Message is stored via Store Message.
5. The store (or implementation layer) collects CLAIMs within a resolution window. Resolution strategy is implementation-defined (first-wins, best-fit, timeout-based, etc.).
6. Upon resolution, the store updates the chain entity's `owner` field to the winning agent's id.
7. Upon resolution the store notifies CLAIMants on the chain:
    - The winning agent proceeds to PROCESS. No explicit win-notification is required — an agent learns it won by virtue of being the `owner` on the chain (observable via `get_chain`) and by the absence of a rejection ERROR addressed to its CLAIM.
    - Each losing agent receives a store-emitted message of type ERROR with:
        - `from`: the reserved sender id `"store"` (see §Messages).
        - `to`: `[loser_id]` — a unicast targeting only the losing agent. This is an exception to the "mirror original REQUEST's `to`" rule that otherwise governs reply audience.
        - `replyTo`: that agent's CLAIM id.
        - `payload`: `"CLAIM rejected; owner is {winner_id}"`.
      
      Receipt of this ERROR is what drives the losing agent into its TERMINAL state. Losing agents MUST NOT send further messages on the chain after this ERROR (not even an ACK of the ERROR — ERROR is itself terminal, per the state table).

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: mirrors the original REQUEST's `to` field
- **`payload`**: SHOULD contain reasoning for the claim

## PROCESS

1. After sending an ACK, the agent begins work on the request.
2. Agent sends a message of type `PROCESS` containing a summary of the steps it will take.
3. Increments `sequence` by `1`.
4. Message is stored via Store Message.
5. If the agent requires additional information or delegation, it MAY send a new REQUEST to other agents or the original requester, initiating a new operation sequence.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: preserves the audience of the original REQUEST. If the
REQUEST was a broadcast (`*`), the reply is also a broadcast.
If the REQUEST targeted specific recipients, the reply is
sent to the original sender and all other recipients in the
REQUEST's to field

## RESPONSE

1. After completing its work, the agent sends a message of type `RESPONSE` containing the result.
2. Increments `sequence` by `1`.
3. Message is stored via Store Message.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: mirrors the original REQUEST's `to` field

## CANCEL

1. Sender composes a message of type CANCEL targeting a `chainId`.
2. `replyTo` is set to the original REQUEST that initiated the chain.
3. `sequence` increments as normal.
4. Payload should contain a reason for cancellation.
5. Message is stored via Store Message.
6. All agents with active work on the chain are notified.
7. Upon receiving CANCEL, an agent must:
    - Stop work on the chain immediately.
    - Send an ACK of the CANCEL (with `replyTo` set to the CANCEL message id).
    - If the agent has spawned sub-REQUESTs during PROCESS, it must propagate CANCEL to those sub-chains. Each sub-chain follows the same cancellation flow.
8. The store updates the chain entity's `status` to `cancelled`.

**Authorization.** The store validates the sender of a CANCEL against the chain's origin requester and `owner` (if set) per §Constraints. A CANCEL from any other sender is rejected at the store and an ERROR is returned to the sender.

### Parameters

- **`replyTo`**: the original REQUEST message id
- **`to`**: mirrors the original REQUEST's to field. Sub-chain participants are reached via propagation, not via this field
- **`chainId`**: the chain being cancelled
- **`payload`**: should contain cancellation reason

## ERROR

1. When encountering an error, the agent sends a message of type `ERROR` containing an error message.
2. Increments `sequence` by `1`.
3. Message is stored via Store Message.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: mirrors the original REQUEST's `from` field

# Error Handling

## Validation

Validation failures are surfaced to the sending agent as synchronous tool-call errors (the response to its `store_message` call), not as chain messages. This keeps failed-validation retry traffic off the chain transcript and ensures the agent sees the feedback on its very next turn.

If a message fails TOON validation, the implementation may inform the agent of the failure, and allow it to retry. If it has failed validation twice, only a single third attempt is allowed. If the third attempt fails as well, a Message is sent of type ERROR, with a payload containing the following: “Agent failed to validate message after 3 attempts.” 

If a message fails parameter validation, the implementation may inform the agent of failure, specifically highlighting the parameter and rule that was invalidated. The same retry logic applies here. 

## Agent Failures

In the event that an agent fails after ACK’ing due to network error or other issue, the error should be forwarded to the user in the form of a Message with type ERROR. The payload will contain the error message. The content and functionality following receipt of the ERROR message is the responsibility of the implementation.

## **Claim Resolution Failures**

If no agent CLAIMs within the resolution window, or all CLAIMs are rejected, the store SHOULD send an ERROR on the chain with a payload indicating that no agent claimed ownership. The chain status is updated to `cancelled`.

When resolution produces a winner, the store emits a per-loser rejection ERROR as described in §CLAIM step 7. The "no winner" case above is the degenerate variant where every CLAIMant receives a rejection and the chain itself is cancelled.

## **Cancellation Failures**

If an agent fails to ACK a CANCEL within a reasonable timeframe (implementation-defined), the store MAY force-update the chain status to `cancelled` and log the unresponsive agent. This prevents hung agents from blocking cancellation.
