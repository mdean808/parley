# Plan 04: Comparison Report

**Execution order**: 4 of 4 (depends on Plans 01, 02, and 03)

## Goal

Create the infrastructure to run structured comparison experiments across all three protocols and generate terminal + markdown report output. Includes predefined scenario files, a comparison engine, and report generators suitable for a course paper.

## Dependencies

- **Plan 01**: Benchmark runner, `ProtocolRunResult` type, JSON output
- **Plan 02**: Multi-round conversation support, per-round results
- **Plan 03**: LLM judge scores (relevance, info density, redundancy, summarization, coherence)

## Files to Create

| File | Purpose |
|------|---------|
| `src/bench/scenarios/general-knowledge.json` | Multi-round general knowledge scenario |
| `src/bench/scenarios/coding-focused.json` | Coding-focused scenario (mainly Bolt) |
| `src/bench/scenarios/creative-philosophical.json` | Creative scenario (mainly Sage) |
| `src/bench/scenarios/mixed-multi-agent.json` | Cross-domain scenario (all agents) |
| `src/bench/scenarios/index.ts` | Scenario loader: reads JSON, validates, exports typed objects |
| `src/bench/comparison.ts` | Core comparison engine: runs all protocols x scenarios |
| `src/bench/report-terminal.ts` | Terminal report renderer (chalk) |
| `src/bench/report-markdown.ts` | Markdown report generator |
| `compare.ts` | CLI entry point |

## Files to Modify

| File | Change |
|------|--------|
| `.gitignore` | Add `results/` directory |

## Step-by-Step Implementation

### Step 1: Comparison types

Add to `src/bench/types.ts`:

```typescript
interface ScenarioComparison {
  scenario: Scenario;
  results: Record<"v1" | "v2" | "simple", ScoredBenchmarkResult>;
  protocolOverhead: ProtocolOverhead;
}

interface ProtocolOverhead {
  v1VsSimple: OverheadMetrics;
  v2VsSimple: OverheadMetrics;
}

interface OverheadMetrics {
  extraInputTokens: number;
  extraOutputTokens: number;
  extraInputPercent: number;
  extraOutputPercent: number;
  extraDurationMs: number;
  extraDurationPercent: number;
}

interface ComparisonReport {
  generatedAt: string;
  model: string;
  scenarios: ScenarioComparison[];
  aggregate: AggregateComparison;
}

interface AggregateComparison {
  avgScores: Record<"v1" | "v2" | "simple", JudgeScores>;
  avgOverhead: ProtocolOverhead;
  agentParticipation: Record<string, Record<"v1" | "v2" | "simple", number>>;
}
```

### Step 2: Scenario JSON files

**`general-knowledge.json`** -- All agents relevant, 4 rounds:
1. "What were the most significant technological breakthroughs of 2024?"
2. "How might these breakthroughs change everyday life in the next decade?"
3. "Which concerns you most from an ethical standpoint?"
4. "Suggest resources or frameworks for thinking about technology ethics?"

**`coding-focused.json`** -- Mainly Bolt, 3 rounds:
1. "How would you implement an LRU cache in TypeScript?"
2. "What's the time complexity of each operation, and how would you test it?"
3. "Make it thread-safe for a concurrent environment. What changes?"

**`creative-philosophical.json`** -- Mainly Sage, 3 rounds:
1. "If a machine could dream, what would it dream about?"
2. "Write a short poem from the perspective of that dreaming machine."
3. "What does that poem reveal about the boundary between simulation and experience?"

**`mixed-multi-agent.json`** -- All agents, 4 rounds:
1. "What is RAG and why is it useful?" (research)
2. "Brainstorm creative, unconventional uses of RAG beyond chatbots." (creative)
3. "Pick the most promising idea and sketch a TypeScript implementation." (technical)
4. "Summarize everything we discussed in a concise paragraph." (synthesis)

### Step 3: Scenario loader (`src/bench/scenarios/index.ts`)

- `loadScenario(id: string): Scenario`
- `loadAllScenarios(): Scenario[]`
- `loadScenariosByCategory(category: string): Scenario[]`
- Validates non-empty `id`, non-empty `rounds`, each round has non-empty `message`

### Step 4: Comparison engine (`src/bench/comparison.ts`)

