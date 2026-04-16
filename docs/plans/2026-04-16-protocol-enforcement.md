# Protocol v2 Enforcement & Spec Clarifications

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the v2 protocol implementation in line with `specs/PROTOCOL_SPEC_2.md` for a focused set of moderate/minor gaps, and clarify the store-vs-agent responsibility split in the spec.

**Architecture:** The store remains a thin validator + db + forwarder; agents own protocol semantics (ACK discipline, `to` mirroring, CANCEL propagation, TTL re-checks). This plan (a) hardens the small set of store invariants that actually belong in the store (sequence correctness, per-message retry scoping) and (b) adds agent-side guidance in the prompt for the behaviors that belong to agents.

**Tech Stack:** TypeScript (Bun workspaces), Anthropic SDK. Spec is a markdown file.

**Scope explicitly excludes** (by user decision — treated as prompt failures, not store invariants):
- Enforcing that PROCESS requires ACK with `accept: true` (agent contract, not store contract).
- Enforcing that an agent with `accept: false` sends no further messages.
- Enforcing RESPONSE/ACK/PROCESS `to`-field mirroring at the store level.
- Store-level CANCEL cascade — sub-chains are independent per the spec.

---

## Task 1: Clarify store-vs-agent responsibilities in the spec

**Files:**
- Modify: `specs/PROTOCOL_SPEC_2.md` — extend the Overview section (lines 1–14)

**Step 1:** Open `specs/PROTOCOL_SPEC_2.md` and locate the `# Overview - v2` heading (line 1).

**Step 2:** After the existing paragraph at line 3 and before the `This version of the protocol expands on...` paragraph at line 5, insert a new paragraph:

```
## Responsibilities

The protocol divides work between two parties:

- **Store** — validates message schema, TOON format, chain integrity (state transitions, ownership, CANCEL/expiry), and delivery target resolution. The store persists messages and forwards them to subscribers. It does NOT police per-agent commitments (e.g., "an agent that ACKed `accept: false` must stay silent") — those are agent-side obligations.
- **Agents** — own protocol semantics: choosing when to ACK, which `to` field to mirror, maintaining their own `sequence` counter per chain, propagating CANCEL to sub-chains they spawned, and periodically re-checking `ttl` during long PROCESS work. Agents communicate directly with other agents via the store as a bus; the store is not an orchestrator.

Violations of agent-side obligations are treated as prompt/implementation bugs of that agent, not store errors.
```

**Step 3:** Commit.

```bash
git add specs/PROTOCOL_SPEC_2.md
git commit -m "spec: clarify store vs agent responsibility split"
```

---

## Task 2: Enforce per-agent-per-chain `sequence` in the store

**Goal:** Agents manage their own sequence counter. The store rejects messages whose `sequence` is not the next expected value for that `(from, chainId)` pair. Spec lines 96 and 245.

**Files:**
- Modify: `protocols/src/default_v2/store.ts` — `getNextSequence` (lines 72–77) and `storeMessage` (lines 79–97)
- Modify: `protocols/src/default_v2/prompt.ts` — line 51 (`sequence: Auto-assigned by the store — do not set.`)
- Modify: `protocols/src/default_v2/agent.ts` — wherever the agent currently builds outgoing TOON messages (search for where `sequence` is set or omitted)

**Step 1:** In `store.ts`, replace `getNextSequence` with a validator + bump:

```ts
private expectedSequence(agentId: string, chainId: string): number {
    const key = `${agentId}:${chainId}`;
    return this.sequenceCounters.get(key) ?? 0;
}

private advanceSequence(agentId: string, chainId: string): void {
    const key = `${agentId}:${chainId}`;
    const current = this.sequenceCounters.get(key) ?? 0;
    this.sequenceCounters.set(key, current + 1);
}
```

**Step 2:** In `storeMessage` (around lines 92–97), replace the auto-assign block:

```ts
// OLD
const message: MessageV2 = {
    ...decoded,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sequence: this.getNextSequence(decoded.from, decoded.chainId),
};
```

with a validation + advance:

```ts
const expected = this.expectedSequence(decoded.from, decoded.chainId);
if (typeof decoded.sequence !== "number" || decoded.sequence !== expected) {
    throw new Error(
        `Invalid sequence for ${decoded.from} on chain ${decoded.chainId}: expected ${expected}, got ${decoded.sequence}`,
    );
}
const message: MessageV2 = {
    ...decoded,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
};
// Only advance after all validation below has passed — defer this
```

Move the `this.advanceSequence(message.from, message.chainId)` call to the end of `storeMessage`, right before `this.messages.push(message)` (around line 204), so a rejected message does not consume a sequence slot.

**Step 3:** Update the agent prompt (`prompt.ts` line 51). Replace:

```
- `sequence`: Auto-assigned by the store — do not set.
```

with:

```
- `sequence`: Per-agent per-chain counter. Start at 0 for your first message in a chain and increment by 1 for each subsequent message you send in that same chain. Counters are independent of other agents. The store will reject messages with an incorrect sequence.
```

