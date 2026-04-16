import Anthropic from "@anthropic-ai/sdk";
import type { ProtocolAgentInfo } from "core/types";
import {
	buildJudgeSystemPrompt,
	buildJudgeUserPrompt,
} from "./judge-prompt.ts";
import type {
	InteractionPattern,
	JudgeConfig,
	JudgeEvaluation,
	JudgeUsage,
} from "./judge-types.ts";
import type {
	AgentProbeResult,
	AgentTerminalState,
	AssertionResult,
	DeclineInfo,
} from "./types.ts";

const RUBRIC_FIELDS: Record<InteractionPattern, string[]> = {
	"single-route": ["prompt_relevance", "skill_alignment", "clean_boundaries"],
	"selective-route": [
		"prompt_relevance",
		"skill_alignment",
		"clean_boundaries",
	],
	"decline-all": ["prompt_relevance", "skill_alignment", "clean_boundaries"],
	handoff: ["handoff_clarity", "context_preserved", "skill_alignment"],
	collaborate: ["distinct_contributions", "skill_alignment", "coherent_whole"],
};

const CONTENT_RUBRIC_FIELDS: string[] = [
	"content_depth",
	"content_accuracy",
	"content_completeness",
];

function buildEvaluateTool(
	pattern: InteractionPattern,
): Anthropic.Messages.Tool {
	const interactionFields = RUBRIC_FIELDS[pattern];
	const properties: Record<string, object> = {};

	properties.pass = {
		type: "boolean",
		description:
			"Did the agents interact correctly AND produce quality content?",
	};
	properties.pass_reasoning = {
		type: "string",
		maxLength: 300,
		description:
			"Why pass or fail — consider both interaction and content quality.",
	};

	for (const field of interactionFields) {
		properties[field] = {
			type: "boolean",
			description: `Interaction rubric: ${field.replace(/_/g, " ")}`,
		};
	}

	for (const field of CONTENT_RUBRIC_FIELDS) {
		properties[field] = {
			type: "boolean",
			description: `Content rubric: ${field.replace(/_/g, " ")}`,
		};
	}

	properties.summary = {
		type: "string",
		maxLength: 300,
	};

	return {
		name: "evaluate",
		description: "Submit interaction and content quality evaluation.",
		input_schema: {
			type: "object" as const,
			properties,
			required: [
				"pass",
				"pass_reasoning",
				...interactionFields,
				...CONTENT_RUBRIC_FIELDS,
				"summary",
			],
		},
	};
}

function parseJudgeResponse(
	response: Anthropic.Messages.Message,
	pattern: InteractionPattern,
): JudgeEvaluation {
	const toolUse = response.content.find(
		(block): block is Anthropic.Messages.ToolUseBlock =>
			block.type === "tool_use",
	);

	if (!toolUse) {
		return {
			pass: false,
			interactionScore: 0,
			contentScore: 0,
			compositeScore: 0,
			contentAdequate: false,
			rubric: {},
			summary: "Judge failed to respond with tool use.",
			passReasoning: "No tool response from judge.",
		};
	}

	const input = toolUse.input as Record<string, unknown>;
	const interactionFields = RUBRIC_FIELDS[pattern];
	const rubric: Record<string, boolean> = {};

	for (const field of interactionFields) {
		rubric[field] = Boolean(input[field]);
	}
	for (const field of CONTENT_RUBRIC_FIELDS) {
		rubric[field] = Boolean(input[field]);
	}

	const interactionScore = interactionFields.filter((f) => rubric[f]).length;
	const contentScore = CONTENT_RUBRIC_FIELDS.filter((f) => rubric[f]).length;
	const compositeScore =
		(interactionScore / 3) * 0.7 * 100 + (contentScore / 3) * 0.3 * 100;

	return {
		pass: Boolean(input.pass),
		interactionScore,
		contentScore,
		compositeScore,
		contentAdequate: contentScore >= 1,
		rubric,
		summary: String(input.summary ?? ""),
		passReasoning: String(input.pass_reasoning ?? ""),
	};
}

export async function evaluateProbe(
	prompt: string,
	targetSkills: string[],
	agents: AgentProbeResult[],
	pattern: InteractionPattern,
	config: JudgeConfig,
	declines?: DeclineInfo[],
	allAgents?: ProtocolAgentInfo[],
	terminalStates?: AgentTerminalState[],
	assertions?: AssertionResult,
): Promise<{ evaluation: JudgeEvaluation; usage: JudgeUsage }> {
	const model = config.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-4-6";
	const client = new Anthropic();

	const systemPrompt = buildJudgeSystemPrompt(pattern);
	const userPrompt = buildJudgeUserPrompt(
		prompt,
		targetSkills,
		agents,
		declines,
		allAgents,
		terminalStates,
		assertions,
	);
	const tool = buildEvaluateTool(pattern);

	const start = performance.now();
	const response = await client.messages.create({
		model,
		max_tokens: 1024,
		system: systemPrompt,
		messages: [{ role: "user", content: userPrompt }],
		tools: [tool],
		tool_choice: { type: "tool", name: "evaluate" },
	});

	const usage: JudgeUsage = {
		inputTokens: response.usage.input_tokens,
		outputTokens: response.usage.output_tokens,
		model,
		durationMs: performance.now() - start,
	};

	const evaluation = parseJudgeResponse(response, pattern);
	return { evaluation, usage };
}
