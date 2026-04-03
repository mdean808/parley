# Plan 02: Multi-Round Conversations

**Execution order**: 2 of 4 (depends on Plan 01)

## Goal

Add multi-round conversation support to the benchmark system so scenarios can run N sequential rounds where agent responses feed back as input for the next round. Per-round AND cumulative metrics are tracked. This enables benchmarking "agents talking to each other" and measuring how protocol overhead compounds across conversation depth.

## Dependency

Plan 01 must deliver: `bench.ts`, `src/bench/types.ts`, `src/bench/runner.ts`, `src/bench/scenarios.ts`.

## Files to Create

| File | Purpose |
|------|---------|
| `src/bench/multi-round.ts` | Core multi-round loop, protocol-agnostic |
| `src/bench/synthesizers.ts` | Built-in functions that transform agent responses into next-round prompts |

## Files to Modify

| File | Change |
|------|--------|
| `src/bench/types.ts` | Add `MultiRoundConfig`, `RoundSynthesizer`, `RoundMetrics`, `MultiRoundResult` |
| `src/bench/runner.ts` | Detect `multiRound` config, delegate to `runMultiRound` |
| `src/protocols/default_v1/protocol.ts` | **One-line fix**: respect provided `chainId` instead of always generating new one |
| `bench.ts` | Add multi-round scenario definitions |

## Step-by-Step Implementation

### Step 1: Extend benchmark types

Add to `src/bench/types.ts`:

```typescript
type RoundSynthesizer = (
  roundIndex: number,
  previousResults: AgentResult[],
  originalPrompt: string,
) => string;

interface MultiRoundConfig {
  rounds: number;
  synthesizer?: RoundSynthesizer;
  stopCondition?: (roundIndex: number, results: AgentResult[]) => boolean;
}

interface RoundMetrics {
  roundIndex: number;
  prompt: string;
  results: AgentResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  cost: number;
}

interface MultiRoundResult {
  scenarioName: string;
  protocol: string;
  rounds: RoundMetrics[];
  cumulative: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
    totalCost: number;
    roundCount: number;
    stoppedEarly: boolean;
  };
}
```

Add optional `multiRound?: MultiRoundConfig` to `ScenarioConfig`.

### Step 2: Build synthesizers (`src/bench/synthesizers.ts`)

Three built-in `RoundSynthesizer` implementations:

- **`concatenateSynthesizer`** (default): Joins all agent response payloads with agent name headers:
  ```
  Previous round responses:
  [Atlas - Research]: <payload>
  [Sage - Creative]: <payload>
  Based on these responses, continue the conversation.
  ```

- **`summarySynthesizer`**: Formats as structured summary, asks for deeper analysis.

- **`debateSynthesizer`**: Frames responses as opposing viewpoints, asks agents to respond to each other:
  ```
  The following agents provided different perspectives:
  [Atlas] said: <payload>
  [Sage] said: <payload>
  Please respond to their points and provide your updated analysis.
  ```

### Step 3: Implement multi-round loop (`src/bench/multi-round.ts`)

```typescript
async function runMultiRound(
  scenario: ScenarioConfig,
  protocol: Protocol,
  userId: string,
  chainId: string,
): Promise<MultiRoundResult>
```

The loop:
1. **Round 0**: Send `scenario.prompt` via `protocol.sendRequest(userId, prompt, chainId)`
2. Collect `AgentResult[]`, compute `RoundMetrics`
3. Check `stopCondition` -- if true, mark `stoppedEarly` and break
4. **Rounds 1..N-1**: Call `synthesizer(roundIndex, previousResults, scenario.prompt)` to get next prompt
5. Send synthesized prompt via same `chainId` for context continuity
6. Repeat metrics collection and stop condition check
7. After all rounds, compute cumulative totals

### Step 4: Fix v1 chainId passthrough

In `src/protocols/default_v1/protocol.ts`, line ~103:

```typescript
// Change from:
const chainId: string = crypto.randomUUID();
// To:
const chainId: string = _chainId ?? crypto.randomUUID();
```

Rename `_chainId` parameter to `chainId` (remove underscore). This is critical for v1 multi-round context.

### Step 5: Wire into runner (`src/bench/runner.ts`)

Detect `scenario.multiRound`:
- If present and `rounds > 1`: call `runMultiRound`
- Otherwise: run single-round as Plan 01 defines

### Step 6: Add multi-round scenarios to `bench.ts`

- **"multi-round-deepening"** (3 rounds): Broad question, deepen each round
- **"agent-debate"** (4 rounds): Controversial topic with `debateSynthesizer`
- **"follow-up-chain"** (2 rounds): Question + clarifying follow-up

## How Context Flows Per Protocol

### Simple Protocol
- **Mechanism**: `this.histories` Map of per-agent `MessageParam[]` arrays
- **Between rounds**: Nothing special. Each `sendRequest` appends to existing history. Round N+1 sees all prior rounds.
- **Limitation**: Per-agent only. Agent A never sees what Agent B said. The synthesizer bridges this.

### v1 (State Machine + TOON)
- **Mechanism**: `store.getMessages({ chainId })` returns all chain messages
- **Between rounds**: Same `chainId` across rounds. Store accumulates messages.
- **Key gap**: `ClaudeBrain.generateResponse` sends only a single message to the LLM -- no conversation history. The synthesizer must embed prior context directly in the prompt text.
- **Design choice**: The benchmark measures whether v1's protocol overhead helps or hurts compared to simple's native history.

### v2 (Tool-Use + TOON)
- **Mechanism**: `chainHistory` Map in `ProtocolAgentV2` maintains per-chain `MessageParam[]`. Agents also have `get_message` tool to query the store.
- **Between rounds**: Same `chainId`. Agent retrieves existing history and appends new messages. LLM sees full tool-use conversation history.
- **Key advantage**: Richest multi-round support. Combines chain-level LLM history AND store-queryable cross-agent visibility.

## Key Decisions

1. **Same chainId across rounds**: Enables v2's chainHistory accumulation and store querying. For v1, the synthesizer compensates for lack of native history.
2. **Synthesizer is a plain function, not LLM**: Keeps benchmark overhead deterministic. We measure protocol overhead, not synthesis quality.
3. **All agents respond every round by default**: Agents can still decline via skill matching. The benchmark records who responded per round.
4. **Stop conditions are optional**: Most scenarios run all N rounds. Stop conditions exist for convergence detection.
5. **v1 chainId fix is backward-compatible**: The interactive REPL already passes a chainId that v1 currently ignores -- this fix makes v1 actually use it.
