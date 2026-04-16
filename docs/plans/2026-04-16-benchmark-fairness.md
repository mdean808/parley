# Benchmark Fairness Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove two unfairness sources in the cross-protocol benchmark: (1) non-routing protocols silently skipping routing assertions (inflated pass-rate), and (2) the LLM judge conflating explicit declines with silent timeouts.

**Architecture:** Keep `runProbe` as the single-shot orchestrator. Introduce a `routing-na` assertion state distinct from pass/fail, so reports can show "N/A" without counting it as a pass. Thread per-agent terminal state (responded/declined/timed-out) into both the assertion layer (decline-all pattern rewards correct abstention) and the judge prompt (qualitative distinction).

**Tech Stack:** TypeScript (Bun workspaces). Changes scoped to `benchmark/`.

---

## Task 1: Add a `routing-na` assertion status and surface it in reports

**Goal:** Today, `runner.ts:71–82` quietly rewrites `expect` to strip `agentCount.max` and `excludedSkills` for non-routing protocols. That silently converts "cannot test" into "passed." Replace the silent skip with an explicit `na` state per assertion detail.

**Files:**
- Modify: `benchmark/src/types.ts` — `AssertionDetail` type
- Modify: `benchmark/src/assertions.ts` — support `na` status + new parameter `supportsRouting`
- Modify: `benchmark/src/runner.ts` — stop rewriting `expect`; pass `supportsRouting` to `checkAssertions` instead
- Modify: `benchmark/src/report-terminal.ts` — render N/A results distinctly
- Modify: `benchmark/src/report-markdown.ts` — render N/A results distinctly

**Step 1:** In `benchmark/src/types.ts`, find the `AssertionDetail` type and extend it. Add a `status` field (and keep `passed` as a derived boolean for existing consumers or remove it; simpler to leave `passed` for backward compat and add `status`):

```ts
export interface AssertionDetail {
    name: string;
    passed: boolean;          // true only if status === "pass"
    status: "pass" | "fail" | "na";
    expected: string;
    actual: string;
    reason?: string;          // populated when status === "na"
}
```

Also extend `AssertionResult` if it currently has an overall `passed` boolean — overall `passed` should only be true when every non-`na` detail passes. (An all-N/A probe still returns `passed: true` with a caveat, or introduce `passed: boolean | "na"`. Pick `passed: true` for all-N/A and surface the count of N/A details in the report instead.)

**Step 2:** In `benchmark/src/assertions.ts`, change the signature:

```ts
export function checkAssertions(
    expect: ProbeExpect,
    agents: AgentProbeResult[],
    supportsRouting: boolean = true,
): AssertionResult {
```

For the `agentCount.max` block (lines 23–30) and the `excludedSkills` block (lines 57–72), when `supportsRouting === false`, push a detail with `status: "na"`:

```ts
if (expect.agentCount?.max != null) {
    if (!supportsRouting) {
        details.push({
            name: "agentCount.max",
            passed: true,
            status: "na",
            expected: `<= ${expect.agentCount.max}`,
            actual: String(agents.length),
            reason: "protocol does not support routing; broadcast to all agents",
        });
    } else {
        details.push({
            name: "agentCount.max",
            passed: agents.length <= expect.agentCount.max,
            status: agents.length <= expect.agentCount.max ? "pass" : "fail",
            expected: `<= ${expect.agentCount.max}`,
            actual: String(agents.length),
        });
    }
}
```

Do the same for `excludedSkills`. Update existing detail pushes to set `status` accordingly (`"pass"` or `"fail"`).

Change the overall result calculation: `passed: details.every((d) => d.status !== "fail")` — N/A counts as not-failed.

**Step 3:** In `benchmark/src/runner.ts`, remove the `effectiveExpect` rewrite (lines 71–82). Pass `supportsRouting` into `checkAssertions` directly:

```ts
const assertions = error
    ? {
            passed: false,
            details: [
                {
                    name: "execution",
                    passed: false,
                    status: "fail" as const,
                    expected: "no error",
                    actual: error,
                },
            ],
        }
    : checkAssertions(probe.expect, agents, supportsRouting ?? true);
```

**Step 4:** Update `benchmark/src/report-terminal.ts` to render N/A assertions with a distinct marker (e.g., `—` or `N/A` in grey), not a green checkmark. Find the block that iterates `assertions.details` and branch on `detail.status`.

**Step 5:** Same for `benchmark/src/report-markdown.ts` — render `N/A` (with the reason in a tooltip or inline) instead of ✓ or ✗.

**Step 6:** Manual verification:

```bash
bun run bench --protocols v2,simple --pattern decline-all
```

Ask the user for output. Expected: `simple` protocol shows N/A on `agentCount.max` / `excludedSkills` (not a green check), while `v2` gets a real pass or fail.

**Step 7:** Commit.

