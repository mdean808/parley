import Anthropic from "@anthropic-ai/sdk";
import type { AgentResult } from "core/types";
import {
	buildJudgeRoundPrompt,
	buildJudgeUserPrompt,
	JUDGE_SYSTEM_PROMPT,
} from "./judge-prompt.ts";
import type {
	JudgeConfig,
	JudgeEvaluation,
	JudgeResult,
	JudgeUsage,
	MultiAgentRubric,
	QualityRubric,
} from "./judge-types.ts";

const EMPTY_QUALITY_RUBRIC: QualityRubric = {
	addressesRequest: false,
	coherentDelivery: false,
	sufficientDepth: false,
	noMajorOmissions: false,
	efficientResolution: false,
};

const EMPTY_MULTI_AGENT_RUBRIC: MultiAgentRubric = {
	multipleAgentsContributed: false,
	distinctRoles: false,
	minimalRedundancy: false,
	complementaryCoverage: false,
	effectiveCoordination: false,
};

function countTrues(obj: QualityRubric | MultiAgentRubric): number {
	return Object.values(obj).filter(Boolean).length;
}

function buildEvaluateTool(): Anthropic.Messages.Tool {
	return {
		name: "evaluate",
		description: "Submit evaluation of agent responses.",
		input_schema: {
			type: "object" as const,
			properties: {
				pass: {
					type: "boolean",
					description:
						"Did the agents answer the question / complete the task?",
				},
				pass_reasoning: {
					type: "string",
					maxLength: 300,
					description: "Why pass or fail",
				},
				// Quality rubric booleans
				addresses_request: {
					type: "boolean",
					description:
						"The final output directly answers the question or completes the task.",
				},
				coherent_delivery: {
					type: "boolean",
					description:
						"The response is logically organized and easy to follow as a final product.",
				},
				sufficient_depth: {
					type: "boolean",
					description:
						"The response provides enough detail to be useful, not just surface-level.",
				},
				no_major_omissions: {
					type: "boolean",
					description: "Key aspects of the request are not ignored.",
				},
				efficient_resolution: {
					type: "boolean",
					description:
						"The task was completed without excessive back-and-forth or protocol overhead.",
				},
				// Multi-agent rubric booleans
				multiple_agents_contributed: {
					type: "boolean",
					description: "More than one agent provided a substantive response.",
				},
				distinct_roles: {
					type: "boolean",
					description:
						"Each responding agent addressed the task using different skills or perspectives.",
				},
				minimal_redundancy: {
					type: "boolean",
					description:
						"Agents did not substantially duplicate each other's work.",
				},
				complementary_coverage: {
					type: "boolean",
					description:
						"Agents addressed different aspects of the request, improving overall completeness.",
				},
				effective_coordination: {
					type: "boolean",
					description:
						"Agents built on or referenced each other's contributions without contradiction or wasted cycles.",
				},
				summary: {
					type: "string",
					maxLength: 500,
				},
				expectation_alignment: {
					type: "integer",
					minimum: 1,
					maximum: 5,
					description:
						"How well agents addressed the expected response criteria (1-5). Only include when an expected response was provided.",
				},
				expectation_alignment_reasoning: {
					type: "string",
					maxLength: 300,
				},
			},
			required: [
				"pass",
				"pass_reasoning",
				"addresses_request",
				"coherent_delivery",
				"sufficient_depth",
				"no_major_omissions",
				"efficient_resolution",
				"multiple_agents_contributed",
				"distinct_roles",
				"minimal_redundancy",
				"complementary_coverage",
				"effective_coordination",
				"summary",
			],
		},
	};
}

