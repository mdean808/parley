# Benchmark System Design

## Philosophy

The benchmark tests **protocol interaction quality**, not LLM knowledge. It answers: "Does the right agent pick up the request? Can agents hand off work? Do they collaborate without redundancy?" Content correctness is a secondary sanity check.

## Priority Order

1. **Routing quality** — Does the right agent respond to the right request?
2. **Handoff/delegation** — Can agents pass work to a better-suited agent?
3. **Collaboration** — Do multiple agents contribute distinct, non-redundant pieces?

## Scenario Format: Probes

Each scenario is a minimal, single-shot probe:

```json
{
  "id": "route-clear-technical",
  "prompt": "Can you help me debug this Python function that's throwing a KeyError?",
  "pattern": "single-route",
  "targetSkills": ["technical", "coding"],
  "expect": {
    "agentCount": { "max": 1 },
    "requiredSkills": ["technical"],
    "excludedSkills": ["creative"]
  }
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | yes | Unique probe identifier |
| `prompt` | `string` | yes | The user message sent to the protocol |
| `pattern` | `string` | yes | Interaction pattern being tested |
| `targetSkills` | `string[]` | yes | Skill categories that should be involved |
| `expect` | `object` | yes | Structured assertions for pass/fail |

### Expect Assertions

| Field | Type | Description |
|---|---|---|
| `agentCount` | `{min?, max?}` | How many agents should respond |
| `requiredSkills` | `string[]` | At least one responding agent must have each of these |
| `excludedSkills` | `string[]` | No responding agent should have these |

Scenarios are **skill-aware but not name-aware** — they reference skill categories like "technical", "creative", "analytical" but never hardcode agent names like "Atlas" or "Nova".

## Interaction Patterns

Five patterns, mapped to the priority order:

| Pattern | Tests | What "good" looks like |
|---|---|---|
| `single-route` | Routing | One agent with matching skills responds. Others stay quiet. |
| `selective-route` | Routing | Multiple agents *could* answer, but only the best-fit does. |
| `decline-all` | Routing | Request is outside all agents' skills. Agents honestly say so or none claim it. |
| `handoff` | Delegation | Initial agent recognizes it needs to pass to another and does so cleanly. |
| `collaborate` | Collaboration | Multiple agents contribute distinct, non-redundant pieces. |

### Typical Assertions Per Pattern

- **`single-route`**: `agentCount.max: 1`, `requiredSkills: [target]`
- **`selective-route`**: `agentCount.max: 1`, `requiredSkills: [best-fit]`, `excludedSkills: [worse-fit]`
- **`decline-all`**: `agentCount.max: 0`
- **`handoff`**: `requiredSkills: [skillA, skillB]` (both domains must appear)
- **`collaborate`**: `agentCount.min: 2`, `requiredSkills: [skillA, skillB]`

## Two-Layer Evaluation

### Layer 1: Assertions (no LLM, milliseconds)

Structured assertions are checked immediately after the protocol run. If assertions fail, the probe fails — no judge tokens spent.

### Layer 2: Judge (LLM, pattern-aware rubric)

Only runs on probes that pass assertions. Each pattern has its own rubric.

#### Routing Rubric (`single-route`, `selective-route`, `decline-all`)

| Dimension | What it checks |
|---|---|
| `promptRelevance` | Does the responding agent's reply actually address the request? |
| `skillAlignment` | Does the response reflect the agent's claimed skill domain? |
| `cleanBoundaries` | Did non-responding agents stay quiet rather than chiming in with noise? |

#### Handoff Rubric

| Dimension | What it checks |
|---|---|
| `handoffClarity` | Did the first agent clearly signal it was passing to another? |
| `contextPreserved` | Did the receiving agent pick up without making the user repeat themselves? |
| `skillAlignment` | Did each agent operate in their skill lane? |

#### Collaborate Rubric

| Dimension | What it checks |
|---|---|
| `distinctContributions` | Are the agents saying different things, not repeating each other? |
| `skillAlignment` | Does each agent's contribution match their skill domain? |
| `coherentWhole` | Do the pieces fit together into a useful combined response? |

Each dimension is boolean. A `contentAdequate` boolean is included across all patterns as a minor secondary content sanity check.

**Scoring:** `interactionScore` = count of true rubric dimensions (0-3). `pass` requires all dimensions true.

## Architecture

```
CLI (cli.ts)
  |
  v
runComparison(protocols, probes)
  |  parallel (per protocol x probe)
  v
runProbe(protocol, probe)
  1. protocol.initialize()
  2. protocol.sendRequest(probe.prompt)
  3. await settled
  4. collect AgentResult[]
  5. checkAssertions(probe.expect, results) -> pass/fail + details
  6. if assertions pass && judge enabled:
       evaluateInteraction(probe, results) -> rubric scores
  7. return ProbeResult
  |
  v
aggregate by pattern & protocol
  |
  v
report (terminal + optional markdown/JSON)
```

### Files

| File | Purpose |
|---|---|
| `probes/` | Replaces `scenarios/`. Small focused JSON files. |
| `runner.ts` | Simplified single-shot probe runner |
| `assertions.ts` | New. Pure function assertion checker, no LLM. |
| `judge.ts` | Pattern-aware rubric evaluation |
| `judge-prompt.ts` | Pattern-specific judge prompts |
| `judge-types.ts` | New rubric types |
| `comparison.ts` | Simpler aggregation, grouped by pattern |
| `report-terminal.ts` | Results grouped by pattern |
| `cli.ts` | Same flags, simpler internals |

### Deleted

| File | Reason |
|---|---|
| `multi-round.ts` | Probes are single-shot |
| `scenarios/*.json` | Replaced by `probes/` |

## Metrics

### Per-Probe

| Metric | Type | Description |
|---|---|---|
| `assertionsPassed` | `boolean` | Did structural checks pass? |
| `assertionDetails` | `object` | Which specific assertions passed/failed |
| `judgePassed` | `boolean \| null` | null if assertions failed (judge skipped) |
| `rubricScores` | `object` | The 3-4 boolean dimensions from the judge |
| `interactionScore` | `number` | Count of true rubric dimensions (0-3) |
| `contentAdequate` | `boolean` | Minor content sanity check |
| `cost` | `number` | Total cost in dollars |
| `durationMs` | `number` | Wall-clock time |

### Per-Protocol Aggregate (grouped by pattern)

| Metric | Description |
|---|---|
| `assertionPassRate` | % of probes where structural checks passed |
| `judgePassRate` | % of assertion-passing probes where judge also passed |
| `overallPassRate` | % of probes that passed both layers |
| `avgInteractionScore` | Average rubric score across judged probes |
| `avgCost` | Average cost per probe |

## Terminal Report

```
Protocol Comparison (model: haiku-4.5)
═══════════════════════════════════════

                  parley    simple    a2a
──────────────────────────────────────────
Overall Pass     85%        40%       78%
Avg Score        2.8/3      1.2/3     2.5/3
Avg Cost         $0.002     $0.001    $0.003

By Pattern:
  single-route   90% (9/10) 60% (6/10) 85% (8/10)
  selective      80% (4/5)  20% (1/5)  70% (3/5)
  decline-all    100%(3/3)  0%  (0/3)  80% (2/3)
  handoff        70% (7/10) 30% (3/10) 75% (7/10)
  collaborate    80% (4/5)  50% (2/5)  80% (4/5)

Failures:
  x simple x route-clear-technical: excluded skill 'creative' responded
  x parley x handoff-creative-to-tech: only 1 skill domain in responses
```
