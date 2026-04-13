import type { ProtocolAgentInfo } from "core/types";
import type { InteractionPattern } from "./judge-types.ts";
import type { AgentProbeResult, DeclineInfo } from "./types.ts";

const CONTENT_RUBRIC_DESCRIPTIONS: Record<InteractionPattern, string> = {
	"single-route": `## Content Rubric
For each criterion, answer true or false:
- **content_depth**: The response provides substantive detail, not just a surface-level acknowledgment of the request.
- **content_accuracy**: The response contains no obvious factual errors or misleading information.
- **content_completeness**: The response addresses all parts of the user's request, not just a subset.`,

	"selective-route": `## Content Rubric
For each criterion, answer true or false:
- **content_depth**: The response provides substantive detail appropriate to the request.
- **content_accuracy**: The response contains no obvious factual errors or misleading information.
- **content_completeness**: The response addresses all parts of the user's request.`,

	"decline-all": `## Content Rubric
For each criterion, answer true or false:
- **content_depth**: If any agent responded, it provided a helpful explanation of why the request is outside its capabilities.
- **content_accuracy**: No agent fabricated capabilities or provided misleading information.
- **content_completeness**: The response (or lack thereof) appropriately communicates the system's limitations.`,

	handoff: `## Content Rubric
For each criterion, answer true or false:
- **content_depth**: Each contributing agent provided substantive content in their domain, not just a shallow mention.
- **content_accuracy**: The responses contain no obvious factual errors or contradictions between agents.
- **content_completeness**: The combined responses address all aspects of the user's request.`,

	collaborate: `## Content Rubric
For each criterion, answer true or false:
- **content_depth**: Each agent's contribution has real substance, not just padding or repetition.
- **content_accuracy**: The responses contain no obvious factual errors or contradictions between agents.
- **content_completeness**: The combined responses cover all dimensions of the user's request.`,
};

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
	return `You are an expert evaluator assessing AI agent quality in a multi-agent system.
You will receive a user prompt and agent responses. Your job is to evaluate BOTH how the agents interacted (routing, handoffs, coordination) AND the quality of the content they produced.

${RUBRIC_DESCRIPTIONS[pattern]}

${CONTENT_RUBRIC_DESCRIPTIONS[pattern]}

## Evaluation
Evaluate each rubric criterion independently on its own merits. After scoring all criteria:
- Set pass to true only if ALL interaction rubric criteria are true AND at least 2 of 3 content criteria are true.
- Set pass to false otherwise.

## Guidelines
- Evaluate both the interaction pattern AND the response quality — both matter equally.
- A well-routed but shallow answer is not better than a slightly mis-routed but thorough answer.
- A perfect answer from a single agent is valid if the task didn't require multi-agent coordination.`;
}

export function buildJudgeUserPrompt(
	prompt: string,
	targetSkills: string[],
	agents: AgentProbeResult[],
	declines?: DeclineInfo[],
	allAgents?: ProtocolAgentInfo[],
): string {
	const parts: string[] = [];

	parts.push(`## Probe`);
	parts.push(`**User prompt:** ${prompt}`);
	parts.push(
		`**Target skills:** ${targetSkills.join(", ") || "(none — all agents should decline)"}\n`,
	);

	if (allAgents && allAgents.length > 0) {
		parts.push("## Available Agents\n");
		for (const a of allAgents) {
			parts.push(`- **${a.name}** (skills: ${a.skills.join(", ")})`);
		}
		parts.push("");
	}

	if (agents.length > 0) {
		parts.push("## Agent Responses\n");
		for (const agent of agents) {
			parts.push(`**${agent.agentName}** (skills: ${agent.skills.join(", ")})`);
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

	// Identify agents that timed out (neither responded nor declined)
	if (allAgents && allAgents.length > 0) {
		const respondedNames = new Set(agents.map((a) => a.agentName));
		const declinedNames = new Set(declines?.map((d) => d.agentName) ?? []);
		const timedOut = allAgents.filter(
			(a) => !respondedNames.has(a.name) && !declinedNames.has(a.name),
		);
		if (timedOut.length > 0) {
			parts.push("## Agent Timeouts\n");
			for (const a of timedOut) {
				parts.push(
					`**${a.name}** (skills: ${a.skills.join(", ")}) — timed out without responding or declining`,
				);
			}
			parts.push("");
		}
	}

	if (agents.length === 0 && (!declines || declines.length === 0)) {
		parts.push("**No agents responded or declined.**\n");
	}

	parts.push("## Instructions");
	parts.push('Evaluate the interaction quality using the "evaluate" tool.');

	return parts.join("\n");
}
