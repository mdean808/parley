# Plan 01: Benchmark Runner

**Execution order**: 1 of 4 (no dependencies)

## Goal

Create a standalone benchmark runner (`bench.ts`) that programmatically executes predefined conversation scenarios across all three protocol implementations (v1 state-machine, v2 tool-use, simple direct), collects structured per-round and aggregate metrics (tokens, cost, latency, responding agents, response text), writes results to a JSON file, and prints a terminal summary table.

## Files to Create

| File | Purpose |
|------|---------|
| `bench.ts` | Entry point. Parses config, orchestrates scenario execution, writes JSON, prints summary. |
| `src/bench/types.ts` | All benchmark-specific type definitions. |
| `src/bench/runner.ts` | Core runner: takes a Protocol + scenario config, executes rounds, returns structured results. |
| `src/bench/scenarios.ts` | Built-in scenario definitions. |
| `src/bench/cost.ts` | Shared pricing logic (extracted from display.ts). |

## Files to Modify

| File | Change |
|------|--------|
| `src/chat/display.ts` | Import `PRICING` from `src/bench/cost.ts` instead of defining locally. |

## Step-by-Step Implementation

### Step 1: Define benchmark types (`src/bench/types.ts`)

```typescript
import type { AgentResult } from "../types.ts";

export type ProtocolId = "v1" | "v2" | "simple";

export interface ScenarioRound {
  prompt: string;
}

export interface ScenarioConfig {
  name: string;
  topic: string;
  rounds: ScenarioRound[];
  protocols?: ProtocolId[];
}

export interface AgentRoundResult {
  agentName: string;
  skills: string[];
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  model: string;
}

export interface RoundResult {
  roundIndex: number;
  prompt: string;
  agents: AgentRoundResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalDurationMs: number;
  respondingAgentCount: number;
}

export interface ProtocolRunResult {
  protocolId: ProtocolId;
  scenarioName: string;
  rounds: RoundResult[];
  aggregate: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    totalDurationMs: number;
    averageAgentsPerRound: number;
    roundCount: number;
  };
}

export interface BenchmarkOutput {
  timestamp: string;
  model: string;
  scenarios: ProtocolRunResult[];
}

export interface BenchOptions {
  outputPath?: string;
  protocols?: ProtocolId[];
  scenarios?: ScenarioConfig[];
}
```

### Step 2: Extract shared pricing (`src/bench/cost.ts`)

```typescript
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
};

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  model: string,
): number {
  const pricing = PRICING[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
```

Update `src/chat/display.ts` to import from `../bench/cost.ts`. Remove the local `PRICING` constant. Update `agentStats` and `summaryBlock` to use `computeCost()`.

### Step 3: Built-in scenarios (`src/bench/scenarios.ts`)

Provide default scenarios that exercise different agent routing patterns:

- **Research-only** (2 rounds): French Revolution questions
- **Creative-only** (2 rounds): Haiku writing + perspective shift
- **Technical-only** (2 rounds): Hash map explanation + TypeScript implementation
- **Mixed cross-domain** (3 rounds): Quantum computing across research/creative/technical

### Step 4: Core runner (`src/bench/runner.ts`)

```typescript
export async function runScenario(
  protocol: Protocol,
  protocolId: ProtocolId,
  scenario: ScenarioConfig,
): Promise<ProtocolRunResult>
```

- Calls `protocol.initialize("BenchUser")` once per run
- Sends each round via `protocol.sendRequest(userId, prompt, chainId)` with shared `chainId`
- Converts `AgentResult` optional fields to required numbers (default 0)
- Uses `computeCost()` for cost calculation
- Computes per-round and aggregate totals

### Step 5: Entry point (`bench.ts`)

CLI: `bun run bench.ts [--protocols v1,v2,simple] [--output path/to/results.json]`

1. Validate `ANTHROPIC_API_KEY`
2. Parse CLI args from `process.argv`
3. Instantiate each protocol (mirrors `index.ts` pattern):
   ```typescript
   function createProtocol(id: ProtocolId): Protocol {
     const personas = createAgentPersonas();
     switch (id) {
       case "v1": return new DefaultProtocol({ personas, createBrain: (_a, sp) => new ClaudeBrain(sp) });
       case "v2": return new DefaultProtocolV2({ personas });
       case "simple": return new SimpleProtocol(personas);
     }
   }
   ```
4. Run scenarios **sequentially** (not parallel) to avoid rate limiting
5. Write `BenchmarkOutput` JSON via `Bun.write()`
6. Print summary table to terminal

Summary table format:
```
Protocol  | Scenario       | Rounds | Agents/Round | Tokens (in/out) | Cost    | Duration
v1        | Research-only  | 2      | 1.0          | 1200 / 340      | $0.0023 | 4.2s
simple    | Research-only  | 2      | 3.0          | 3600 / 900      | $0.0065 | 3.8s
```

### Step 6: Update `src/chat/display.ts`

Replace local `PRICING` with import from `../bench/cost.ts`. Replace inline cost math with `computeCost()`.

## Key Decisions

1. **Sequential protocol execution**: Avoids API rate limits and resource contention. Gives clean, comparable numbers.
2. **Fresh protocol per scenario**: Prevents context leakage. v1's singleton store is handled via unique chainIds.
3. **Shared chainId across rounds**: Preserves multi-turn context for v2 and simple.
4. **No `onEvent` during benchmarks**: Suppresses terminal noise. Add via CLI flag later if needed.
5. **Flat JSON output**: Single `BenchmarkOutput` per run. Simpler than JSONL for downstream analysis.
6. **Manual arg parsing**: `process.argv` scan for two flags. No CLI library needed.
7. **`RoundResult.totalDurationMs`**: Wall-clock time (user-perceived latency), not sum of agent durations.
