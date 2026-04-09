# Understanding Benchmark Results

This document explains how to read and interpret the output from `compare.ts` (and `bench.ts`). The comparison system produces two files per run: a JSON file with raw data and a Markdown report with tables and analysis.

## Output Files

Running `bun run compare.ts` produces:

```
results/comparison-YYYY-MM-DD.json   # Machine-readable raw data
results/comparison-YYYY-MM-DD.md     # Human-readable report
```

Running `bun run bench.ts` produces:

```
results/benchmark.json               # Flat results, no cross-protocol comparison
```

The comparison report is the primary artifact for analysis. The JSON file is useful for custom analysis or re-processing.

---

## Reading the Markdown Report

### Executive Summary

States which protocol scored highest on average. This is the quick answer to "which protocol produced the best responses?"

> **v2** achieved the highest average judge score of **4.7/5.0**.

A high average judge score doesn't mean a protocol is "best" in all dimensions — it may come with much higher token cost or latency.

### Overall Comparison Table

```
| Protocol | Input Tok | Output Tok | Cost     | Duration | Judge Avg |
|----------|-----------|------------|----------|----------|-----------|
| v1       | 13,075    | 7,299      | $0.0397  | 110.8s   | 2.4       |
| v2       | 298,304   | 19,041     | $0.3148  | 169.3s   | 4.7       |
| simple   | 33,687    | 18,322     | $0.1002  | 75.0s    | 4.0       |
```

**How to read it:**

- **Input Tok / Output Tok**: Total tokens consumed across all scenarios. Input tokens are what was sent to the model; output tokens are what the model generated. Higher input tokens generally mean the protocol is sending more context (system prompts, message history, tool definitions, TOON encoding).
- **Cost**: Dollar cost based on per-model pricing. Directly proportional to token counts.
- **Duration**: Wall-clock time across all scenarios. Includes LLM latency, protocol processing, and any overhead from multi-agent coordination.
- **Judge Avg**: Mean LLM judge score (1.0–5.0) across all scenarios. This is a weighted average of the individual scoring dimensions.

**What to look for:**

- Compare **cost vs. judge score** to assess the quality/cost tradeoff. In the example, v2 costs 3x more than simple but scores 0.7 points higher.
- Compare **duration** to understand user-perceived latency. Simple is fastest because it makes parallel direct calls with no protocol overhead.
- v1's low input tokens can be misleading — if judge scores are also low, the protocol may be losing context rather than being efficient.

### Protocol Overhead Table

```
| vs Simple | +Input Tok        | +Output Tok       | +Duration          |
|-----------|-------------------|-------------------|--------------------|
| v1        | -5,153 (-50.5%)   | -2,756 (-55.0%)   | 9.0s (+65.8%)      |
| v2        | 66,154 (+876.5%)  | 180 (+33.0%)       | 23.6s (+131.0%)    |
```

This measures each protocol's overhead compared to `simple` (the baseline with no protocol machinery).

**How to read it:**

- **Positive values** mean the protocol used *more* tokens/time than simple.
- **Negative values** mean the protocol used *fewer* tokens/time. This typically happens when skill-based routing filters agents — fewer agents responding means fewer total tokens.
- **Percentages** show the relative difference. "+876.5%" means v2 used nearly 10x the input tokens of simple.

**What to look for:**

- v1 often shows **negative** token overhead because it routes to fewer agents, but this can hurt quality (judge scores drop if relevant agents are excluded).
- v2 shows **high input overhead** because its tool-use architecture requires sending tool definitions, chain history, and store queries in every LLM call.
- Duration overhead reflects extra LLM round-trips (v1: skill eval + response; v2: potentially multiple tool-use turns).

### Per-Scenario Sections

Each scenario has four subsections:

#### Token Usage

```
| Protocol | Round | Input | Output | Duration |
|----------|-------|-------|--------|----------|
| v1       | 1     | 386   | 945    | 7.0s     |
| v2       | 1     | 0     | 0      | 9.5s     |
| simple   | 1     | 694   | 2,668  | 5.7s     |
```

Shows per-round, per-protocol token usage.

**What to look for:**

