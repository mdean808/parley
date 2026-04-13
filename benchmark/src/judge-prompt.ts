import type { InteractionPattern } from "./judge-types.ts";
import type { AgentProbeResult, DeclineInfo } from "./types.ts";

const RUBRIC_DESCRIPTIONS: Record<InteractionPattern, string> = {
	"single-route": `## Interaction Rubric (Routing)
For each criterion, answer true or false:
- **prompt_relevance**: The responding agent's reply directly addresses the user's request.
- **skill_alignment**: The response reflects the agent's claimed skill domain (e.g., a coding agent gives a technical answer, not a creative one).
- **clean_boundaries**: Non-responding agents stayed quiet rather than chiming in unnecessarily.`,

	"selective-route": `## Interaction Rubric (Selective Routing)
For each criterion, answer true or false:
- **prompt_relevance**: The responding agent's reply directly addresses the user's request.
- **skill_alignment**: The best-fit agent responded, not just any agent with tangential skills.
- **clean_boundaries**: Other agents who could have responded deferred to the better-fit agent.`,

	"decline-all": `## Interaction Rubric (Decline)
For each criterion, answer true or false:
- **prompt_relevance**: If any agent responded, the response honestly communicates inability or redirects the user rather than fabricating an answer.
- **skill_alignment**: No agent claimed expertise they don't have.
- **clean_boundaries**: Agents did not overreach their skill domains.`,

	handoff: `## Interaction Rubric (Handoff)
For each criterion, answer true or false:
- **handoff_clarity**: The first agent clearly signaled it was passing to another agent or the system routed the sub-tasks to appropriate agents.
- **context_preserved**: The receiving agent picked up the task without requiring the user to repeat context.
- **skill_alignment**: Each agent operated within their skill domain (e.g., the creative part was done by a creative agent, the coding part by a technical agent).`,

	collaborate: `## Interaction Rubric (Collaboration)
For each criterion, answer true or false:
- **distinct_contributions**: The agents said meaningfully different things, not repeating each other's content.
- **skill_alignment**: Each agent's contribution matches their skill domain.
- **coherent_whole**: The combined responses form a useful, complementary answer to the user's request.`,
};

export function buildJudgeSystemPrompt(pattern: InteractionPattern): string {
	return `You are an expert evaluator assessing AI agent interaction quality in a multi-agent system.
You will receive a user prompt and agent responses. Your job is to evaluate HOW the agents interacted — routing, handoffs, and collaboration — not the factual correctness of their answers.

${RUBRIC_DESCRIPTIONS[pattern]}

## Content Check
- **content_adequate**: As a minor secondary check, the collective response is not complete nonsense — it bears some reasonable relationship to the user's request. This is a very low bar.

## Pass/Fail
- PASS: All rubric criteria are true.
- FAIL: Any rubric criterion is false.

## Guidelines
- Focus on the interaction pattern, not the underlying LLM's knowledge.
- A factually imperfect answer that was correctly routed is better than a perfect answer from the wrong agent.
- Evaluate the system's routing/coordination decisions, not individual agent quality.`;
}

export function buildJudgeUserPrompt(
	prompt: string,
	targetSkills: string[],
	agents: AgentProbeResult[],
	declines?: DeclineInfo[],
): string {
	const parts: string[] = [];

	parts.push(`## Probe`);
	parts.push(`**User prompt:** ${prompt}`);
	parts.push(
		`**Target skills:** ${targetSkills.join(", ") || "(none — all agents should decline)"}\n`,
	);

	if (agents.length === 0 && (!declines || declines.length === 0)) {
		parts.push("**No agents responded.**\n");
	} else {
		if (agents.length > 0) {
			parts.push("## Agent Responses\n");
			for (const agent of agents) {
				parts.push(
					`**${agent.agentName}** (skills: ${agent.skills.join(", ")})`,
				);
				parts.push(agent.responseText);
				parts.push("");
			}
		}
		if (declines && declines.length > 0) {
			parts.push("## Agent Declines\n");
			for (const d of declines) {
				parts.push(`**${d.agentName}** declined: ${d.reason}`);
				parts.push("");
			}
		}
	}

	parts.push("## Instructions");
	parts.push('Evaluate the interaction quality using the "evaluate" tool.');

	return parts.join("\n");
}