**Step 4:** Update the same section in the spec embedded prompt inside `specs/PROTOCOL_SPEC_2.md` (lines 243–247 under `### Sequencing`). The spec already says the right thing; verify it still matches the prompt wording and adjust if not.

**Step 5:** Audit `protocols/src/default_v2/agent.ts` for any place it builds a TOON message without setting `sequence`. The agent is an LLM, so the actual sequence values come from the LLM's TOON output — but ensure no helper strips or overrides `sequence` before `store_message` is called.

**Step 6:** Manual verification. Run:

```bash
bun run chat
```

Send a simple direct request to one agent. Watch the logs (`logs/`) to confirm:
- The first message from each agent in a chain has `sequence: 0`.
- Subsequent messages from the same agent in the same chain increment correctly.
- If the LLM emits a wrong value, the store rejects it with the new error message and the agent retries.

Also run the benchmark to confirm nothing regresses:

```bash
bun run bench --protocols v2 --pattern single-route
```

Ask the user for the output.

**Step 7:** Commit.

```bash
git add protocols/src/default_v2/store.ts protocols/src/default_v2/prompt.ts protocols/src/default_v2/agent.ts specs/PROTOCOL_SPEC_2.md
git commit -m "v2: enforce per-agent-per-chain sequence at the store"
```

---

## Task 3: Scope TOON validation retries per message, not per agent

**Goal:** Current behavior: 3 global consecutive TOON failures permanently blocks an agent from `store_message` across all chains (`tool-executor.ts:21–43`). Spec intent is 3 attempts per message.

**Files:**
- Modify: `protocols/src/default_v2/tool-executor.ts` — lines 4, 21–43

**Step 1:** The cleanest scoping is per-call: each `store_message` tool call gets 3 internal retry attempts before surfacing a permanent ERROR. However, the tool call itself is one LLM turn — the agent retries by making a new tool call next turn. So "per message" effectively means "reset on success" which is already happening at line 30 (`validationFailures.delete(agentId)`).

The actual bug is that failures persist across different *message attempts in different chains*. The fix: reset the counter when the agent is targeting a different chainId, or more simply, remove the hard 3-strike block entirely and trust the agent loop to give up on its own.

Replace lines 4 and 21–43 in `tool-executor.ts`:

```ts
// OLD (line 4)
const validationFailures: Map<string, number> = new Map();
```

Remove this line entirely.

```ts
// OLD (lines 14–44) — replace the entire store_message case
case "store_message": {
    if (typeof input.message !== "string" || !input.message) {
        return {
            success: false,
            error: `store_message requires a "message" parameter containing a TOON-encoded string. Got ${typeof input.message}. The entire message must be a single TOON string, not separate fields.`,
        };
    }
    try {
        const msg = store.storeMessage(input.message);
        return {
            success: true,
            data: { id: msg.id, type: msg.type, chainId: msg.chainId },
        };
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `TOON validation failed: ${errorMessage}`,
        };
    }
}
```

**Step 2:** The per-message 3-attempt cap from the spec (Error Handling, line 544) lives at the agent loop level. Verify in `agent.ts` that the LLM loop already has a max-iteration guard — if so, the 3-attempt behavior is naturally bounded. If not, add a per-chain attempt counter at the agent loop level instead of the tool-executor level. (Check `agent.ts` for an iteration limit; if absent, note it as a follow-up but do not block this task on it.)

**Step 3:** Manual verification. Run the chat app, deliberately trigger a TOON failure (hard to do without modifying the agent; skip if no easy repro). Instead, confirm via the benchmark:

```bash
bun run bench --protocols v2
```

Confirm no agent gets permanently wedged across probes. Ask the user for the output.

**Step 4:** Commit.

```bash
git add protocols/src/default_v2/tool-executor.ts
git commit -m "v2: remove global per-agent TOON retry cap, rely on agent loop"
```

---

## Task 4: Agent-side version check in prompt

**Goal:** Spec line 261 & 369 require the recipient to ERROR on unsupported version. The store enforces at line 82 of `store.ts`, but the agent prompt only says "ERROR if you receive an unsupported version" without explicit handling guidance.

**Files:**
- Modify: `protocols/src/default_v2/prompt.ts` — line 49
- Modify: `specs/PROTOCOL_SPEC_2.md` — lines 259–262 (`### Versioning`)

**Step 1:** In `prompt.ts` line 49, replace:

```
- `version`: Always `2`. ERROR if you receive an unsupported version.
```

with:

```
- `version`: Always send `2`. If you receive a message whose `version` is not `2`, do NOT process it — instead send a message of type ERROR with `replyTo` set to that message's id and a payload stating the version mismatch (e.g., "Unsupported protocol version: got X, expected 2"). Do not silently discard version-mismatched messages.
```

**Step 2:** The spec section at lines 259–262 already says the right thing but lives in the embedded prompt; cross-check that `### Versioning` in the main Messages section (lines 367–369) matches. Both should be consistent.