- **v2 showing 0/0 tokens**: This means the v2 agents responded but their token usage was tracked at the aggregate level (through tool-use turns), not attributed to individual rounds. Check the overall scenario totals instead.
- **Input tokens growing across rounds**: Normal for `simple` — it sends full conversation history each round. v1 doesn't do this (each round is independent to the LLM), which is why v1 input stays flat but coherence suffers.
- **Simple's input tokens increasing per round**: Demonstrates context accumulation. Round 3 input > Round 1 input because the full history is sent.

#### Judge Scores

```
| Dimension             | v1 | v2 | simple |
|-----------------------|----|----|--------|
| relevance             | 2  | 5  | 4      |
| information_density   | 3  | 4  | 3      |
| redundancy            | 5  | 5  | 2      |
| summarization_quality | 2  | 5  | 4      |
| coherence             | 1  | 5  | 4      |
| **overall**           | 2.7| 4.8| 3.4    |
```

**Scoring dimensions explained:**

| Dimension | What It Measures | 1 (Poor) | 5 (Excellent) |
|-----------|------------------|----------|---------------|
| **relevance** | Does the response address the user's actual request? | Off-topic | Directly addresses everything |
| **information_density** | Content per token — is every sentence useful? | Verbose filler | Every sentence adds value |
| **redundancy** | Do multiple agents repeat each other? (Higher = less redundancy = better) | Complete overlap between agents | Each agent contributes something unique |
| **summarization_quality** | Are key points captured accurately? | Misses important things | Comprehensive and well-structured |
| **coherence** | (Multi-round only) Does the response build on prior rounds? | Contradicts or ignores prior context | Seamlessly continues the conversation |

**The overall score** is a weighted average:
- Single-round: relevance (35%), information_density (25%), redundancy (20%), summarization_quality (20%)
- Multi-round: relevance (30%), information_density (20%), redundancy (20%), summarization_quality (20%), coherence (10%)

**What to look for:**

- **v1 coherence = 1**: This is v1's known weakness. `ClaudeBrain.generateResponse()` sends only the current message to the LLM with no conversation history, so the agent can't reference prior rounds. The judge heavily penalizes this.
- **simple redundancy = 2**: Simple always sends every agent, so all three respond even when only one is relevant. The overlapping responses score poorly on redundancy.
- **v2 high across the board**: v2 maintains per-chain LLM history and has tool access to the message store, giving it the richest context. The tradeoff is token cost.

#### Agent Participation

```
| Agent              | v1  | v2  | simple |
|--------------------|-----|-----|--------|
| Bolt - Technical   | 3/3 | 2/3 | 3/3    |
| Atlas - Research   | 0/3 | 0/3 | 3/3    |
| Sage - Creative    | 0/3 | 0/3 | 3/3    |
```

Shows how many rounds each agent responded in (out of total rounds).

**How to read it:**

