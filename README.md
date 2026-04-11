# simple-implementation

A multi-protocol agent-to-agent communication system with benchmarking. Three AI agents (Atlas/Research, Sage/Creative, Bolt/Technical) collaborate to answer user requests across five protocol implementations compared side-by-side.

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
# Select specific protocols and scenarios
bun run bench --protocols v2,simple --scenarios coding-focused,agent-debate

# Filter by category
bun run bench --category technical

# Skip LLM judge (cheaper)
bun run bench --no-judge

# Override judge model
bun run bench --judge-model claude-sonnet-4-5-20250929

# Custom output directory
bun run bench --output results/
```

### External Protocol Servers (A2A, CrewAI)

```bash
./start-agents.sh
```

Requires `jq`. Launches A2A and CrewAI servers from `agents.json`. Required before benchmarking the `a2a` or `crewai` protocols.

## Protocols

| Protocol | Approach | Skill Filtering | Multi-Round Context |
|----------|----------|-----------------|---------------------|
| **v2** (tool-use) | Agentic — agents use tools (`send_message`, `get_message`, `evaluate_skills`) | Tool-based skill evaluation | Per-chain LLM history + store queries |
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

## Benchmarking

The benchmark system measures how protocol design affects response quality and cost.

### What It Measures

- **Task success rate** — binary pass/fail: did the agents answer the question?
- **Quality score** (1-5) — overall response quality
- **Multi-agent value** (1-5) — did multiple agents contribute distinct value?
- **Coordination efficiency** — output tokens / input tokens (higher = less overhead)
- **Multi-agent contribution** — composite of participation balance + judge's multi-agent value
- **Cost/tokens/latency per successful task**

### Scenarios

Eight built-in scenarios across categories:

- **Technical:** coding-focused, build-rest-node
- **Creative:** creative-philosophical
- **Multi-round:** agent-debate, synthesis-required
- **Mixed:** ambiguous-routing, domain-shifting
- **General:** adversarial-edge

### Output

`bun run bench` writes to `benchmark/results/`:
- `benchmark-YYYY-MM-DD.json` — full structured data
- `benchmark-YYYY-MM-DD.md` — summary table, per-scenario results, key findings, per-round appendix

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | (required) |
| `MODEL` | Claude model for agents | `claude-haiku-4-5-20251001` |
| `JUDGE_MODEL` | Claude model for LLM judge | `claude-sonnet-4-5-20250929` |
| `LOG_LEVEL` | Logging level | `INFO` |
| `A2A_{KEY}_URL` | Override A2A agent URL per agent | From `agents.json` |
| `CREWAI_URL` | CrewAI FastAPI wrapper URL | `http://localhost:8000` |
| `CREWAI_MODE` | `single` or `crew` | `single` |

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **LLM**: Claude via `@anthropic-ai/sdk`
- **Wire Format**: [TOON](https://github.com/toon-format/toon) (v2 protocol)
- **Linter/Formatter**: [Biome](https://biomejs.dev)