```typescript
async function runComparison(options: {
  scenarios?: string[];
  model?: string;
  outputDir?: string;
  onProgress?: (msg: string) => void;
}): Promise<ComparisonReport>
```

For each scenario:
1. Instantiate fresh v1, v2, simple protocols sequentially
2. Run all rounds via Plan 01/02 runner
3. Invoke Plan 03 judge on each result
4. Compute `ProtocolOverhead`: `extra = protocol - simple`, `percent = (extra / simple) * 100`
5. Build `ScenarioComparison`

After all scenarios: compute `AggregateComparison` (mean scores, mean overhead, agent participation rates).

**v1 singleton store issue**: Add optional `store` param to `DefaultProtocolConfig`. Fall back to singleton if not provided. ~5 line change in `protocol.ts` and `agent.ts`.

### Step 5: Terminal report (`src/bench/report-terminal.ts`)

Uses chalk (already a dependency). Manual table construction matching `display.ts` style.

**Protocol Summary Table:**
```
Protocol   | Input Tok | Output Tok | Cost     | Duration | Judge Avg
v1 (state) |   12,450  |    3,200   | $0.0228  |   45.2s  |   3.8
v2 (tools) |   18,920  |    4,100   | $0.0316  |   62.1s  |   4.1
simple     |    8,100  |    2,800   | $0.0177  |   28.4s  |   3.2
```

**Overhead Table:**
```
vs Simple  | +Input Tok  | +Output Tok | +Cost    | +Duration
v1         | +4,350      | +400        | +$0.0051 | +16.8s
           | (+53.7%)    | (+14.3%)    | (+28.8%) | (+59.2%)
v2         | +10,820     | +1,300      | +$0.0139 | +33.7s
           | (+133.6%)   | (+46.4%)    | (+78.5%) | (+118.7%)
```

**Per-Scenario Judge Scores:**
```
Scenario            | v1  | v2  | simple | Best
General Knowledge   | 3.6 | 4.2 |  3.0   | v2
Coding Focused      | 4.1 | 4.0 |  3.5   | v1
```

### Step 6: Markdown report (`src/bench/report-markdown.ts`)

Generates `results/comparison-<timestamp>.md`. Structure:

```markdown
# Protocol Comparison Report
## Executive Summary
## Methodology
## Overall Comparison (table)
## Protocol Overhead (table)
## Scenario Results (per scenario):
  ### Token Usage by Round (table)
  ### Judge Scores (table)
  ### Agent Participation (table)
  ### Notable Observations (auto-generated bullets)
## Agent Analysis (participation rates)
## Key Findings (auto-generated)
```

Auto-generated observations use heuristics:
- Overhead >50% -> "significant protocol overhead"
- Simple scores lower on redundancy -> "simple produces more redundant responses"
- Agent responds in simple but declines in v1/v2 -> "protocol routing filters irrelevant agents"
- Scores improve across rounds in v1/v2 but not simple -> "protocol enables better coherence"

### Step 7: CLI entry point (`compare.ts`)

```bash
bun run compare.ts
bun run compare.ts --scenarios general-knowledge,coding-focused
bun run compare.ts --model claude-sonnet-4-5-20250929
bun run compare.ts --output results/
```

Progress output:
```
Running comparison benchmarks...
[1/4] General Knowledge -- v1... done (12.3s)
[1/4] General Knowledge -- v2... done (18.1s)
[1/4] General Knowledge -- simple... done (8.4s)
[1/4] General Knowledge -- judging... done

Comparison complete. Results written to:
  JSON: results/comparison-2026-03-31.json
  Report: results/comparison-2026-03-31.md
```

## Key Decisions

1. **Sequential protocol runs**: Fair latency comparison, avoids rate limiting. ~3x wall clock but correctness matters more.
2. **No new dependencies**: Tables built manually with chalk. Consistent with existing `display.ts` style.
3. **v1 singleton store refactor**: Small change (optional `store` param) for clean per-scenario isolation. Backward compatible.
4. **JSON scenarios**: Pure data, easy to edit/version/generate. TypeScript loader provides type safety.
5. **Markdown report, not template engine**: Programmatic generation avoids template dependency. Full control over conditional sections.
6. **One judge call per protocol per scenario**: Not per-round. 12 judge calls total (4 scenarios x 3 protocols) is cost-reasonable.
7. **Results in `results/` directory, gitignored**: Timestamped pairs (JSON + MD) allow comparing across runs.
