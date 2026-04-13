---
name: reading-logs-and-results
description: Use when needing to read, query, filter, or analyze structured JSON log files or benchmark result files in this project
---

# Reading Logs & Benchmark Results

Quick reference for querying project log files and benchmark results. Use `jq` via Bash for filtering; use Read for small files or when you need visual scanning.

## Log Files

**Location:** `logs/*.json`, `apps/web-chat/logs/*.json`
**Format:** JSON array of `{ timestamp, level, component, event, data }` objects.

Find the latest log:
```sh
ls -t logs/*.json | head -1
```

### Common Queries

| Goal | Command |
|------|---------|
| Filter by level | `jq '[.[] \| select(.level == "ERROR")]' FILE` |
| Filter by event | `jq '[.[] \| select(.event == "agent_complete")]' FILE` |
| Filter by component | `jq '[.[] \| select(.component \| startswith("agent_v2:"))]' FILE` |
| Trace a chain | `jq '[.[] \| select(.data.chainId == "CHAIN_ID")]' FILE` |
| Agent token usage | `jq '.[] \| select(.event == "agent_complete") \| {agent: .data.agent, in: .data.inputTokens, out: .data.outputTokens, ms: .data.durationMs}' FILE` |
| Loop totals | `jq '.[] \| select(.event == "agentic_loop_complete") \| {chain: .data.chainId, in: .data.inputTokens, out: .data.outputTokens, ms: .data.durationMs}' FILE` |
| Registered agents | `jq '[.[] \| select(.event == "agent_registered")] \| .[] \| .data \| {name, skills}' FILE` |
| Errors + warnings | `jq '[.[] \| select(.level == "ERROR" or .level == "WARN")]' FILE` |
| Time range | `jq '[.[] \| select(.timestamp >= "2026-04-13T03:12" and .timestamp < "2026-04-13T03:13")]' FILE` |

### Key Events

`session_start` `agent_registered` `request_sent` `agent_start` `agent_complete` `agentic_loop_complete` `result_delivered` `request_declined` `request_not_handled`

### Components

`init` `store_v2` `protocol_v2` `init_v2` `agent_v2:{AgentName}` `simple` `a2a` `crewai`

## Benchmark Results

**Location:** `benchmark/results/benchmark-*.json` (and `.md` siblings)
**Format:** `ComparisonReport` — see `benchmark/src/types.ts` for full schema.

Find the latest result:
```sh
ls -t benchmark/results/benchmark-*.json | head -1
```

**Tip:** Read the `.md` file first for a human-readable summary with tables. Only use JSON + jq when you need programmatic filtering or exact numbers.

### Common Queries

| Goal | Command |
|------|---------|
| Protocol comparison | `jq '.aggregate.protocolMetrics \| to_entries[] \| {protocol: .key, score: .value.scoreRate, pass: .value.overallPassRate, cost: .value.avgCost}' FILE` |
| Scores by pattern | `jq '.aggregate.protocolMetrics["v2"].byPattern \| to_entries[] \| {pattern: .key, score: .value.scoreRate}' FILE` |
| Results for a probe | `jq '.probes[] \| select(.probe.id == "PROBE_ID") \| .results' FILE` |
| Agent responses | `jq '.probes[] \| select(.probe.id == "PROBE_ID") \| .results["v2"].agents[] \| {agent: .agentName, cost, ms: .durationMs}' FILE` |
| Judge summaries | `jq '[.probes[] \| .results \| to_entries[] \| {probe: .value.probeId, protocol: .key, score: .value.judge.interactionScore, summary: .value.judge.summary}]' FILE` |
| Failed probes | `jq '[.probes[] \| .results \| to_entries[] \| select(.value.judge.pass == false) \| {probe: .value.probeId, protocol: .key, score: .value.judge.interactionScore}]' FILE` |
| Results by pattern | `jq '[.probes[] \| select(.probe.pattern == "handoff")]' FILE` |
| Cost per protocol | `jq '[.probes[].results \| to_entries[] \| {protocol: .key, cost: .value.totalCost}] \| group_by(.protocol) \| map({protocol: .[0].protocol, total: (map(.cost) \| add)})' FILE` |

### Key Fields

- **Primary metric:** `scoreRate` = avgInteractionScore / 3 * 100%
- **Pass:** requires both `assertions.passed` and `judge.pass`
- **Patterns:** `single-route` `selective-route` `decline-all` `handoff` `collaborate`
- **Protocols:** `v2` `simple` `claude-code` `a2a` `crewai`
