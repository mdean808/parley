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
index.ts          — Entry point: REPL loop, user registration, agent init
src/
  types.ts        — Type definitions (User, Agent, Message, AgentPersona, etc.)
  store.ts        — Central Store: in-memory state for users, agents, messages
  toon.ts         — TOON format encoding/decoding via @toon-format/toon
  agent.ts        — ProtocolAgent class: LLM-based request handling + state machine
  agents.ts       — Agent persona factory (Atlas, Sage, Bolt)
  protocol.ts     — broadcastRequest(): parallel agent invocation + result collection
  logger.ts       — Structured JSON event logging to protocol.json
  display.ts      — Terminal UI: markdown rendering, stats, spinners, cost tracking
```

## Architecture

### Core Components

- **Central Store** (`src/store.ts`): In-memory state management for users, agents, and messages. Operations: registerUser, getUser, registerAgent, getAgent, getAllAgents, queryAgents, storeMessage, getMessages.
- **ProtocolAgent** (`src/agent.ts`): AI agent that evaluates incoming requests against its skills using an LLM call, then follows the protocol state machine (ACK → PROCESS → RESPONSE). Silently declines irrelevant requests by returning null.
- **Agent Personas** (`src/agents.ts`): Three pre-configured agents:
  - **Atlas** — Research (skills: general-knowledge, research)
  - **Sage** — Creative (skills: creative-writing, brainstorming)
  - **Bolt** — Technical (skills: coding, technical)
- **Protocol** (`src/protocol.ts`): `broadcastRequest()` sends a user's request to all agents in parallel, collects responses, logs events, and displays results.
- **TOON** (`src/toon.ts`): Encodes/decodes messages using the TOON format.

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
