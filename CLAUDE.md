# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Implementation of an agent-to-agent communication protocol with five protocol variants (parley tool-use, simple direct, claude-code, Google A2A, CrewAI). The system runs multiple AI agents (powered by Claude) that receive user requests, evaluate relevance based on their skills, and respond. Includes a benchmarking system that compares protocol performance with LLM-as-judge evaluation. External protocols (A2A, CrewAI) are bridged via HTTP — TypeScript adapters in `protocols/src/` call Python agent servers in `external/`.

## Commands

- **Install**: `bun install`
- **CLI Chat**: `bun run chat`
- **Web Chat**: `bun run web`
- **Benchmark**: `bun run bench [--protocols parley,simple] [--probes id1,id2] [--pattern single-route,handoff] [--output dir] [--no-judge] [--judge-model model] [--no-report] [--concurrency N] [--runs N]`
- **Lint**: `bun run lint`
- **Format**: `bun run format`
- **Start external servers**: `./start-agents.sh` (requires `jq`; starts CrewAI + A2A servers from `agents.json`)

No test runner is configured yet.

## Environment Variables

- `ANTHROPIC_API_KEY` — required, set in `.env`
- `MODEL` — Claude model to use for agents (default: `claude-sonnet-4-6`)
- `JUDGE_MODEL` — Claude model for LLM judge (default: `claude-sonnet-4-6`)
- `LOG_LEVEL` — logging verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `INFO`)
- `A2A_{KEY}_URL` — Override A2A agent URL per agent (key derived from agent name before ` - `, uppercased; e.g. `A2A_ATLAS_URL`). Defaults to `http://localhost:{port}` from `agents.json`.
- `CREWAI_URL` — CrewAI FastAPI wrapper URL (default: `http://localhost:8000`)
- `CREWAI_MODE` — `single` (3 separate crews) or `crew` (1 collaborative crew) (default: `single`)

## Tech Stack

- **Runtime**: Bun (workspaces)
- **Language**: TypeScript (strict mode, ESNext target, bundler module resolution)
- **Module system**: ES modules (`"type": "module"`)
- **LLM**: Anthropic Claude SDK (`@anthropic-ai/sdk`)
- **Linter/Formatter**: Biome (tabs, double quotes, recommended rules)

## Project Structure

```
agents.json                           — Shared agent persona config (name, skills, systemPrompt, a2a port)
start-agents.sh                       — Launches all external servers from agents.json
packages/core/                        — Shared workspace: types, config, cost
  src/
    types.ts                          — Shared types (User, Agent, Message, Protocol, etc.)
    config.ts                         — MODEL string, Anthropic client, protocol constants
    cost.ts                           — Per-model token pricing + computeCost()
protocols/                            — Workspace: protocol implementations
  src/
    factory.ts                        — createProtocol(id) factory, registry
    agents.ts                         — Reads personas from agents.json, exports getA2AUrls()
    logger.ts                         — Structured JSON file logger
    index.ts                          — Barrel re-export
    parley/                           — parley: agentic tool-use + chain history + TOON
      index.ts, protocol.ts, agent.ts, types.ts, prompt.ts, tools.ts, tool-definitions.ts, tool-executor.ts, store.ts, toon.ts
    simple/                           — Simple: direct Claude calls, no protocol overhead
      index.ts, protocol.ts
    claude-code/                      — Claude Code CLI wrapper
      index.ts, protocol.ts
    a2a/                              — Google A2A adapter (calls external A2A agents via HTTP)
      index.ts, protocol.ts, types.ts
    crewai/                           — CrewAI adapter (calls FastAPI wrapper via HTTP)
      index.ts, protocol.ts, types.ts
benchmark/                            — Workspace: benchmarking system
  src/
    cli.ts                            — Benchmark CLI entry point
    comparison.ts                     — Comparison engine: all protocols x all probes
    runner.ts                         — Core runner: single-shot probe execution
    assertions.ts                     — Pure function assertion checker (no LLM)
    judge.ts                          — Pattern-aware LLM-as-judge evaluation
    judge-types.ts, judge-prompt.ts   — Judge types and pattern-specific prompts
    types.ts                          — Benchmark types (InteractionPattern, ProbeConfig, etc.)
    collect.ts                        — ResultCollector for protocol callbacks
    pool.ts                           — Concurrent task runner
    report-terminal.ts                — Terminal report renderer
    report-markdown.ts                — Markdown report generator
    probes/                           — JSON probe definitions (by interaction pattern)
      index.ts                        — Probe loader (loadAllProbes, loadProbe, loadProbesByPattern)
  results/                            — Default benchmark output directory (gitignored)
results/                              — Committed reference benchmark results (root-level, checked in)
apps/cli-chat/                        — Workspace: terminal chat REPL
  src/
    index.ts                          — Protocol selection + chat loop
    display.ts                        — Terminal UI: markdown rendering, stats
apps/web-chat/                        — Workspace: SvelteKit web chat app
external/                             — Python agent servers (not Bun workspaces)
  a2a/                                — A2A agent servers (one per persona, Claude API)
    requirements.txt
    agent_server/__init__.py, main.py
  crewai/                             — CrewAI FastAPI wrapper (single + crew modes)
    requirements.txt
    app/__init__.py, main.py, models.py, crew.py
specs/                                — Protocol specification documents
logs/                                 — Runtime JSON logs (gitignored)
plans/                                — Implementation plan documents
docs/                                 — Project documentation
  plans/                              — Implementation plan documents (dated)
```

