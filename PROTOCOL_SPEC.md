# Overview - v0.0.1

This is a protocol for token-efficient and “reliable” agent to agent communication. Agents communicate with each other and the user using a reliable and validated protocol. Overall context and “job” specification is stored in a central store to ensure agents don’t pollute their contexts. In practice, system prompts define communication steps/rules and structure of the “application.” 

Please note that this is a work in progress, and parts are incomplete.

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
chainId: randomly generated uuid for conversation context
replyTo: message this message is replying to. undefined if not a reply
timestamp: UTC standardized timestamp
type: message type - one of REQUEST, ACK, PROCESS, RESPONSE
payload: message content
from: agent/user id sending the message
to: list of agent/user ids to receive the message. if *, the message is a broadcast
```

**Validation:** Ensure that messages contain the above parameters and are sent in the correct TOON format. In the case that a message does not validate correctly, follow the steps listed in Error Handling.

### Get Message

Retrieves messages from the store.

- **Input**: any message property (id, chainId, from, to, type, etc.)
- **Effect**: None
- **Returns**: List of matching messages

> Supports flexible querying — e.g., get all user's messages, all messages in a chain, or all user messages in a chain.
> 

## Agents

An agent contains tools/skills for specific tasks, with custom system prompts. 

Agents *always* receive and send messages in TOON format. If they try to send a message that is not in valid TOON, it MUST be rejected and they are required to try again.

## Users

A user is a human, and usually sends requests via a broadcast to all agents.

Users can also “mention” specific agents to direct message. 

## Messages

todo: contain info about chains, reply, other things

# Data Structures

All messages and agent-based communication is done via TOON format to preserve context. An example message is below. 

```arduino
id: asdcd-2dfv3-vvsa3-af3ba
chainId: asdcd-2dfv3-vvsa3-af3ba
replyTo: asdcd-2dfv3-vvsa3-af3ba
timestamp: 2012-04-23T18:25:43.511Z
type: REQUEST
payload: What time is it in Geneva?
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

## **Constraints**

- An agent MUST NOT send a RESPONSE without a preceding ACK and PROCESS in the same chain.
- An agent MUST NOT send PROCESS without first sending ACK.
- A REQUEST initiated from within PROCESS (for delegation or information gathering) begins its own independent state lifecycle, tracked by its own `replyTo` reference.
- An agent that has sent ACK MUST eventually send either a RESPONSE or an error. It MUST NOT silently abandon work after ACK.
- A message MUST be sent in TOON format.

# **Protocol Operations**

## REQUEST

1. Sender composes a message of type `REQUEST` with `to` set to  for broadcast or specific agent/user id(s) for direct message.
2. Message is stored via Store Message.
3. All recipients are notified of the incoming request according to the implementation.

### Parameters

- **`replyTo`**: `undefined` (origin message)
- **`to`**:  (broadcast) or specific agent/user id(s)

## ACK

1. Upon receiving a REQUEST, an agent MUST either respond with an ACK or remain silent. The criteria for this decision is implementation-defined.
2. Agent sends a message of type `ACK`.
3. Message is stored via Store Message.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: preserves the audience of the original REQUEST. If the
REQUEST was a broadcast (`*`), the reply is also a broadcast.
If the REQUEST targeted specific recipients, the reply is
sent to the original sender and all other recipients in the
REQUEST's to field — maintaining the full conversational
context.

> When multiple agents ACK a single broadcast REQUEST, resolution of which agent(s) proceed is implementation-defined. See Extensions for delegation and collaboration patterns.
> 

## PROCESS

1. After sending an ACK, the agent begins work on the request.
2. Agent sends a message of type `PROCESS` containing a summary of the steps it will take.
3. Message is stored via Store Message.
4. If the agent requires additional information or delegation, it MAY send a new REQUEST to other agents or the original requester, initiating a new operation sequence.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: mirrors the original REQUEST's `to` field

## RESPONSE

1. After completing its work, the agent sends a message of type `RESPONSE` containing the result.
2. Message is stored via Store Message.

### Parameters

- **`replyTo`**: the REQUEST message id
- **`to`**: mirrors the original REQUEST's `to` field

# Error Handling

## Validation

If a message fails TOON validation, the implementation may inform the agent of the failure, and allow it to retry. If it has failed validation twice, only a single third attempt is allowed. If the third attempt fails as well, a Message is sent of type ERROR, with a payload containing the following: “Agent failed to validate message after 3 attempts.” 

If a message fails parameter validation, the implementation may inform the agent of failure, specifically highlighting the parameter and rule that was invalidated. The same retry logic applies here. 

## Agent Failures

In the event that an agent fails after ACK’ing due to network error or other issue, the error should be forwarded to the user in the form of a Message with type ERROR. The payload will contain the error message. 

# Extensions

The following are suggestions for implementing more complicated and dynamic applications of the protocol. 

## Delegation

## Collaboration

One may emphasize agent-agent collaboration via system prompts and _________. 

TODO: What was hte general idea here about collaboration within the protocol?
