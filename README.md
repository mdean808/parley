# simple-implementation

A simple implementation of the [agent-to-agent communication protocol spec](./PROTOCOL_SPEC.md). Multiple AI agents receive user requests, evaluate relevance based on their skills, and respond following a strict message state machine (`REQUEST → ACK → PROCESS → RESPONSE`).

## Setup

Requires [Bun](https://bun.sh) and an Anthropic API key.

```bash
bun install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=your-key-here
```

## Usage

```bash
bun run index.ts
```

This starts a REPL where you can type messages. Each message is broadcast to all agents in parallel. Agents evaluate whether the request matches their skills and either respond or silently decline.

### Agents

| Name  | Role      | Skills                          |
|-------|-----------|---------------------------------|
| Atlas | Research  | general-knowledge, research     |
| Sage  | Creative  | creative-writing, brainstorming |
| Bolt  | Technical | coding, technical               |

### Environment Variables

| Variable           | Description                        | Default                       |
|--------------------|------------------------------------|-------------------------------|
| `ANTHROPIC_API_KEY`| Anthropic API key                  | (required)                    |
| `MODEL`            | Claude model to use                | `claude-haiku-4-5-20251001`   |
| `LOG_LEVEL`        | Logging level                      | `INFO`                        |

## Protocol

All communication uses the [TOON format](https://github.com/toon-format/toon). Messages flow through the Central Store, which tracks users, agents, and message history. See [`PROTOCOL_SPEC.md`](./PROTOCOL_SPEC.md) for the full specification.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **LLM**: Claude via `@anthropic-ai/sdk`
- **Linter/Formatter**: [Biome](https://biomejs.dev)
