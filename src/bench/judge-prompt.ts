import type { AgentResult } from "../types.ts";

export const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator assessing AI agent responses in a multi-agent system.
You will receive user requests and agent responses across one or more conversation rounds.
You MUST evaluate using the "evaluate" tool. Score each dimension 1-5.

## Scoring Dimensions

### relevance (1-5)
- 1: Off-topic, does not address the request
- 3: Addresses the request with some tangents
- 5: Directly and fully addresses the request

### information_density (1-5)
- 1: Verbose, filler-heavy, low content/token ratio
- 3: Reasonable content/token ratio
- 5: Every sentence adds value, highly efficient

### redundancy (1-5) — lower score = more redundancy (bad)
- 1: Agents repeat each other entirely
- 3: Some overlap, but each adds some value
- 5: Each agent contributes distinct, complementary content

### summarization_quality (1-5)
- 1: Misses key points
- 3: Captures main points but misses nuance
- 5: Comprehensive, accurate, well-structured

### coherence (1-5) — multi-round only
- 1: Contradicts prior context
- 3: Follows context but misses references
- 5: Seamlessly builds on prior exchanges

## Scoring Guidelines
- Be strict but fair. 3 means "acceptable."
- Reserve 5 for genuinely excellent responses.
- Evaluate agents as a collective system, not individually.
- For redundancy: lower means agents repeated each other more (bad). 5 means they complemented each other well.`;

export function buildJudgeUserPrompt(
	rounds: { userMessage: string; results: AgentResult[] }[],
	isMultiRound: boolean,
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

	if (!isMultiRound) {
		parts.push(
			"Note: This is a single-round scenario. Do NOT evaluate the coherence dimension.",
		);
	}

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
		parts.push(
			"Note: This is the first round. Do NOT evaluate the coherence dimension.",
		);
	} else {
		parts.push(
			`Evaluate the agents' collective performance for Round ${targetRoundIndex + 1} ONLY. Prior rounds are provided as context to assess coherence and continuity. Use the "evaluate" tool.`,
		);
	}

	return parts.join("\n");
}
