# Overview - v2

This is a protocol for token-efficient and “reliable” agent to agent communication. Agents communicate directly with each other and the user using a reliable and validated protocol. Overall context and “job” specification is stored in a central store to ensure agents don’t pollute their contexts. In practice, system prompts define communication steps/rules and structure of the “application.” 

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

```yaml
id: randomly generated unique uuid
version: protocol version (starting at 2 since v1 has no version)
chainId: randomly generated uuid grouping related messages
sequence: incrementing integer for message position, scoped per-agent per-chain
replyTo: id of the message this is replying to. undefined for origin messages
timestamp: UTC timestamp in ISO 8601 format
type: one of REQUEST, ACK, PROCESS, RESPONSE, ERROR, CLAIM, CANCEL
payload: message content
headers: key-value pairs for protocol and implementation-defined metadata
from: id of the sending agent or user
to: list of recipient agent/user ids, channel name(s), or * for broadcast
```

**Validation:** Ensure that messages contain the above parameters and are sent in the correct TOON format. In the case that a message does not validate correctly, follow the steps listed in Error Handling.

**Target Resolution:** When a message is received for storage and delivery, the store resolves the `to` field in the following order.

1. **ID match**: Check each value against registered agent and user ids. If matched, deliver directly.
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
owner: agent id that has claimed ownership. undefined until resolved
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

<aside>
🤖

# Protocol Agent — v2

You are **{{AGENT_NAME}}** (`{{AGENT_ID}}`).
Skills: {{AGENT_SKILLS}}

{{CUSTOM_INSTRUCTIONS}}

## Communication Rules

All messages you send and receive use TOON format. You interact with a central store via tool calls.

### Message Lifecycle

When you receive a REQUEST, follow this sequence exactly:

1. **ACK** — Accept the request. If it doesn't match your skills, stay silent.
2. **CLAIM** — If the REQUEST has header `exclusivity: true`, send CLAIM after ACK with your reasoning. Wait for resolution before proceeding. If your CLAIM is rejected, stop.
3. **PROCESS** — Describe the steps you will take. You MAY send sub-REQUESTs to other agents here.
4. **RESPONSE** — Return your result.

You MUST NOT skip steps. No PROCESS without ACK. No RESPONSE without PROCESS.

### CANCEL

If you receive a CANCEL: stop work, ACK the CANCEL, and propagate CANCEL to any sub-chains you started. After CANCEL, send nothing else on the chain.

Only the original requester or the chain owner may send CANCEL.

### Errors

If you encounter an error, send a message of type ERROR with the error in the payload. If you ACK a request, you MUST eventually RESPONSE or ERROR — never silently abandon work.

### Sequencing

Increment your `sequence` by 1 for each message you send within a chain. Your counter is independent of other agents.

### Threading

Set `replyTo` to the id of the REQUEST you are responding to. When sending a sub-REQUEST from PROCESS, set `replyTo` to your PROCESS message id.

### Headers

Check for these reserved headers on incoming REQUESTs:

- `ttl` — Expiry timestamp. Do not begin work if expired. If TTL expires mid-PROCESS, stop and send ERROR.
- `exclusivity` — If `true`, you must CLAIM before proceeding.
- `priority` — Implementation-defined.

### Versioning

All your messages must include `version: 2`. If you receive a message with an unsupported version, respond with ERROR.

## TOON Format

Messages are encoded in TOON — a compact, token-efficient format. Example:

```
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
version: 2
chainId: f9e8d7c6-b5a4-3210-fedc-ba0987654321
sequence: 0
replyTo: undefined
timestamp: 2025-03-19T10:00:00.000Z
type: REQUEST
payload: What time is it in Geneva?
headers[1]: ttl:2025-03-19T11:00:00.000Z
from: a1b2c3d4-user-0001
to[1]: *
```

Rules:

- Key-value pairs use `key: value` (YAML-like)
- Arrays use `key[N]: val1,val2` for primitives or tabular `key[N]{f1,f2}: \\n v1,v2` for objects
- Strings containing commas, colons, or special chars must be quoted
- `undefined` for absent values, `true`/`false` for booleans

Every message you send MUST be valid TOON. If the store rejects your message, fix the format and retry.

## Available Tools

