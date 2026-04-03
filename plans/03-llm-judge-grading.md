# Plan 03: LLM-as-Judge Grading

**Execution order**: 3 of 4 (depends on Plans 01 and 02)

## Goal

Add an independent LLM-based evaluation layer that scores agent responses on multiple quality dimensions after each benchmark scenario. The judge is protocol-agnostic, receives only the user prompt and `AgentResult[]` array (plus history for multi-round), and returns structured scores with reasoning. Judge token usage is tracked separately. An optional `JUDGE_MODEL` env var allows using a stronger model than the agents.

## Dependencies

- **Plan 01**: `src/bench/runner.ts`, `BenchmarkResult` type, `bench.ts` CLI
- **Plan 02**: `RoundResult` with per-round `AgentResult[]`, conversation history accumulation

## Files to Create

| File | Purpose |
|------|---------|
| `src/bench/judge.ts` | Core judge: prompt construction, LLM call, response parsing |
| `src/bench/judge-types.ts` | All judge-related TypeScript interfaces |
| `src/bench/judge-prompt.ts` | System prompt, rubric text, user prompt builder |

## Files to Modify

| File | Change |
|------|--------|
| `src/bench/runner.ts` | Call judge after each scenario, attach scores to results |
| `src/bench/types.ts` | Add `JudgeScores` to result types |
| `bench.ts` | Add `--judge`/`--no-judge` and `--judge-model` CLI flags |

## Scoring Dimensions

| Dimension | 1 (Poor) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|---------------|
| **relevance** | Off-topic | Addresses request with tangents | Directly and fully addresses request |
| **information_density** | Verbose, filler-heavy | Reasonable content/token ratio | Every sentence adds value |
| **redundancy** | Agents repeat each other entirely | Some overlap, each adds value | Each agent contributes distinct content |
| **summarization_quality** | Misses key points | Captures main points, misses nuance | Comprehensive, accurate, well-structured |
| **coherence** | (multi-round only) Contradicts prior context | Follows context, misses references | Seamlessly builds on prior exchanges |

For single-round scenarios, `coherence` is omitted and weights redistribute.

## Step-by-Step Implementation

### Step 1: Define judge types (`src/bench/judge-types.ts`)

```typescript
interface DimensionScore {
  dimension: string;
  score: number;         // 1-5 integer
  reasoning: string;     // 1-3 sentence explanation
}

interface JudgeEvaluation {
  dimensions: DimensionScore[];
  overall: number;           // weighted average, 1.0-5.0
  summary: string;           // 2-4 sentence overall assessment
}

interface JudgeUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  durationMs: number;
  callCount: number;
}

interface JudgeResult {
  perRound: JudgeEvaluation[];
  aggregate: JudgeEvaluation;
  usage: JudgeUsage;
}

interface JudgeConfig {
  model?: string;        // defaults to JUDGE_MODEL env or "claude-sonnet-4-5-20250929"
  enabled: boolean;      // --no-judge sets false
  dimensions?: string[]; // subset to evaluate (default: all)
}
```

### Step 2: Judge prompt (`src/bench/judge-prompt.ts`)

**System prompt** establishes role, output format, and rubric:
```
You are an expert evaluator assessing AI agent responses in a multi-agent system.
You will receive user requests and agent responses.
You MUST evaluate using the "evaluate" tool. Score each dimension 1-5.
[...rubric definitions...]
Scoring guidelines:
- Be strict but fair. 3 = "acceptable."
- Reserve 5 for genuinely excellent.
- Evaluate agents as a collective system.
- For redundancy, lower = more redundancy (bad). 5 = agents complemented each other.
```

**User prompt builder** (`buildJudgeUserPrompt`):
```
## Scenario

### Round 1
**User:** <message>
**Agent: Atlas - Research** (skills: general-knowledge, research)
<response>
**Agent: Bolt - Technical** (skills: coding, technical)
<response>

### Round 2
...

## Instructions
Evaluate the agents' collective performance. Use the "evaluate" tool.
```

### Step 3: Implement judge (`src/bench/judge.ts`)

Uses **forced tool-use** for guaranteed structured output:

```typescript
const EVALUATE_TOOL: Anthropic.Messages.Tool = {
  name: "evaluate",
  description: "Submit evaluation scores for agent responses.",
  input_schema: {
    type: "object",
    properties: {
      dimensions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dimension: { type: "string", enum: [...] },
            score: { type: "integer", minimum: 1, maximum: 5 },
            reasoning: { type: "string", maxLength: 500 },
          },
          required: ["dimension", "score", "reasoning"],
        },
      },
      summary: { type: "string", maxLength: 1000 },
    },
    required: ["dimensions", "summary"],
  },
};
```

Main function:
```typescript
export async function evaluateScenario(
  rounds: { userMessage: string; results: AgentResult[] }[],
  config: JudgeConfig,
): Promise<JudgeResult>
```

Logic:
1. Determine model from `config.model` > `JUDGE_MODEL` env > `"claude-sonnet-4-5-20250929"`
2. Detect multi-round (`rounds.length > 1`). If single-round, exclude `coherence`.
3. Build user prompt via `buildJudgeUserPrompt()`
4. Call `client.messages.create` with `tool_choice: { type: "tool", name: "evaluate" }`
5. Extract `tool_use` block, parse scores
6. Validate scores are 1-5 integers, default 3 for missing/invalid
7. Compute weighted `overall` average
8. Track judge token usage separately

### Step 4: Integrate into runner

After scenario completion:
```typescript
if (judgeConfig.enabled) {
  const judgeResult = await evaluateScenario(roundData, judgeConfig);
  scenarioResult.judge = judgeResult;
}
```

### Step 5: Extend result types

Add `judge?: JudgeResult` to scenario result type. Add `judgeAverages` and `judgeUsage` to benchmark summary.

### Step 6: CLI flags

- `--judge` (default: true)
- `--no-judge` (disable for cheaper runs)
- `--judge-model <model>` (override judge model)

## Key Decisions

1. **Forced tool-use over free-form JSON**: Guarantees response shape, avoids fragile parsing. Already used in `src/protocols/default_v2/tools.ts`.
2. **One judge call per scenario, not per round**: More token-efficient, gives full context for coherence scoring. A `--judge-per-round` flag can be added later.
3. **Default judge model is Sonnet** (stronger than default Haiku agents): Reduces risk of judge being less capable than agents. Judge calls are few, so cost is acceptable.
4. **Integer 1-5 scale**: Most validated in LLM-as-judge literature. Coarse enough for reliable LLM scoring, fine enough to differentiate quality.
5. **Protocol-agnostic judge**: Receives only prompts + results, no protocol internals. Evaluates response quality as an end user would perceive it.
6. **Separate Anthropic client**: Keeps judge usage isolated from agent metrics.
