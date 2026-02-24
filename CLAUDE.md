# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Simple implementation of an agent-to-agent communication protocol (defined in `PROTOCOL_SPEC.md`). Early-stage project — the protocol spec is the primary reference for all implementation work.

## Commands

- **Install**: `bun install`
- **Run**: `bun run index.ts`

No test runner, linter, or formatter is configured yet.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode, ESNext target, bundler module resolution)
- **Module system**: ES modules (`"type": "module"`)

## Architecture

The protocol defines a message-driven system with these core components:

- **Central Store**: Manages users, agents, and messages. Operations: RegisterUser, GetUser, RegisterAgent, GetAgent, QueryAgents, StoreMessage, GetMessage.
- **Agents**: Entities with skills that send/receive TOON-formatted messages. Must validate message format — reject non-TOON messages.
- **Users**: Humans who send requests via broadcast (`*`) or direct message (specific agent IDs).
- **Messages**: TOON format with fields: `id`, `chainId`, `replyTo`, `timestamp`, `type`, `payload`, `from`, `to`.

### Message State Machine

Messages follow a strict lifecycle: `REQUEST → ACK → PROCESS → RESPONSE`

Key constraints:
- No RESPONSE without preceding ACK and PROCESS in the same chain
- No PROCESS without first sending ACK
- After ACK, agent MUST eventually send RESPONSE or error (no silent abandonment)
- PROCESS can spawn new REQUEST chains for delegation/information gathering
- Agents may silently decline a REQUEST (criteria is implementation-defined)

### TOON Format

All agent communication uses TOON (Token Object Over Network). Reference: https://github.com/toon-format/toon
