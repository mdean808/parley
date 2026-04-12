import type { AgentResult } from "core/types";

export const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator assessing AI agent responses in a multi-agent system.
You will receive user requests and agent responses across one or more conversation rounds.
You MUST evaluate using the "evaluate" tool.

## Task Success (pass/fail)
- PASS: The agents collectively produced a response that answers the user's question or completes the requested task.
- FAIL: The response is off-topic, empty, incoherent, or does not address the request.
- Be lenient on quality — a mediocre answer that addresses the question is still a PASS.
- If no agents responded or all responses are empty, that is a FAIL.

## Quality Rubric
For each criterion, answer true or false:
- **addresses_request**: The final output directly answers the question or completes the task.
- **coherent_delivery**: The response is logically organized and easy to follow as a final product.
- **sufficient_depth**: The response provides enough detail to be useful, not just surface-level.
- **no_major_omissions**: Key aspects of the request are not ignored.
- **efficient_resolution**: The task was completed without excessive back-and-forth, unnecessary messages, or protocol overhead that didn't contribute to the result.

## Multi-Agent Value Rubric
For each criterion, answer true or false:
- **multiple_agents_contributed**: More than one agent provided a substantive response.
- **distinct_roles**: Each responding agent addressed the task using different skills or perspectives.
- **minimal_redundancy**: Agents did not substantially duplicate each other's work.
- **complementary_coverage**: Agents addressed different aspects of the request, improving overall completeness.
- **effective_coordination**: Agents built on or referenced each other's contributions without contradiction or wasted cycles.

For single-agent protocols (only one agent responded): all multi-agent criteria are false. This is expected, not a penalty.

## Expected Response (when provided)
When an "Expected Response" is provided for a round, use it as a reference for evaluating correctness and completeness.
- The expected response describes the key elements, topics, or criteria that a good answer should address.
- Agents do not need to match the expected response verbatim — evaluate whether they cover the substance.
- Use the "expectation_alignment" field (1-5) in the evaluate tool to score how well agents addressed the expected response criteria.
  - 1: Response misses nearly all expected elements
  - 2: Response addresses some expected elements but has major gaps
  - 3: Response addresses most expected elements adequately
  - 4: Response covers expected elements well with good detail
  - 5: Response fully addresses all expected elements with depth
- If no expected response is provided, omit the "expectation_alignment" field.

## Guidelines
- Evaluate agents as a collective system, not individually.
- For multi-round conversations, evaluate based on the cumulative conversation quality.
- Focus on protocol-level performance — how well the system coordinated to produce the result — not on the underlying LLM's knowledge or reasoning ability.`;

export function buildJudgeUserPrompt(
	rounds: {
		userMessage: string;
		expectedResponse?: string;
		results: AgentResult[];
	}[],
): string {
	const parts: string[] = ["## Scenario\n"];

	for (let i = 0; i < rounds.length; i++) {
		const round = rounds[i];
		parts.push(`### Round ${i + 1}`);
		parts.push(`**User:** ${round.userMessage}\n`);

		if (round.expectedResponse) {
			parts.push(`**Expected Response:** ${round.expectedResponse}\n`);
		}

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
	rounds: {
		userMessage: string;
		expectedResponse?: string;
		results: AgentResult[];
	}[],
	targetRoundIndex: number,
): string {
	const parts: string[] = ["## Scenario\n"];

	for (let i = 0; i <= targetRoundIndex; i++) {
		const round = rounds[i];
		parts.push(`### Round ${i + 1}`);
		parts.push(`**User:** ${round.userMessage}\n`);

		if (round.expectedResponse) {
			parts.push(`**Expected Response:** ${round.expectedResponse}\n`);
		}

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
