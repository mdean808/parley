# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Simple implementation of an agent-to-agent communication protocol (defined in `PROTOCOL_SPEC.md`). The system runs multiple AI agents (powered by Claude) that receive user requests, evaluate relevance based on their skills, and respond following a strict message state machine.

## Commands

- **Install**: `bun install`
- **Run**: `bun run index.ts`
- **Lint**: `bunx biome lint ./src`
- **Format**: `bunx biome format ./src`
- **Check**: `bunx biome check ./src` (lint + format)

No test runner is configured yet.

## Environment Variables

- `ANTHROPIC_API_KEY` — required, set in `.env`
- `MODEL` — Claude model to use (default: `claude-haiku-4-5-20251001`)
- `LOG_LEVEL` — logging verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `INFO`)

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode, ESNext target, bundler module resolution)
- **Module system**: ES modules (`"type": "module"`)
- **LLM**: Anthropic Claude SDK (`@anthropic-ai/sdk`)
- **Linter/Formatter**: Biome (tabs, double quotes, recommended rules)

## Project Structure

```
index.ts                              — Entry point: wires personas + brain into protocol
src/
  types.ts                            — Shared types (User, Agent, Message, AgentBrain, etc.)
  agents.ts                           — Agent persona definitions (Atlas, Sage, Bolt)
  brain.ts                            — ClaudeBrain: LLM logic (Anthropic SDK calls)
  chat/
    display.ts                        — Terminal UI: markdown rendering, stats, spinners, cost tracking
  protocols/
    default/
      index.ts                        — Barrel file, re-exports DefaultProtocol
      protocol.ts                     — DefaultProtocol: accepts config, manages routing + collection
      agent.ts                        — ProtocolAgent: pure state machine, delegates to AgentBrain
      store.ts                        — Central Store: in-memory state for users, agents, messages
      toon.ts                         — TOON format encoding/decoding via @toon-format/toon
      logger.ts                       — Structured JSON event logging to protocol.json
```

## Architecture

### Core Components

- **AgentBrain** (`src/brain.ts`): `ClaudeBrain` class implementing the `AgentBrain` interface. Contains all LLM logic (skill evaluation via `shouldHandle()`, response generation via `generateResponse()`). Zero protocol dependencies — imports only `@anthropic-ai/sdk` and `src/types.ts`.
- **Agent Personas** (`src/agents.ts`): Three pre-configured agent persona definitions (Atlas, Sage, Bolt). Pure data — no protocol or LLM dependencies.
- **Central Store** (`src/protocols/default/store.ts`): In-memory state management for users, agents, and messages. Operations: registerUser, getUser, registerAgent, getAgent, sendMessage, getMessages.
- **ProtocolAgent** (`src/protocols/default/agent.ts`): Pure protocol state machine (ACK → PROCESS → RESPONSE). Delegates skill evaluation and response generation to an injected `AgentBrain`.
- **Protocol** (`src/protocols/default/protocol.ts`): `DefaultProtocol` accepts a config with personas and a `createBrain` factory. Owns wire-format instructions (TOON_NOTE). Manages brain metadata collection.
- **TOON** (`src/protocols/default/toon.ts`): Encodes/decodes messages using the TOON format.

### Message State Machine

Messages follow a strict lifecycle: `REQUEST → ACK → PROCESS → RESPONSE`

Key constraints:
- No RESPONSE without preceding ACK and PROCESS in the same chain
- No PROCESS without first sending ACK
- After ACK, agent MUST eventually send RESPONSE or error (no silent abandonment)
- PROCESS can spawn new REQUEST chains for delegation/information gathering
- Agents may silently decline a REQUEST (criteria is LLM-evaluated skill matching)

### TOON Format

All agent communication uses TOON (Token Object Over Network). Reference: https://github.com/toon-format/toon