- `3/3` means the agent responded in all 3 rounds.
- `0/3` means the agent declined every round (skill filtering determined the request wasn't relevant).
- Simple always shows full participation because it has no skill filtering — all agents always respond.

**What to look for:**

- **v1/v2 filtering correctly**: For a "Coding Focused" scenario, only Bolt responding is the *desired* behavior — Atlas and Sage have nothing useful to add.
- **v1/v2 filtering incorrectly**: If a relevant agent shows 0/N, the skill evaluation may be too aggressive. Check the judge's relevance score to see if it noticed.
- **Simple's redundancy cost**: All agents responding every round explains simple's high redundancy scores and higher total output tokens.

#### Notable Observations

Auto-generated bullets flagging patterns:

- **"significant protocol overhead"**: Input tokens >50% higher than simple.
- **"protocol routing filtered to N agent(s)"**: v1/v2 used skill-based selection to reduce responding agents.
- **"simple produces more redundant responses"**: Judge scored simple's redundancy lower than v1.

These are heuristic — read them as starting points for investigation, not conclusions.

### Agent Analysis

```
| Agent              | v1 | v2 | simple |
|--------------------|----|----|--------|
| Bolt - Technical   | 12 | 6  | 14     |
| Atlas - Research   | 23 | 9  | 14     |
| Sage - Creative    | 24 | 7  | 14     |
```

Aggregate response counts across all scenarios. Simple is always equal (all agents, all rounds). v1/v2 numbers reveal routing behavior:

- v2 being lower than v1 suggests v2's skill filtering is stricter.
- v1's Atlas (23) and Sage (24) being much higher than expected may indicate v1's skill evaluation is too permissive for some scenarios (the agent responds but without useful context, explaining low scores).

### Key Findings

Three auto-generated takeaways covering overhead, quality tradeoff, and latency. These use the aggregate numbers and should be interpreted alongside the per-scenario details.

---

## Reading the JSON File

The JSON file has this top-level structure:

```json
{
  "generatedAt": "ISO timestamp",
  "model": "claude-haiku-4-5-20251001",
  "scenarios": [ ... ],
  "aggregate": { ... }
}
```

### `scenarios` Array

Each entry is a `ScenarioComparison`:

```json
{
  "scenario": {
    "id": "coding-focused",
    "name": "Coding Focused",
    "category": "technical",
    "topic": "LRU cache implementation",
    "rounds": [{ "message": "..." }, ...]
  },
  "results": {
    "v1": { ... },
    "v2": { ... },
    "simple": { ... }
  },
  "protocolOverhead": {
    "v1VsSimple": { ... },
    "v2VsSimple": { ... }
  }
}
```

Each protocol result (`results.v1`, etc.) contains:

- `rounds[]`: Per-round data with `agents[]` (each agent's `responseText`, `inputTokens`, `outputTokens`, `cost`, `durationMs`), round-level totals, and `respondingAgentCount`.
- `aggregate`: Totals across all rounds (`totalInputTokens`, `totalOutputTokens`, `totalCost`, `totalDurationMs`, `averageAgentsPerRound`, `roundCount`).
- `judge`: The full judge evaluation (see below).

### Judge Structure

```json
{
  "judge": {
    "perRound": [{
      "dimensions": [
        { "dimension": "relevance", "score": 2, "reasoning": "..." },
        ...
      ],
      "overall": 2.7,
      "summary": "Multi-sentence assessment..."
    }],
    "aggregate": { ... },
    "usage": {
      "inputTokens": 3412,
      "outputTokens": 765,
      "model": "claude-sonnet-4-5-20250929",
      "durationMs": 19275,
      "callCount": 1
    }
  }
}
```

- **`dimensions[].reasoning`**: The judge's explanation for each score. This is the most useful field for understanding *why* a protocol scored the way it did.
- **`summary`**: A holistic assessment across all dimensions and rounds.
- **`usage`**: Judge token consumption — tracked separately from agent tokens so you know the evaluation cost.

### `aggregate` Object

```json
{
  "avgScores": { "v1": 2.4, "v2": 4.7, "simple": 4.0 },
  "avgOverhead": { "v1VsSimple": { ... }, "v2VsSimple": { ... } },
  "agentParticipation": {
    "Bolt - Technical": { "v1": 12, "v2": 6, "simple": 14 },
    ...
  }
}
```

- **`avgScores`**: Mean judge overall score per protocol across all scenarios.
- **`avgOverhead`**: Mean overhead metrics per protocol. Contains `extraInputTokens`, `extraOutputTokens`, `extraInputPercent`, `extraOutputPercent`, `extraDurationMs`, `extraDurationPercent`.
- **`agentParticipation`**: Total round-responses per agent per protocol.

---

## Common Patterns to Watch For

**v1 scores low on coherence but high on redundancy**: v1 sends each message independently (no history), so it can't maintain conversation flow. But because it routes to fewer agents, there's less overlap.

**v2 has very high input tokens but comparable output**: v2's tool-use architecture sends tool schemas, chain history, and store query results as input context. The actual agent responses (output) are similar in length to other protocols.

**v2 shows 0/0 tokens for early rounds**: v2's token accounting attributes usage to the round where the final RESPONSE is sent. Earlier rounds may show zero if the agent's tool-use turns haven't resolved yet.

**Simple always has the lowest cost but middling quality**: No overhead, but also no intelligent routing — every agent responds to every message, including irrelevant ones. Good baseline, but the redundancy penalty drags scores down.

**Judge scores cluster around 3-4 for simple**: The judge considers 3 "acceptable." Simple produces serviceable but not exceptional output since it lacks the context management of v2 or the routing of v1.
