# parley

A multi-protocol agent-to-agent communication system with benchmarking. Four AI agents (Atlas/Research, Sage/Creative, Bolt/Technical, Colt/Orchestration) collaborate to answer user requests across five protocol implementations compared side-by-side.

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
bun run chat
```

Select a protocol from the menu, then type messages. Agents evaluate whether each request matches their skills and either respond or decline. Type `exit` to quit.

### Web Chat

```bash
bun run web
```

### Run Benchmarks

```bash
bun run bench
```

Runs all scenarios across all protocols, scores responses with an LLM judge, and generates a terminal summary plus JSON and markdown reports in `benchmark/results/`.

```bash
# Select specific protocols and probes
bun run bench --protocols parley,simple --probes simple-factual-question,decline-plumbing

# Filter by interaction pattern
bun run bench --pattern handoff,collaborate

# Skip LLM judge (cheaper)
bun run bench --no-judge

# Override judge model
bun run bench --judge-model claude-sonnet-4-6

# Custom output directory
bun run bench --output results/

# Control parallelism
bun run bench --concurrency 5

# Multiple runs per (protocol, probe) pair for sample std-dev reporting
bun run bench --runs 3

# Skip markdown report generation
bun run bench --no-report
```

### External Protocol Servers (A2A, CrewAI)

```bash
./start-agents.sh
```

Requires `jq`. Launches A2A and CrewAI servers from `agents.json`. Required before benchmarking the `a2a` or `crewai` protocols.

## Protocols

| Protocol | Approach | Skill Filtering | Multi-Round Context |
|----------|----------|-----------------|---------------------|
| **parley** (tool-use) | Agentic — agents use tools (`send_message`, `get_message`, `evaluate_skills`) | Tool-based skill evaluation | Per-chain LLM history + store queries |
| **simple** (direct) | Direct Claude API calls, no protocol overhead | None — all agents always respond | Per-agent conversation history |
| **claude-code** | Wraps Claude Code CLI | Single-agent | Agentic baseline |
| **a2a** (Google A2A) | Bridges to external A2A-compliant agent servers | Per-server agent cards | A2A task context |
| **crewai** | Bridges to CrewAI FastAPI wrapper | CrewAI delegation (crew mode) | CrewAI internal |

## Agents

Agent personas are defined in `agents.json` at the project root.

| Name | Role | Skills |
|------|------|--------|
| Atlas | Research | general-knowledge, research |
| Sage | Creative | creative-writing, brainstorming |
| Bolt | Technical | coding, technical |
| Colt | Collaboration Orchestrator | collaboration, orchestration, project-management, management |

## Benchmarking

The benchmark system measures how protocol design affects response quality and cost.

### What It Measures

Two-layer evaluation: structural assertions (no LLM) then pattern-aware LLM judge.

- **Structural assertions** — agent count (min/max), required/excluded skills. Pure pass/fail, no LLM needed.
- **Interaction rubric** (0-3) — pattern-specific: routing accuracy, handoff clarity, collaboration coherence.
- **Content rubric** (0-3) — depth, accuracy, completeness of agent responses.
- **Composite score** (0-100) — interaction × 0.7 + content × 0.3, normalized.
- **Cost/tokens/latency per probe**

### Probes

Seven built-in probes across five interaction patterns:

| Pattern | Probes |
|---------|--------|
| **single-route** | simple-factual-question, route-technical-debug |
| **selective-route** | selective-brainstorm-vs-research |
| **decline-all** | decline-plumbing |
| **handoff** | handoff-research-to-technical |
| **collaborate** | collaborate-startup-pitch, deep-content-coding |

### Output

`bun run bench` writes to `benchmark/results/` by default (gitignored):
- `benchmark-YYYY-MM-DDTHH-MM-SS.json` — full structured data
- `benchmark-YYYY-MM-DDTHH-MM-SS.md` — summary table, per-probe results, configuration audit

Canonical reference runs used for the thesis are committed in [`results/`](results/) at the repo root.

### Reference Results

Latest committed run: [`results/benchmark-2026-04-16T23-21-19.md`](results/benchmark-2026-04-16T23-21-19.md) — 5 protocols × 7 probes, judged by `claude-sonnet-4-6`.

| Protocol | Score | Interaction | Content | Pass | Avg Cost | Avg Time |
|----------|-------|-------------|---------|------|----------|----------|
| parley | **97.9%** | 98.4% | 96.8% | 6/7 | $0.0724 | 33.5s |
| crewai | 57.9% | 41.7% | 95.8% | 0/7 | $0.0261 | 34.3s |
| simple | 56.3% | 39.7% | 95.2% | 0/7 | $0.0586 | 17.8s |
| a2a | 56.3% | 39.7% | 95.2% | 0/7 | $0.0586 | 18.0s |
| claude-code | 53.3% | 47.6% | 66.7% | 0/7 | $0.0869 | 33.0s |

parley leads on interaction quality (routing accuracy, handoff clarity, collaboration coherence) because skill-based filtering prevents the "all agents always respond" failure mode that drives the other protocols' low interaction scores. Content scores are comparable across protocols — the gap is structural, not generative. See the linked markdown report for per-pattern breakdowns and the configuration audit (all protocols ran `claude-sonnet-4-6` with matched 2048-token output budgets).

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | (required) |
| `MODEL` | Claude model for agents | `claude-sonnet-4-6` |
| `JUDGE_MODEL` | Claude model for LLM judge | `claude-sonnet-4-6` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `A2A_{KEY}_URL` | Override A2A agent URL per agent | From `agents.json` |
| `CREWAI_URL` | CrewAI FastAPI wrapper URL | `http://localhost:8000` |
| `CREWAI_MODE` | `single` or `crew` | `single` |

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **LLM**: Claude via `@anthropic-ai/sdk`
- **Wire Format**: [TOON](https://github.com/toon-format/toon) (parley protocol)
- **Linter/Formatter**: [Biome](https://biomejs.dev)
