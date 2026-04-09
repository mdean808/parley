# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Implementation of an agent-to-agent communication protocol with two active protocol variants (v2 tool-use, simple direct) and a legacy v1 state-machine implementation kept for posterity. The system runs multiple AI agents (powered by Claude) that receive user requests, evaluate relevance based on their skills, and respond. Includes a benchmarking system that compares protocol performance with LLM-as-judge evaluation.

## Commands

- **Install**: `bun install`
- **Run (interactive REPL)**: `bun run index.ts`
- **Benchmark**: `bun run bench.ts [--protocols v2,simple] [--output path] [--no-judge] [--judge-model model]`
- **Comparison report**: `bun run compare.ts [--scenarios id1,id2] [--no-judge] [--judge-model model] [--output dir]`
- **Lint**: `bunx biome lint ./src`
- **Format**: `bunx biome format ./src`
- **Check**: `bunx biome check ./src` (lint + format)

No test runner is configured yet.

## Environment Variables

- `ANTHROPIC_API_KEY` — required, set in `.env`
- `MODEL` — Claude model to use for agents (default: `claude-haiku-4-5-20251001`)
- `JUDGE_MODEL` — Claude model for LLM judge (default: `claude-sonnet-4-5-20250929`)
- `LOG_LEVEL` — logging verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `INFO`)

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict mode, ESNext target, bundler module resolution)
- **Module system**: ES modules (`"type": "module"`)
- **LLM**: Anthropic Claude SDK (`@anthropic-ai/sdk`)
- **Linter/Formatter**: Biome (tabs, double quotes, recommended rules)

## Project Structure

```
index.ts                              — Interactive REPL: protocol selection + chat loop
bench.ts                              — Benchmark runner CLI: runs scenarios across protocols
compare.ts                            — Comparison CLI: runs all protocols, generates reports
src/
  types.ts                            — Shared types (User, Agent, Message, Protocol, etc.)
  agents.ts                           — Agent persona definitions (Atlas, Sage, Bolt)
  brain.ts                            — ClaudeBrain: LLM logic (Anthropic SDK calls)
  config.ts                           — Shared MODEL string + Anthropic SDK client singleton
  cost.ts                             — Per-model token pricing + computeCost()
  factory.ts                          — createProtocol(id) factory, ProtocolId type
  chat/
    display.ts                        — Terminal UI: markdown rendering, stats, spinners
  protocols/
    default_v1/                       — v1: legacy state machine + TOON (kept for posterity, not active)
      protocol.ts, agent.ts, store.ts, toon.ts
    default_v2/                       — v2: agentic tool-use + chain history + TOON
      protocol.ts, agent.ts, store.ts, toon.ts, tools.ts, prompt.ts
    simple/                           — Simple: direct Claude calls, no protocol overhead
      protocol.ts
  bench/
    types.ts                          — Benchmark + multi-round + judge result types
    runner.ts                         — Core runner: executes scenarios, delegates multi-round
    scenarios.ts                      — Built-in scenario definitions (single + multi-round)
    multi-round.ts                    — Multi-round conversation loop with synthesizers
    synthesizers.ts                   — Prompt synthesizers (concatenate, summary, debate)
    judge.ts                          — LLM-as-judge: forced tool-use evaluation
    judge-types.ts                    — Judge type definitions
    judge-prompt.ts                   — Judge system prompt, rubric, user prompt builder
    comparison.ts                     — Comparison engine: all protocols x all scenarios
    report-terminal.ts                — Terminal report renderer (chalk tables)
    report-markdown.ts                — Markdown report generator
    scenarios/                        — JSON scenario files for comparison runs
      index.ts                        — Scenario loader + validation
      general-knowledge.json
      coding-focused.json
      creative-philosophical.json
      mixed-multi-agent.json
```

## Architecture

### Protocol Implementations

Two active protocols implement the `Protocol` interface (`initialize()` + `sendRequest()`):

- **v2 (DefaultProtocolV2)**: Agentic tool-use approach. Agents have tools (`send_message`, `get_message`, `evaluate_skills`). Per-chain LLM conversation history. Richer multi-round support.
- **simple (SimpleProtocol)**: Direct Claude SDK calls, no protocol overhead. Per-agent conversation history. All agents always respond (no skill filtering). Baseline for comparison.

Legacy (not wired into factory/benchmarks/REPL):
- **v1 (DefaultProtocol)**: Programmatic state machine (ACK/PROCESS/RESPONSE), TOON wire format, injected `AgentBrain`, central store with pub/sub. Code kept for reference.

### Shared Utilities

- **`src/config.ts`**: Shared `MODEL` string and Anthropic `client` singleton. Used by simple protocol and v2 agents.
- **`src/cost.ts`**: `PRICING` map + `computeCost()`. Used by display, runner, and reports.
- **`src/factory.ts`**: `createProtocol(id)` factory. Used by index.ts, bench.ts, compare.ts, and comparison engine.

### Benchmark System

- **Runner** (`src/bench/runner.ts`): Executes `ScenarioConfig` against a protocol. Detects `multiRound` config and delegates to `runMultiRound()`.
- **Multi-round** (`src/bench/multi-round.ts`): Runs N rounds where agent responses feed into a synthesizer to produce the next prompt. Same `chainId` across rounds for context continuity.
- **Judge** (`src/bench/judge.ts`): Independent LLM evaluation. Scores on relevance, information_density, redundancy, summarization_quality, and coherence (multi-round only). Uses forced tool-use for structured output. Separate Anthropic client from agents.
- **Comparison** (`src/bench/comparison.ts`): Runs v2 and simple protocols across all scenarios, computes overhead metrics (token/cost/latency deltas vs simple baseline), generates aggregate scores.

### TOON Format

v2 communication uses TOON (Token Object Over Network). Reference: https://github.com/toon-format/toon
