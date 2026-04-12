import Anthropic from "@anthropic-ai/sdk";
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
import type { AgentProbeResult } from "./types.ts";

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

function buildEvaluateTool(
	pattern: InteractionPattern,
): Anthropic.Messages.Tool {
	const fields = RUBRIC_FIELDS[pattern];
	const properties: Record<string, object> = {};

	properties.pass = {
		type: "boolean",
		description: "Did the agents interact correctly for this pattern?",
	};
	properties.pass_reasoning = {
		type: "string",
		maxLength: 300,
		description: "Why pass or fail — focus on interaction quality.",
	};

	for (const field of fields) {
		properties[field] = {
			type: "boolean",
			description: `Rubric dimension: ${field.replace(/_/g, " ")}`,
		};
	}

	properties.content_adequate = {
		type: "boolean",
		description: "Minor check: the response is not complete nonsense.",
	};
	properties.summary = {
		type: "string",
		maxLength: 300,
	};

	return {
		name: "evaluate",
		description: "Submit interaction quality evaluation.",
		input_schema: {
			type: "object" as const,
			properties,
			required: [
				"pass",
				"pass_reasoning",
				...fields,
				"content_adequate",
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
			contentAdequate: false,
			rubric: {},
			summary: "Judge failed to respond with tool use.",
			passReasoning: "No tool response from judge.",
		};
	}

	const input = toolUse.input as Record<string, unknown>;
	const fields = RUBRIC_FIELDS[pattern];
	const rubric: Record<string, boolean> = {};

	for (const field of fields) {
		rubric[field] = Boolean(input[field]);
	}

	const interactionScore = Object.values(rubric).filter(Boolean).length;

	return {
		pass: Boolean(input.pass),
		interactionScore,
		contentAdequate: Boolean(input.content_adequate),
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
): Promise<{ evaluation: JudgeEvaluation; usage: JudgeUsage }> {
	const model = config.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-4-6";
	const client = new Anthropic();

	const systemPrompt = buildJudgeSystemPrompt(pattern);
	const userPrompt = buildJudgeUserPrompt(prompt, targetSkills, agents);
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