- `store_message(message)` — Send a message. The store validates and delivers it.
- `get_agent(ids)` — Look up agent info.
- `query_agents(skills)` — Find agents by skill.
- `get_message(filters)` — Retrieve messages by id, chainId, type, etc.
- `get_chain(chainId)` — Get chain status and owner.
- `get_user(ids)` — Look up user info.
- `get_channel(id_or_name)` — Look up channel info.
- `list_channels(filter?)` — List channels.

{{CUSTOM_TOOLS}}

## Audience Resolution

When setting `to`:

- Agent/user ID → direct message
- Channel name → all channel members
- → broadcast to everyone

When replying, mirror the original REQUEST's `to` field unless the spec says otherwise (e.g., ERROR goes to the original `from`).

</aside>

## Users

A user is a human, and usually sends requests via a broadcast to all agents.

Users can also “mention” specific agents to direct message. 

## Messages

A message is the fundamental unit of communication in the protocol. All messages are encoded in TOON format and validated by the store before delivery. 

```yaml
id: randomly generated unique uuid
version: protocol version (starting at 2 since v1 has no version)
chainId: randomly generated uuid grouping related messages
sequence: incrementing integer for message position, scoped per-agent per-chain
replyTo: id of the message this is replying to. undefined for origin messages
timestamp: UTC timestamp in ISO 8601 format
type: one of REQUEST, ACK, PROCESS, RESPONSE, ERROR, CLAIM, CANCEL
payload: message content
headers: key-value pairs for protocol and implementation-defined metadata
from: id of the sending agent or user
to: list of recipient agent/user ids, channel name(s), or * for broadcast
```

### Sending (`to`)

The store will first attempt to match each value in `to` against agent/user IDs first, then channel names, and finally `*` for broadcast. If nothing matches, the store sends an ERROR to the requester.

### Chains

A chain is a group of messages sharing a `chainId`. Chains are started from a REQUEST and form a tree-like structure. Sub-REQUESTS initiated during PROCESS can create branches within the same task, tracked via `replyTo` references.

`chainId` is just an identifier. Sequential ordering is determined by the `sequence` field, which is scoped per-agent — each agent maintains it’s own incrementing counter within a chain. 

### Threading

The `replyTo` field creates a parent-child relationship between messages. An origin REQUEST as `replyTo: undefined`. All following messages in the lifecycle set `replyTo` to the id of the REQUEST they are responding to.

When an agent in PROCESS sends a new REQUEST to another agent, the sub-REQUEST set `replyTo` to the PROCESS message that spawned it, preserving the conversational tree.

### Headers

Headers are key-value string pairs attached to messages. They carry protocol-defined metadata and implementation-specific extensions of the protocol.

**Reserved Headers**

- **`ttl`**: A UTC timestamp (ISO 8601) representing the expiry of the chain. Set on the initial REQUEST and inherited by all messages in the chain. Agents receiving a message where the current time exceeds `ttl` must not begin work and should send an ERROR with a timeout reason. Agents mid-PROCESS when TTL expires MUST stop work, send an ERROR, and propagate cancellation to any active sub-chains. When TTL expires, the behavior is equivalent to an implicit CANCEL. The store detects expiry, updates the chain status to `expired`, and agents mid-PROCESS follow the same propagation and cleanup rules as CANCEL. The distinction is that no explicit CANCEL message is sent — agents are expected to check TTL before beginning work and periodically during PROCESS
- **`exclusivity`**: `true` or `false`. When `true` on a broadcast REQUEST, signals that agents should CLAIM ownership rather than independently proceeding. See Claiming in Extensions.
- **`priority`**: Implementation-defined priority level. The protocol reserves the key but does not prescribe values or behavior.

Implementations may define additional headers. Custom headers should use a namespaced key format (e.g., `x-myapp-retry-count`) to avoid collisions with future protocol keys.

### Versioning

The `version` field identifies which protocol version the message originated from. Recipients MUST check the version field before processing. If a message’s version is unsupported, the recipient must respond with ERROR, who’s payload describes the version mismatch. Implementations should not discard version-mismatched messages.

## Channels

Channels are groupings of agents and users. They scope message delivery — if a message is sent to a channel it is delivered to all current members. 

```yaml
id: randomly generated unique uuid
name: unique human-readable channel name
members: list of agent/user ids
```

# Data Structures

All messages and agent-based communication is done via TOON format to preserve context. An example message is below. 

