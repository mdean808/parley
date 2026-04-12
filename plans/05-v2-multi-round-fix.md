# V2 Multi-Round Fix

## Problem

V2 agents silently decline round 2+ requests in multi-round benchmarks. Round 2 returns 0 agents, duration is exactly ~5003ms (the ACK window timeout).

### Root cause

The agent system prompt (`protocols/src/default_v2/prompt.ts`) tells agents: "If it does not match your skills, stay silent — do not send any messages." The multi-round follow-up prompt ("Continue the conversation, building on your previous response") is a vague meta-instruction that doesn't clearly match any agent's skills (e.g. "coding, technical"). The agent's LLM evaluates it, decides no skill match, and stays silent — producing zero ACKs.

Meanwhile, the 5s ACK window closes with 0 ACKs, `checkComplete()` sees `ackedAgentIds.size === 0` and resolves immediately with empty results.

### Contributing factors

- Agents DO maintain `chainHistory` across rounds (correct), so the LLM has full context from round 1
- But the skill-matching instruction overrides conversational continuity — the LLM re-evaluates skills on every REQUEST regardless of prior engagement
- The round 2 prompt is injected as a new REQUEST in TOON format, which the LLM treats as a fresh skill-matching decision

## Fix

Modify the agent system prompt to add a **chain continuity rule**: if an agent has already ACK'd and RESPONDED on a chain, it should continue engaging with follow-up REQUESTs on that same chain without re-evaluating skill matching.

### Files to change

1. **`protocols/src/default_v2/prompt.ts`** — Add to the Communication Rules section, after the Message Lifecycle:

   ```
   ### Chain Continuity

   If you have already sent a RESPONSE on a chain and receive a new REQUEST on the same chain,
   you MUST continue the conversation — ACK, PROCESS, and RESPONSE as normal. Do not re-evaluate
   skill matching for follow-up requests on chains you have already engaged with.
   ```

2. **`protocols/src/default_v2/agent.ts`** (optional enhancement) — When injecting the round 2 REQUEST into history at line 97, add a hint that this is a follow-up on an existing chain if `chainHistory` already has entries. This gives the LLM a stronger signal:

   ```typescript
   const isFollowUp = history.length > 0;
   const prefix = isFollowUp
     ? "This is a FOLLOW-UP on a chain you already responded to. Continue the conversation.\n\n"
     : "";
   history.push({
     role: "user",
     content: `${prefix}You received a new REQUEST message:\n\n...`,
   });
   ```

### Validation

- Run benchmark with v2 on a multi-round scenario
- Round 2 should have respondingAgentCount > 0
- Agent that responded in round 1 should respond in round 2
