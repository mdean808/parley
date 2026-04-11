import type { AgentResult } from "core/types";

export const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator assessing AI agent responses in a multi-agent system.
You will receive user requests and agent responses across one or more conversation rounds.
You MUST evaluate using the "evaluate" tool.

## Task Success (pass/fail)
- PASS: The agents collectively produced a response that answers the user's question or completes the requested task.
- FAIL: The response is off-topic, empty, incoherent, or does not address the request.
- Be lenient on quality — a mediocre answer that addresses the question is still a PASS.
- If no agents responded or all responses are empty, that is a FAIL.

## Quality Score (1-5)
- 1: Poor — barely addresses the request, major issues
- 2: Below average — addresses the request but with significant gaps
- 3: Acceptable — addresses the request adequately
- 4: Good — thorough, well-structured response
- 5: Excellent — comprehensive, insightful, well-organized
- Be strict but fair. 3 means "acceptable." Reserve 5 for genuinely excellent responses.

## Multi-Agent Value (1-5)
- 1: One agent did all meaningful work, or agents repeated each other entirely
- 2: Minimal differentiation between agents
- 3: Some complementary contributions, moderate overlap
- 4: Clear division of expertise, each agent adds distinct value
- 5: Excellent collaboration — agents cover different aspects with minimal redundancy
- For single-agent protocols (only one agent responded): score 1. This is expected, not a penalty.

## Guidelines
- Evaluate agents as a collective system, not individually.
- For multi-round conversations, evaluate based on the cumulative conversation quality.`;

export function buildJudgeUserPrompt(
	rounds: { userMessage: string; results: AgentResult[] }[],
): string {
	const parts: string[] = ["## Scenario\n"];

	for (let i = 0; i < rounds.length; i++) {
		const round = rounds[i];
		parts.push(`### Round ${i + 1}`);
		parts.push(`**User:** ${round.userMessage}\n`);

		for (const result of round.results) {
			parts.push(
				`**Agent: ${result.agentName}** (skills: ${result.skills.join(", ")})`,
			);
			parts.push(result.response.payload);
			parts.push("");
		}
	}

	parts.push("## Instructions");
	parts.push(
		'Evaluate the agents\' collective performance across all rounds. Use the "evaluate" tool.',
	);

	return parts.join("\n");
}

export function buildJudgeRoundPrompt(
	rounds: { userMessage: string; results: AgentResult[] }[],
	targetRoundIndex: number,
): string {
	const parts: string[] = ["## Scenario\n"];

	for (let i = 0; i <= targetRoundIndex; i++) {
		const round = rounds[i];
		parts.push(`### Round ${i + 1}`);
		parts.push(`**User:** ${round.userMessage}\n`);

		for (const result of round.results) {
			parts.push(
				`**Agent: ${result.agentName}** (skills: ${result.skills.join(", ")})`,
			);
			parts.push(result.response.payload);
			parts.push("");
		}
	}

	parts.push("## Instructions");

	if (targetRoundIndex === 0) {
		parts.push(
			'Evaluate the agents\' collective performance for this round. Use the "evaluate" tool.',
		);
	} else {
		parts.push(
			`Evaluate the agents' collective performance for Round ${targetRoundIndex + 1} ONLY. Prior rounds are provided as context to assess continuity. Use the "evaluate" tool.`,
		);
	}

	return parts.join("\n");
}