```bash
git add benchmark/src/types.ts benchmark/src/assertions.ts benchmark/src/runner.ts benchmark/src/report-terminal.ts benchmark/src/report-markdown.ts
git commit -m "bench: surface routing-skip as N/A instead of silent pass"
```

---

## Task 2: Add per-agent terminal state and pass it through the judge

**Goal:** Currently the judge sees (a) responses, (b) explicit declines (already passed through), and (c) "missing" agents inferred as "timed out" (judge-prompt.ts:128–144). The inference conflates ERROR'd agents with timed-out agents and doesn't reward correct decline behavior. Explicit per-agent state makes the judge's signal cleaner.

**Files:**
- Modify: `benchmark/src/types.ts` — add `AgentTerminalState`
- Modify: `benchmark/src/collect.ts` — emit terminal state per agent
- Modify: `benchmark/src/runner.ts` — build a combined state map
- Modify: `benchmark/src/judge.ts` — pass the state map to the prompt builder
- Modify: `benchmark/src/judge-prompt.ts` — consume state map, replace timeout inference

**Step 1:** In `benchmark/src/types.ts`, add:

```ts
export type AgentTerminalStatus =
    | "responded"
    | "declined"
    | "errored"
    | "timed-out";

export interface AgentTerminalState {
    agentName: string;
    skills: string[];
    status: AgentTerminalStatus;
    reason?: string;   // decline reason, error message, etc.
}
```

**Step 2:** In `benchmark/src/collect.ts`, locate where declines are tracked and where responses complete. Extend the collector to record `errored` agents (agents that began work but threw) distinctly from `timed-out` (agents that never sent any lifecycle message). Expose a method like `getTerminalStates(allAgents: ProtocolAgentInfo[]): AgentTerminalState[]`:

```ts
getTerminalStates(allAgents: ProtocolAgentInfo[]): AgentTerminalState[] {
    const states: AgentTerminalState[] = [];
    for (const agent of allAgents) {
        if (this.responded.has(agent.name)) {
            states.push({ agentName: agent.name, skills: agent.skills, status: "responded" });
        } else if (this.declinedReasons.has(agent.name)) {
            states.push({
                agentName: agent.name,
                skills: agent.skills,
                status: "declined",
                reason: this.declinedReasons.get(agent.name),
            });
        } else if (this.errored.has(agent.name)) {
            states.push({
                agentName: agent.name,
                skills: agent.skills,
                status: "errored",
                reason: this.errored.get(agent.name),
            });
        } else {
            states.push({ agentName: agent.name, skills: agent.skills, status: "timed-out" });
        }
    }
    return states;
}
```

If the collector does not currently track errored agents, add the bookkeeping. Find the callback where the protocol reports per-agent errors (see existing `collectSendRequest` in `collect.ts`) and populate `this.errored`.

**Step 3:** In `benchmark/src/runner.ts`, after `collectSendRequest` completes, compute terminal states:

```ts
const terminalStates = collector
    ? collector.getTerminalStates(allAgents)
    : allAgents.map((a) => ({
            agentName: a.name,
            skills: a.skills,
            status: "timed-out" as const,
        }));
```

Pass `terminalStates` into `evaluateProbe` (extend its signature).

**Step 4:** In `benchmark/src/judge.ts`, extend `evaluateProbe`'s signature to accept `terminalStates: AgentTerminalState[]` and forward it to `buildJudgeUserPrompt`.

**Step 5:** In `benchmark/src/judge-prompt.ts`:

a. Extend `buildJudgeUserPrompt` to accept `terminalStates` and REPLACE the blocks that currently:
- Loop over `agents` to emit `## Agent Responses` (lines 111–118) — keep this but source from `terminalStates.filter(s => s.status === "responded")` so the response text aligns.
- Loop over `declines` (lines 120–126) — replace with `terminalStates.filter(s => s.status === "declined")`.
- Infer timeouts by set difference (lines 128–144) — DELETE this inference block. Replace with two explicit sections: `## Agent Errors` (from `status === "errored"`, include the reason) and `## Agent Timeouts` (from `status === "timed-out"`).

Shape:

```ts
parts.push("## Agent Terminal States\n");
for (const s of terminalStates) {
    switch (s.status) {
        case "responded": {
            const agent = agents.find((a) => a.agentName === s.agentName);
            parts.push(`**${s.agentName}** (skills: ${s.skills.join(", ")}) — RESPONDED`);
            if (agent) parts.push(agent.responseText);
            break;
        }
        case "declined":
            parts.push(`**${s.agentName}** (skills: ${s.skills.join(", ")}) — DECLINED: ${s.reason ?? "(no reason given)"}`);
            break;
        case "errored":
            parts.push(`**${s.agentName}** (skills: ${s.skills.join(", ")}) — ERRORED: ${s.reason ?? "(unknown error)"}`);
            break;
        case "timed-out":
            parts.push(`**${s.agentName}** (skills: ${s.skills.join(", ")}) — TIMED OUT (no lifecycle messages sent)`);
            break;
    }
    parts.push("");
}
```