**Step 3:** Manual verification. No easy way to send a non-v2 message through a chat flow; smoke-test by running:

```bash
bun run bench --protocols v2 --pattern single-route
```

and confirming nothing regresses. Ask the user for the output.

**Step 4:** Commit.

```bash
git add protocols/src/default_v2/prompt.ts specs/PROTOCOL_SPEC_2.md
git commit -m "v2: expand agent-side version-mismatch handling guidance"
```

---

## Task 5: Prompt + spec additions for CANCEL sub-chain propagation and TTL mid-PROCESS

**Goal:** Agent-side obligations that the spec already describes but that the prompt does not reinforce. Both updates must land in `prompt.ts` AND `specs/PROTOCOL_SPEC_2.md` (the embedded prompt block).

**Files:**
- Modify: `protocols/src/default_v2/prompt.ts` — CANCEL section at line 44; add TTL guidance
- Modify: `specs/PROTOCOL_SPEC_2.md` — embedded prompt block (lines 207–313), CANCEL section at line 236 and the headers section at line 252–258

**Step 1 — CANCEL sub-chain propagation.** In `prompt.ts`, replace line 44:

```
- **CANCEL**: Stop work, ACK the CANCEL, send nothing else on the chain. Only the original requester or chain owner may CANCEL.
```

with:

```
- **CANCEL**: Stop work immediately and ACK the CANCEL. If during PROCESS you sent sub-REQUESTs to other agents (new chainIds you started), you are responsible for propagating CANCEL to each of those sub-chains — send a CANCEL to each sub-chain before going silent. Keep track of sub-chains you spawn so you can cancel them. After the CANCEL ACK, send nothing else on the original chain. Only the original requester or chain owner may initiate CANCEL.
```

**Step 2 — TTL mid-PROCESS.** In `prompt.ts`, extend line 52. Replace:

```
- Reserved headers: `accept` (required on ACK, true/false), `ttl` (expiry timestamp — do not work if expired), `exclusivity` (if true, CLAIM before proceeding).
```

with:

```
- Reserved headers:
  - `accept` (required on ACK, true/false).
  - `ttl` — UTC ISO timestamp. Check BEFORE beginning work — if expired, do not start, send ERROR with a timeout reason. Re-check `ttl` periodically during long PROCESS work; if it expires mid-PROCESS, stop, send ERROR, and propagate CANCEL to any sub-chains you spawned. Treat TTL expiry as an implicit CANCEL.
  - `exclusivity` (if true, CLAIM before proceeding).
```

**Step 3 — Mirror in spec.** In `specs/PROTOCOL_SPEC_2.md`:

a. Find the `### CANCEL` section of the embedded prompt (around lines 235–238) and update to match Step 1's wording.

b. Find the `### Headers` section of the embedded prompt (around lines 252–258) and update `ttl` to match Step 2's wording.

Both the prompt source and the spec must stay in sync.

**Step 4:** Manual verification. Exercising CANCEL propagation requires a prompt that causes an agent to delegate via sub-REQUEST and then be cancelled mid-PROCESS. If you can set that up in the chat app, confirm the cancelled agent sends CANCELs on its spawned sub-chains. Otherwise document this as "behavioral change in prompt only; verify qualitatively in next benchmark run." Ask the user for output if they test it.

**Step 5:** Commit.

```bash
git add protocols/src/default_v2/prompt.ts specs/PROTOCOL_SPEC_2.md
git commit -m "v2: prompt+spec guidance for CANCEL sub-chain propagation and TTL mid-process re-checks"
```

---

## Task 6: Smoke-test end-to-end

**Goal:** Confirm nothing in the v2 protocol regresses after all changes.

**Step 1:** Run:

```bash
bun run lint
```

Ask the user for output; fix any issues introduced by this plan.

**Step 2:** Run:

```bash
bun run bench --protocols v2 --pattern single-route,handoff
```

Ask the user for output. Look for:
- No sequence-related errors in the benchmark run.
- No "3 consecutive failures" agent lockouts.
- Agent responses still complete within expected behavior.

**Step 3:** If green, no commit needed (purely verification). If regressions, fix in a follow-up commit.

---

## Summary of changes

| # | File | Change |
|---|------|--------|
| 1 | `specs/PROTOCOL_SPEC_2.md` | Add Responsibilities subsection to Overview |
| 2 | `protocols/src/default_v2/store.ts` | Enforce per-agent-per-chain sequence |
| 2 | `protocols/src/default_v2/prompt.ts` + spec | Update sequence guidance |
| 3 | `protocols/src/default_v2/tool-executor.ts` | Remove global retry lockout |
| 4 | `protocols/src/default_v2/prompt.ts` + spec | Explicit version-mismatch handling |
| 5 | `protocols/src/default_v2/prompt.ts` + spec | CANCEL sub-chain + TTL mid-PROCESS guidance |

Every prompt change lands in both the TS source and the embedded prompt block in the spec.
