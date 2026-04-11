import Anthropic from "@anthropic-ai/sdk";
import type { AgentResult } from "core/types";
import {
	buildJudgeRoundPrompt,
	buildJudgeUserPrompt,
	JUDGE_SYSTEM_PROMPT,
} from "./judge-prompt.ts";
import type {
	DimensionScore,
	JudgeConfig,
	JudgeEvaluation,
	JudgeResult,
	JudgeUsage,
} from "./judge-types.ts";

const SINGLE_ROUND_DIMENSIONS = [
	"relevance",
	"information_density",
	"redundancy",
	"summarization_quality",
];

const MULTI_ROUND_DIMENSIONS = [...SINGLE_ROUND_DIMENSIONS, "coherence"];

const DIMENSION_WEIGHTS: Record<string, number> = {
	relevance: 0.3,
	information_density: 0.2,
	redundancy: 0.2,
	summarization_quality: 0.2,
	coherence: 0.1,
};

const SINGLE_ROUND_WEIGHTS: Record<string, number> = {
	relevance: 0.35,
	information_density: 0.25,
	redundancy: 0.2,
	summarization_quality: 0.2,
};

function buildEvaluateTool(dimensions: string[]): Anthropic.Messages.Tool {
	return {
		name: "evaluate",
		description: "Submit evaluation scores for agent responses.",
		input_schema: {
			type: "object" as const,
			properties: {
				dimensions: {
					type: "array",
					items: {
						type: "object",
						properties: {
							dimension: {
								type: "string",
								enum: dimensions,
							},
							score: {
								type: "integer",
								minimum: 1,
								maximum: 5,
							},
							reasoning: {
								type: "string",
								maxLength: 500,
							},
						},
						required: ["dimension", "score", "reasoning"],
					},
				},
				summary: {
					type: "string",
					maxLength: 1000,
				},
			},
			required: ["dimensions", "summary"],
		},
	};
}

function computeWeightedOverall(
	dimensions: DimensionScore[],
	isMultiRound: boolean,
): number {
	const weights = isMultiRound ? DIMENSION_WEIGHTS : SINGLE_ROUND_WEIGHTS;
	let totalWeight = 0;
	let weightedSum = 0;

	for (const d of dimensions) {
		const w = weights[d.dimension] ?? 0;
		weightedSum += d.score * w;
		totalWeight += w;
	}

	return totalWeight > 0 ? weightedSum / totalWeight : 3;
}

export async function evaluateScenario(
	rounds: { userMessage: string; results: AgentResult[] }[],
	config: JudgeConfig,
): Promise<JudgeResult> {
	const model =
		config.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-4-5-20250929";

	const isMultiRound = rounds.length > 1;
	const dimensions = isMultiRound
		? MULTI_ROUND_DIMENSIONS
		: SINGLE_ROUND_DIMENSIONS;

	const judgeClient = new Anthropic();
	const userPrompt = buildJudgeUserPrompt(rounds, isMultiRound);
	const tool = buildEvaluateTool(dimensions);

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

	const evaluation = parseJudgeResponse(response, dimensions, isMultiRound);

	return {
		perRound: [evaluation],
		aggregate: evaluation,
		usage,
	};
}

function parseJudgeResponse(
	response: Anthropic.Messages.Message,
	dimensions: string[],
	isMultiRound: boolean,
): JudgeEvaluation {
	const toolUse = response.content.find(
		(block): block is Anthropic.Messages.ToolUseBlock =>
			block.type === "tool_use",
	);

	let parsedDimensions: DimensionScore[] = [];
	let summary = "";

	if (toolUse) {
		const input = toolUse.input as {
			dimensions?: unknown;
			summary?: string;
		};

		let rawDims: { dimension: string; score: number; reasoning: string }[] = [];
		if (Array.isArray(input.dimensions)) {
			rawDims = input.dimensions;
		} else if (typeof input.dimensions === "string") {
			try {
				const parsed = JSON.parse(input.dimensions);
				if (Array.isArray(parsed)) rawDims = parsed;
			} catch {}
		}

		parsedDimensions = rawDims.map((d) => ({
			dimension: d.dimension,
			score: Math.min(5, Math.max(1, Math.round(d.score))),
			reasoning: d.reasoning ?? "",
		}));

		summary = input.summary ?? "";
	}

	for (const dim of dimensions) {
		if (!parsedDimensions.find((d) => d.dimension === dim)) {
			parsedDimensions.push({
				dimension: dim,
				score: 3,
				reasoning: "Not evaluated by judge.",
			});
		}
	}

	const overall = computeWeightedOverall(parsedDimensions, isMultiRound);

	return {
		dimensions: parsedDimensions,
		overall,
		summary,
	};
}

export async function evaluateRound(
	conversationSoFar: { userMessage: string; results: AgentResult[] }[],
	targetRoundIndex: number,
	config: JudgeConfig,
): Promise<{ evaluation: JudgeEvaluation; usage: JudgeUsage }> {
	const model =
		config.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-4-5-20250929";

	const isMultiRound = targetRoundIndex > 0;
	const dimensions = isMultiRound
		? MULTI_ROUND_DIMENSIONS
		: SINGLE_ROUND_DIMENSIONS;

	const judgeClient = new Anthropic();
	const userPrompt = buildJudgeRoundPrompt(conversationSoFar, targetRoundIndex);
	const tool = buildEvaluateTool(dimensions);

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

	const evaluation = parseJudgeResponse(response, dimensions, isMultiRound);

	return { evaluation, usage };
}