## Workspace Dependency Graph

```
packages/core     ← no workspace deps
protocols         ← depends on core
benchmark         ← depends on core + protocols
apps/cli-chat     ← depends on core + protocols
apps/web-chat     ← depends on core + protocols
```

## Agent Configuration

Agent personas are defined in `agents.json` at the project root — the single source of truth for all protocols and external services. To add a new agent, add an entry to the `agents` array with `name`, `skills`, `systemPrompt`, and `a2a.port`, then restart servers. The TypeScript code (`protocols/src/agents.ts`) and both Python services read from this file.

## Architecture

### Protocol Implementations

Five protocols implement the `Protocol` interface (`initialize()` + `sendRequest()`):

- **parley (ParleyProtocol)**: Agentic tool-use approach. Agents have tools (`send_message`, `get_message`, `evaluate_skills`). Per-chain LLM conversation history. Richer multi-round support.
- **simple (SimpleProtocol)**: Direct Claude SDK calls, no protocol overhead. Per-agent conversation history. All agents always respond (no skill filtering). Baseline for comparison.
- **claude-code (ClaudeCodeProtocol)**: Wraps the Claude Code CLI for single-agent agentic baseline.
- **a2a (A2AProtocol)**: Bridges to external A2A-compliant agent servers via `@a2a-js/sdk`. Each persona maps to a separate A2A server. Requires running `external/a2a/` servers.
- **crewai (CrewAIProtocol)**: Bridges to a CrewAI FastAPI wrapper via HTTP. Supports two modes: `single` (3 independent single-agent crews) and `crew` (1 collaborative crew). Requires running `external/crewai/` server.

### Benchmark System

Probe-based system testing protocol interaction quality (routing, handoff, collaboration). Two-layer evaluation: structural assertions (no LLM) then pattern-aware LLM judge.

- **Runner** (`benchmark/src/runner.ts`): Single-shot `runProbe()` — sends prompt, collects agent results, checks assertions, optionally judges.
- **Assertions** (`benchmark/src/assertions.ts`): Pure function checker for agent count, required/excluded skills.
- **Judge** (`benchmark/src/judge.ts`): Pattern-aware LLM evaluation with dual rubrics — interaction (0-3, pattern-specific) and content (0-3), combined into a composite score (0-100).
- **Comparison** (`benchmark/src/comparison.ts`): Runs protocols across all probes, groups results by interaction pattern (single-route, selective-route, decline-all, handoff, collaborate). Supports `--runs N > 1` for sample std-dev reporting.
- **Probes** (`benchmark/src/probes/*.json`): Single-shot interaction test definitions with expected assertions.
- **Reference results** (`results/`): Committed benchmark runs used as the canonical reference for the thesis. Latest: `results/benchmark-2026-04-16T23-21-19.{json,md}`. Markdown reports include a Configuration Audit table (per-protocol model + max_tokens actually observed) so score gaps are attributable.

### TOON Format

parley communication uses TOON (Token Object Over Network). Reference: https://github.com/toon-format/toon
