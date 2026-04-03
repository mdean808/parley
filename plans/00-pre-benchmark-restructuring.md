# Plan 00: Pre-Benchmark Restructuring (COMPLETED)

**Status**: Done

## What Changed

Three shared utility modules were extracted from duplicated code across the codebase:

| New File | Exports | Purpose |
|----------|---------|---------|
| `src/cost.ts` | `PRICING`, `computeCost()` | Per-million-token pricing map + cost calculation |
| `src/config.ts` | `MODEL`, `client` | Shared model string + Anthropic SDK singleton |
| `src/factory.ts` | `createProtocol()`, `ProtocolId`, `ProtocolOptions` | Protocol instantiation by id (`"v1"`, `"v2"`, `"simple"`) |

Modified files:

| File | Change |
|------|--------|
| `src/chat/display.ts` | Removed local `PRICING`; uses `computeCost()` from `src/cost.ts` |
| `src/brain.ts` | Imports `client`/`MODEL` from `src/config.ts` (was creating its own) |
| `src/protocols/simple/protocol.ts` | Imports `client`/`MODEL` from `src/config.ts` |
| `src/protocols/default_v2/agent.ts` | Imports `client`/`MODEL` from `src/config.ts` |
| `index.ts` | Uses `createProtocol()` from `src/factory.ts` (was inline if/else) |

## Impact on Plans 01-04

### Plan 01: Benchmark Runner

- **`src/bench/cost.ts` should NOT be created.** Use `src/cost.ts` instead — it already exists with the exact same `PRICING` and `computeCost()` the plan specifies.
- **`ProtocolId` type already exists** in `src/factory.ts`. Import it, don't redefine it in `src/bench/types.ts`.
- **`createProtocol()` already exists** in `src/factory.ts`. The `bench.ts` entry point should call `createProtocol(id)` instead of duplicating the switch/case from the plan's Step 5.
- **`display.ts` modification is already done.** Skip Step 6 entirely.
- **No `onEvent` handler needed for benchmarks:** `createProtocol(id)` accepts `{ onEvent }` in its options — just omit it for silent bench runs.

### Plan 02: Multi-Round Conversations

- No direct overlap. The v1 `chainId` passthrough fix and multi-round loop are unaffected by restructuring.
- Runner code should use `createProtocol()` for protocol instantiation (same as Plan 01).

### Plan 03: LLM-as-Judge Grading

- **The judge needs its own Anthropic client**, separate from the shared `client` in `src/config.ts`, because it may use a different model (`JUDGE_MODEL` env var). Create a dedicated client in `src/bench/judge.ts` — do NOT reuse `src/config.ts`'s `client`.
- `computeCost()` from `src/cost.ts` can be used for judge cost tracking too.

### Plan 04: Comparison Report

- **`compare.ts` should use `createProtocol()` from `src/factory.ts`** for all protocol instantiation, not inline construction.
- Use `computeCost()` from `src/cost.ts` for report cost columns.
- `ProtocolId` from `src/factory.ts` can be used in comparison types (e.g., `Record<ProtocolId, ScoredBenchmarkResult>`).