```arduino
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

| Current State | Valid Next States | Condition |
| --- | --- | --- |
| REQUEST | ACK | Agent accepts the request |
| REQUEST | (silent) | Agent declines; criteria is implementation-defined |
| ACK | PROCESS | Agent begins work on the request |
| PROCESS | RESPONSE | Agent completes work |
| PROCESS | REQUEST | Agent requires delegation or additional information |
| ACK | CLAIM | Agent asserts ownership of a broadcast REQUEST with `exclusivity: true` |
| (any) | CANCEL | Chain cancellation is requested |
| CANCEL | ACK | Recipient confirms cancellation |

## **Constraints**

- An agent MUST NOT send a RESPONSE without a preceding ACK and PROCESS in the same chain.
- An agent MUST NOT send PROCESS without first sending ACK.
- A REQUEST initiated from within PROCESS (for delegation or information gathering) begins its own independent state lifecycle, tracked by its own `replyTo` reference.
- An agent that has sent ACK MUST eventually send either a RESPONSE or an error. It MUST NOT silently abandon work after ACK.
- A message MUST be sent in TOON format.
- An agent MUST NOT send CLAIM without a preceding ACK in the same chain.
- An agent MUST NOT send CLAIM on a REQUEST that does not carry the `exclusivity: true` header.
- An agent MUST NOT send PROCESS or RESPONSE on a chain it does not own, once ownership has been resolved.
- Only one agent MAY own a chain at a time.
- Only the the original requester, or the chain owner MAY send CANCEL.
- After CANCEL, the only valid message on the chain is ACK of the CANCEL.
- CANCEL MUST propagate to all active sub-chains. An agent that has spawned sub-REQUESTs is responsible for propagating CANCEL to those sub-chains.
- An agent that receives CANCEL before ACKing the original REQUEST MAY silently ignore it.

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

1. Upon receiving a REQUEST, an agent MUST either respond with an ACK or remain silent. The criteria for this decision is implementation-defined.
2. Increments `sequence` by `1`.
3. Agent sends a message of type `ACK`.
4. Message is stored via Store Message.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: if the original REQUEST is a broadcast, `*`. if a direct message, `from` + `to` of the REQUEST, excluding the sender. if a channel, `channel` from the REQUEST.

> When multiple agents ACK a single broadcast REQUEST, resolution of which agent(s) proceed is implementation-defined. See Extensions for delegation and collaboration patterns.
> 

## CLAIM

1. Agent receives a broadcast REQUEST containing the reserved header `exclusivity: true`.
2. Agent sends ACK as usual.
3. Agent sends a message of type `CLAIM`. The payload should contain reasoning or capability justification for ownership, as well as increment `sequence` by `1`.
4. Message is stored via Store Message.
5. The store (or implementation layer) collects CLAIMs within a resolution window. Resolution strategy is implementation-defined (first-wins, best-fit, timeout-based, etc.).
6. Upon resolution, the store updates the chain entity's `owner` field to the winning agent's id.
7. The winning agent is notified and proceeds to PROCESS. Losing agents are notified that their CLAIM was not accepted and MUST NOT send further messages on the chain.

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

If a message fails TOON validation, the implementation may inform the agent of the failure, and allow it to retry. If it has failed validation twice, only a single third attempt is allowed. If the third attempt fails as well, a Message is sent of type ERROR, with a payload containing the following: “Agent failed to validate message after 3 attempts.” 

If a message fails parameter validation, the implementation may inform the agent of failure, specifically highlighting the parameter and rule that was invalidated. The same retry logic applies here. 

## Agent Failures

In the event that an agent fails after ACK’ing due to network error or other issue, the error should be forwarded to the user in the form of a Message with type ERROR. The payload will contain the error message. The content and functionality following receipt of the ERROR message is the responsibility of the implementation.

## **Claim Resolution Failures**

If no agent CLAIMs within the resolution window, or all CLAIMs are rejected, the store SHOULD send an ERROR on the chain with a payload indicating that no agent claimed ownership. The chain status is updated to `cancelled`.

## **Cancellation Failures**

If an agent fails to ACK a CANCEL within a reasonable timeframe (implementation-defined), the store MAY force-update the chain status to `cancelled` and log the unresponsive agent. This prevents hung agents from blocking cancellation.
