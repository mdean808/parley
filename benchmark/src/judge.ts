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
} from "./judge-types.ts";

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
				quality_score: {
					type: "integer",
					minimum: 1,
					maximum: 5,
					description: "Overall quality 1-5",
				},
				quality_reasoning: {
					type: "string",
					maxLength: 300,
				},
				multi_agent_value: {
					type: "integer",
					minimum: 1,
					maximum: 5,
					description:
						"Did multiple agents add distinct value? 1-5. Score 1 for single-agent protocols.",
				},
				multi_agent_reasoning: {
					type: "string",
					maxLength: 300,
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
				"quality_score",
				"quality_reasoning",
				"multi_agent_value",
				"multi_agent_reasoning",
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
			qualityScore: 1,
			multiAgentValue: 1,
			summary: "Judge failed to respond with tool use.",
			passReasoning: "No tool response from judge.",
			qualityReasoning: "",
			multiAgentReasoning: "",
		};
	}

	const input = toolUse.input as Record<string, unknown>;

	return {
		pass: Boolean(input.pass),
		qualityScore: Math.min(
			5,
			Math.max(1, Math.round(Number(input.quality_score) || 3)),
		),
		multiAgentValue: Math.min(
			5,
			Math.max(1, Math.round(Number(input.multi_agent_value) || 1)),
		),
		summary: String(input.summary ?? ""),
		passReasoning: String(input.pass_reasoning ?? ""),
		qualityReasoning: String(input.quality_reasoning ?? ""),
		multiAgentReasoning: String(input.multi_agent_reasoning ?? ""),
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
