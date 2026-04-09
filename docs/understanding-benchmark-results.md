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

### Protocol Overhead Table

```
| vs Simple | +Input Tok        | +Output Tok       | +Duration          |
|-----------|-------------------|-------------------|--------------------|
| v2        | 66,154 (+876.5%)  | 180 (+33.0%)       | 23.6s (+131.0%)    |
```

This measures v2's overhead compared to `simple` (the baseline with no protocol machinery).

**How to read it:**

- **Positive values** mean the protocol used *more* tokens/time than simple.
- **Negative values** mean the protocol used *fewer* tokens/time. This can happen when skill-based routing filters agents — fewer agents responding means fewer total tokens.
- **Percentages** show the relative difference. "+876.5%" means v2 used nearly 10x the input tokens of simple.

**What to look for:**

- v2 shows **high input overhead** because its tool-use architecture requires sending tool definitions, chain history, and store queries in every LLM call.
- Duration overhead reflects extra LLM round-trips (v2 may require multiple tool-use turns per agent response).

### Per-Scenario Sections

Each scenario has four subsections:

#### Token Usage

```
| Protocol | Round | Input | Output | Duration |
|----------|-------|-------|--------|----------|
| v2       | 1     | 0     | 0      | 9.5s     |
| simple   | 1     | 694   | 2,668  | 5.7s     |
```

Shows per-round, per-protocol token usage.

**What to look for:**

- **v2 showing 0/0 tokens**: This means the v2 agents responded but their token usage was tracked at the aggregate level (through tool-use turns), not attributed to individual rounds. Check the overall scenario totals instead.
- **Input tokens growing across rounds**: Normal for `simple` — it sends full conversation history each round. Round 3 input > Round 1 input because the full history is sent.

#### Judge Scores

```
| Dimension             | v2 | simple |
|-----------------------|----|--------|
| relevance             | 5  | 4      |
| information_density   | 4  | 3      |
| redundancy            | 5  | 2      |
| summarization_quality | 5  | 4      |
| coherence             | 5  | 4      |
| **overall**           | 4.8| 3.4    |
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

- **simple redundancy = 2**: Simple always sends every agent, so all three respond even when only one is relevant. The overlapping responses score poorly on redundancy.
- **v2 high across the board**: v2 maintains per-chain LLM history and has tool access to the message store, giving it the richest context. The tradeoff is token cost.

#### Agent Participation

```
| Agent              | v2  | simple |
|--------------------|-----|--------|
| Bolt - Technical   | 2/3 | 3/3    |
| Atlas - Research   | 0/3 | 3/3    |
| Sage - Creative    | 0/3 | 3/3    |
```

Shows how many rounds each agent responded in (out of total rounds).

**How to read it:**

- `3/3` means the agent responded in all 3 rounds.
- `0/3` means the agent declined every round (skill filtering determined the request wasn't relevant).
- Simple always shows full participation because it has no skill filtering — all agents always respond.

**What to look for:**

- **v2 filtering correctly**: For a "Coding Focused" scenario, only Bolt responding is the *desired* behavior — Atlas and Sage have nothing useful to add.
- **v2 filtering incorrectly**: If a relevant agent shows 0/N, the skill evaluation may be too aggressive. Check the judge's relevance score to see if it noticed.
- **Simple's redundancy cost**: All agents responding every round explains simple's high redundancy scores and higher total output tokens.

#### Notable Observations

Auto-generated bullets flagging patterns:

- **"significant protocol overhead"**: Input tokens >50% higher than simple.
- **"protocol routing filtered to N agent(s)"**: v2 used skill-based selection to reduce responding agents.

These are heuristic — read them as starting points for investigation, not conclusions.

### Agent Analysis

```
| Agent              | v2 | simple |
|--------------------|----|----|
| Bolt - Technical   | 6  | 14     |
| Atlas - Research   | 9  | 14     |
| Sage - Creative    | 7  | 14     |
```

Aggregate response counts across all scenarios. Simple is always equal (all agents, all rounds). v2 numbers reveal routing behavior — lower counts indicate skill filtering is working to exclude irrelevant agents.

### Key Findings

Auto-generated takeaways covering overhead, quality tradeoff, and latency. These use the aggregate numbers and should be interpreted alongside the per-scenario details.

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
    "v2": { ... },
    "simple": { ... }
  },
  "protocolOverhead": {
    "v2VsSimple": { ... }
  }
}
```

Each protocol result (`results.v2`, etc.) contains:

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
  "avgScores": { "v2": 4.7, "simple": 4.0 },
  "avgOverhead": { "v2VsSimple": { ... } },
  "agentParticipation": {
    "Bolt - Technical": { "v2": 6, "simple": 14 },
    ...
  }
}
```

- **`avgScores`**: Mean judge overall score per protocol across all scenarios.
- **`avgOverhead`**: Mean overhead metrics per protocol. Contains `extraInputTokens`, `extraOutputTokens`, `extraInputPercent`, `extraOutputPercent`, `extraDurationMs`, `extraDurationPercent`.
- **`agentParticipation`**: Total round-responses per agent per protocol.

---

## Common Patterns to Watch For

**v2 has very high input tokens but comparable output**: v2's tool-use architecture sends tool schemas, chain history, and store query results as input context. The actual agent responses (output) are similar in length to simple.

**v2 shows 0/0 tokens for early rounds**: v2's token accounting attributes usage to the round where the final RESPONSE is sent. Earlier rounds may show zero if the agent's tool-use turns haven't resolved yet.

**Simple always has the lowest cost but middling quality**: No overhead, but also no intelligent routing — every agent responds to every message, including irrelevant ones. Good baseline, but the redundancy penalty drags scores down.

**Judge scores cluster around 3-4 for simple**: The judge considers 3 "acceptable." Simple produces serviceable but not exceptional output since it lacks the context management and routing of v2.