b. Update the system prompt (`buildJudgeSystemPrompt`, lines 69–86) to mention the distinction explicitly:

```
Each agent has a terminal state: RESPONDED, DECLINED (with reason), ERRORED, or TIMED OUT. Treat DECLINED as an intentional protocol-correct abstention when the request is outside the agent's skill domain. Treat ERRORED/TIMED OUT as failures, not correct abstentions — reward explicit declines, penalize silent failures.
```

c. For the decline-all pattern specifically, update the Interaction Rubric at lines 50–54:

```
- **prompt_relevance**: If any agent RESPONDED, the response honestly communicates inability or redirects the user rather than fabricating an answer. Agents that DECLINED with a coherent reason count as correctly abstaining.
- **skill_alignment**: No agent claimed expertise they don't have. Explicit declines are correct behavior on this pattern.
- **clean_boundaries**: Agents did not overreach their skill domains. Silent timeouts on this pattern are NOT equivalent to explicit declines — prefer declines.
```

**Step 6:** Update assertion layer to reward declines on decline-all probes. In `benchmark/src/assertions.ts`, add an optional parameter `terminalStates?: AgentTerminalState[]` and, when `expect.agentCount?.max === 0` (decline-all pattern), add a detail checking that agents abstained cleanly:

```ts
if (expect.agentCount?.max === 0 && terminalStates) {
    const decliners = terminalStates.filter((s) => s.status === "declined").length;
    const timeouts = terminalStates.filter((s) => s.status === "timed-out").length;
    details.push({
        name: "decline-cleanly",
        passed: decliners > 0 || timeouts === 0,
        status: decliners > 0 || timeouts === 0 ? "pass" : "fail",
        expected: "at least one explicit decline OR zero silent timeouts",
        actual: `${decliners} declined, ${timeouts} timed out`,
    });
}
```

Wire this through from `runner.ts` by also passing `terminalStates` to `checkAssertions`.

**Step 7:** Manual verification:

```bash
bun run bench --protocols v2,simple --pattern decline-all
```

Ask the user for output. Expected:
- In the judge section of the results, each agent appears under its terminal state (RESPONDED / DECLINED / ERRORED / TIMED OUT).
- v2 agents that decline correctly should now score higher on decline-all than silently-timing-out agents.

Also run:

```bash
bun run bench --protocols v2,simple --pattern single-route
```

to confirm no regression on other patterns.

**Step 8:** Commit.

```bash
git add benchmark/src/types.ts benchmark/src/collect.ts benchmark/src/runner.ts benchmark/src/judge.ts benchmark/src/judge-prompt.ts benchmark/src/assertions.ts
git commit -m "bench: thread per-agent terminal state through judge and assertions"
```

---

## Task 3: Smoke-test full benchmark suite

**Goal:** Confirm no protocol is unintentionally broken by the fairness changes.

**Step 1:** Run:

```bash
bun run lint
```

Ask for output; fix any type/lint regressions.

**Step 2:** Run:

```bash
bun run bench --protocols v2,simple,claude-code --pattern single-route,decline-all,handoff
```

(If the external A2A/CrewAI servers are running, include those too.) Ask the user for output.

Sanity-check:
- Non-routing protocols show `N/A` on routing assertions, not green checkmarks.
- Decline-all probes distinguish explicit declines from timeouts in the judge's reasoning.
- Overall scores for v2 on decline-all should not decrease (should arguably increase — correct declines are now rewarded).

**Step 3:** If green, no code commit. If regressions, file a follow-up fix.

---

## Summary of changes

| # | File | Change |
|---|------|--------|
| 1 | `benchmark/src/types.ts` | Add `status: "pass" \| "fail" \| "na"` to assertions; add `AgentTerminalState` type |
| 1 | `benchmark/src/assertions.ts` | Accept `supportsRouting` + mark routing asserts N/A for non-routing protocols |
| 1 | `benchmark/src/runner.ts` | Stop silently rewriting `expect`; pass routing flag through |
| 1 | `benchmark/src/report-terminal.ts` + `report-markdown.ts` | Render N/A assertions distinctly |
| 2 | `benchmark/src/collect.ts` | Emit `AgentTerminalState[]` incl. errored vs timed-out |
| 2 | `benchmark/src/judge.ts` + `judge-prompt.ts` | Replace timeout inference with explicit state; reward declines on decline-all |
| 2 | `benchmark/src/assertions.ts` | Add `decline-cleanly` assertion on decline-all probes |

Both tasks are independent of the protocol-enforcement plan and can be executed in parallel.