function parseJudgeResponse(
	response: Anthropic.Messages.Message,
): JudgeEvaluation {
	const toolUse = response.content.find(
		(block): block is Anthropic.Messages.ToolUseBlock =>
			block.type === "tool_use",
	);

	if (!toolUse) {
		return {
			pass: false,
			qualityScore: 0,
			multiAgentValue: 0,
			qualityRubric: { ...EMPTY_QUALITY_RUBRIC },
			multiAgentRubric: { ...EMPTY_MULTI_AGENT_RUBRIC },
			summary: "Judge failed to respond with tool use.",
			passReasoning: "No tool response from judge.",
		};
	}

	const input = toolUse.input as Record<string, unknown>;

	const qualityRubric: QualityRubric = {
		addressesRequest: Boolean(input.addresses_request),
		coherentDelivery: Boolean(input.coherent_delivery),
		sufficientDepth: Boolean(input.sufficient_depth),
		noMajorOmissions: Boolean(input.no_major_omissions),
		efficientResolution: Boolean(input.efficient_resolution),
	};

	const multiAgentRubric: MultiAgentRubric = {
		multipleAgentsContributed: Boolean(input.multiple_agents_contributed),
		distinctRoles: Boolean(input.distinct_roles),
		minimalRedundancy: Boolean(input.minimal_redundancy),
		complementaryCoverage: Boolean(input.complementary_coverage),
		effectiveCoordination: Boolean(input.effective_coordination),
	};

	return {
		pass: Boolean(input.pass),
		qualityScore: countTrues(qualityRubric),
		multiAgentValue: countTrues(multiAgentRubric),
		qualityRubric,
		multiAgentRubric,
		summary: String(input.summary ?? ""),
		passReasoning: String(input.pass_reasoning ?? ""),
		expectationAlignment: input.expectation_alignment
			? Math.min(
					5,
					Math.max(1, Math.round(Number(input.expectation_alignment))),
				)
			: undefined,
		expectationAlignmentReasoning: input.expectation_alignment_reasoning
			? String(input.expectation_alignment_reasoning)
			: undefined,
	};
}

export async function evaluateScenario(
	rounds: {
		userMessage: string;
		expectedResponse?: string;
		results: AgentResult[];
	}[],
	config: JudgeConfig,
): Promise<JudgeResult> {
	const model = config.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-4-6";

	const judgeClient = new Anthropic();
	const userPrompt = buildJudgeUserPrompt(rounds);
	const tool = buildEvaluateTool();

	const usage: JudgeUsage = {
		inputTokens: 0,
		outputTokens: 0,
		model,
		durationMs: 0,
		callCount: 0,
	};

	const start = performance.now();
	const response = await judgeClient.messages.create({
		model,
		max_tokens: 2048,
		system: JUDGE_SYSTEM_PROMPT,
		messages: [{ role: "user", content: userPrompt }],
		tools: [tool],
		tool_choice: { type: "tool", name: "evaluate" },
	});

	usage.inputTokens += response.usage.input_tokens;
	usage.outputTokens += response.usage.output_tokens;
	usage.callCount++;
	usage.durationMs = performance.now() - start;

	const evaluation = parseJudgeResponse(response);

	return {
		perRound: [evaluation],
		aggregate: evaluation,
		usage,
	};
}

export async function evaluateRound(
	conversationSoFar: {
		userMessage: string;
		expectedResponse?: string;
		results: AgentResult[];
	}[],
	targetRoundIndex: number,
	config: JudgeConfig,
): Promise<{ evaluation: JudgeEvaluation; usage: JudgeUsage }> {
	const model = config.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-4-6";

	const judgeClient = new Anthropic();
	const userPrompt = buildJudgeRoundPrompt(conversationSoFar, targetRoundIndex);
	const tool = buildEvaluateTool();

	const usage: JudgeUsage = {
		inputTokens: 0,
		outputTokens: 0,
		model,
		durationMs: 0,
		callCount: 0,
	};

	const start = performance.now();
	const response = await judgeClient.messages.create({
		model,
		max_tokens: 2048,
		system: JUDGE_SYSTEM_PROMPT,
		messages: [{ role: "user", content: userPrompt }],
		tools: [tool],
		tool_choice: { type: "tool", name: "evaluate" },
	});

	usage.inputTokens += response.usage.input_tokens;
	usage.outputTokens += response.usage.output_tokens;
	usage.callCount++;
	usage.durationMs = performance.now() - start;

	const evaluation = parseJudgeResponse(response);

	return { evaluation, usage };
}
