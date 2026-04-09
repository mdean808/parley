# simple-implementation

A multi-protocol agent-to-agent communication system with benchmarking. Three AI agents (Atlas/Research, Sage/Creative, Bolt/Technical) collaborate to answer user requests, with three different protocol implementations compared side-by-side.

Built for COGS 402 to study how protocol design affects multi-agent response quality, token efficiency, and latency.

## Setup

Requires [Bun](https://bun.sh) and an Anthropic API key.

```bash
bun install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=your-key-here
```

## Quick Start

### Interactive Chat

```bash
bun run index.ts
```

Select a protocol from the menu, then type messages. Agents evaluate whether each request matches their skills and either respond or decline. Type `exit` to quit.

### Run Benchmarks

```bash
bun run bench.ts
```

Runs all built-in scenarios across all three protocols, scores responses with an LLM judge, and writes results to `results/benchmark.json`.

### Run Full Comparison

```bash
bun run compare.ts
```

Runs all protocols against all comparison scenarios, computes overhead metrics, and generates both a terminal summary and a markdown report in `results/`.

## Protocols

| Protocol | Approach | Skill Filtering | Multi-Round Context |
|----------|----------|-----------------|---------------------|
| **v1** (state machine) | Programmatic ACK/PROCESS/RESPONSE cycle, TOON wire format | LLM-evaluated per request | Via chain store; synthesizer bridges rounds |
| **v2** (tool-use) | Agentic — agents use tools (`send_message`, `get_message`, `evaluate_skills`) | Tool-based skill evaluation | Per-chain LLM history + store queries |
| **simple** (direct) | Direct Claude API calls, no protocol overhead | None — all agents always respond | Per-agent conversation history |

## Agents

| Name | Role | Skills |
|------|------|--------|
| Atlas | Research | general-knowledge, research |
| Sage | Creative | creative-writing, brainstorming |
| Bolt | Technical | coding, technical |

## Benchmarking

The benchmark system measures how protocol design affects response quality and cost.

### What It Measures

- **Token usage** (input/output per agent, per round, aggregate)
- **Cost** (computed from per-model pricing)
- **Latency** (wall-clock time per round)
- **LLM judge scores** (1-5 on relevance, information density, redundancy, summarization quality, coherence)
- **Protocol overhead** (token/cost/latency delta vs. simple baseline)

### Built-in Scenarios

**Single-round:** research-only, creative-only, technical-only, mixed cross-domain

**Multi-round:** deepening conversation (3 rounds), agent debate (4 rounds), follow-up chain (2 rounds)

**Comparison scenarios** (JSON, in `src/bench/scenarios/`): general-knowledge, coding-focused, creative-philosophical, mixed-multi-agent

### CLI Options

```bash
# Benchmark runner
bun run bench.ts --protocols v1,v2,simple   # select protocols (default: all)
bun run bench.ts --output results/out.json  # custom output path
bun run bench.ts --no-judge                 # skip LLM judge (cheaper)
bun run bench.ts --judge-model claude-sonnet-4-5-20250929  # override judge model

# Comparison report
bun run compare.ts --scenarios general-knowledge,coding-focused  # specific scenarios
bun run compare.ts --output results/                             # output directory
bun run compare.ts --no-judge                                    # skip judge
```

### Output

- **bench.ts** writes `results/benchmark.json` — flat JSON with per-round and aggregate metrics + judge scores.
- **compare.ts** writes `results/comparison-YYYY-MM-DD.json` and `results/comparison-YYYY-MM-DD.md` — includes overhead tables, per-scenario breakdowns, agent participation, and auto-generated observations.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | (required) |
| `MODEL` | Claude model for agents | `claude-haiku-4-5-20251001` |
| `JUDGE_MODEL` | Claude model for LLM judge | `claude-sonnet-4-5-20250929` |
| `LOG_LEVEL` | Logging level | `INFO` |

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **LLM**: Claude via `@anthropic-ai/sdk`
- **Wire Format**: [TOON](https://github.com/toon-format/toon) (v1 and v2 protocols)
- **Linter/Formatter**: [Biome](https://biomejs.dev)

## Protocol Specs

- [`spec/PROTOCOL_SPEC_1.md`](./spec/PROTOCOL_SPEC_1.md) — v1 state machine protocol
- [`spec/PROTOCOL_SPEC_2.md`](./spec/PROTOCOL_SPEC_2.md) — v2 tool-use protocol
