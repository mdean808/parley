import { MODEL } from "../config.ts";
import { computeCost } from "../cost.ts";
import type { AgentResult, Protocol } from "../types.ts";
import { evaluateRound, evaluateScenario } from "./judge.ts";
import type {
	DimensionScore,
	JudgeConfig,
	JudgeEvaluation,
	JudgeUsage,
} from "./judge-types.ts";
import { runMultiRound } from "./multi-round.ts";
import type {
	AgentRoundResult,
	ProtocolId,
	ProtocolRunResult,
	RoundResult,
	ScenarioConfig,
} from "./types.ts";

export { runMultiRound } from "./multi-round.ts";

function toJudgeRoundData(
	rounds: RoundResult[],
): { userMessage: string; results: AgentResult[] }[] {
	return rounds.map((r) => ({
		userMessage: r.prompt,
		results: r.agents.map((a) => ({
			agentName: a.agentName,
			skills: a.skills,
			response: {
				id: "",
				chainId: "",
				replyTo: undefined,
				timestamp: "",
				type: "RESPONSE" as const,
				payload: a.responseText,
				from: a.agentName.toLowerCase(),
				to: [] as string[],
			},
			usage: { inputTokens: a.inputTokens, outputTokens: a.outputTokens },
			model: a.model,
			durationMs: a.durationMs,
		})),
	}));
}

function aggregatePerRoundJudge(rounds: RoundResult[]): {
	aggregate: JudgeEvaluation;
	usage: JudgeUsage;
} {
	const allEvals = rounds
		.map((r) => r.judge)
		.filter((j): j is JudgeEvaluation => j != null);

	if (allEvals.length === 0) {
		return {
			aggregate: { dimensions: [], overall: 0, summary: "" },
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				model: "",
				durationMs: 0,
				callCount: 0,
			},
		};
	}

	// Average dimension scores across rounds
	const dimMap = new Map<
		string,
		{ total: number; count: number; reasonings: string[] }
	>();
	for (const evaluation of allEvals) {
		for (const d of evaluation.dimensions) {
			const existing = dimMap.get(d.dimension);
			if (existing) {
				existing.total += d.score;
				existing.count++;
				existing.reasonings.push(d.reasoning);
			} else {
				dimMap.set(d.dimension, {
					total: d.score,
					count: 1,
					reasonings: [d.reasoning],
				});
			}
		}
	}

	const avgDimensions: DimensionScore[] = [];
	for (const [dimension, data] of dimMap) {
		avgDimensions.push({
			dimension,
			score: Math.round((data.total / data.count) * 10) / 10,
			reasoning: `Average across ${data.count} rounds`,
		});
	}

	const avgOverall =
		allEvals.reduce((s, e) => s + e.overall, 0) / allEvals.length;

	return {
		aggregate: {
			dimensions: avgDimensions,
			overall: Math.round(avgOverall * 10) / 10,
			summary: `Aggregate of ${allEvals.length} per-round evaluations`,
		},
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			model: "",
			durationMs: 0,
			callCount: 0,
		},
	};
}

export async function runScenario(
	protocol: Protocol,
	protocolId: ProtocolId,
	scenario: ScenarioConfig,
	judgeConfig?: JudgeConfig,
): Promise<ProtocolRunResult> {
	const { userId } = await protocol.initialize("BenchUser");
	const chainId = crypto.randomUUID();

	// Delegate to multi-round runner if configured
	if (scenario.multiRound && scenario.multiRound.rounds > 1) {
		const mr = await runMultiRound(scenario, protocol, userId, chainId);
		// Convert MultiRoundResult to ProtocolRunResult
		const rounds: RoundResult[] = mr.rounds.map((rm) => {
			const agents: AgentRoundResult[] = rm.results.map((r) => {
				const inputTokens = r.usage?.inputTokens ?? 0;
				const outputTokens = r.usage?.outputTokens ?? 0;
				const model = r.model ?? MODEL;
				return {
					agentName: r.agentName,
					skills: r.skills,
					responseText: r.response.payload,
					inputTokens,
					outputTokens,
					cost: computeCost(inputTokens, outputTokens, model),
					durationMs: r.durationMs ?? 0,
					model,
				};
			});
			return {
				roundIndex: rm.roundIndex,
				prompt: rm.prompt,
				agents,
				totalInputTokens: rm.totalInputTokens,
				totalOutputTokens: rm.totalOutputTokens,
				totalCost: rm.cost,
				totalDurationMs: rm.totalDurationMs,
				respondingAgentCount: agents.length,
			};
		});
		// Per-round judge evaluation for multi-round scenarios
		if (judgeConfig?.enabled) {
			const roundData = toJudgeRoundData(rounds);
			const judgeUsage: JudgeUsage = {
				inputTokens: 0,
				outputTokens: 0,
				model:
					judgeConfig.model ??
					process.env.JUDGE_MODEL ??
					"claude-sonnet-4-5-20250929",
				durationMs: 0,
				callCount: 0,
			};

			for (let i = 0; i < rounds.length; i++) {
				const context = roundData.slice(0, i + 1);
				const { evaluation, usage } = await evaluateRound(
					context,
					i,
					judgeConfig,
				);
				rounds[i].judge = evaluation;
				judgeUsage.inputTokens += usage.inputTokens;
				judgeUsage.outputTokens += usage.outputTokens;
				judgeUsage.durationMs += usage.durationMs;
				judgeUsage.callCount += usage.callCount;
			}

			const { aggregate: judgeAggregate } = aggregatePerRoundJudge(rounds);

			return {
				protocolId,
				scenarioName: scenario.name,
				rounds,
				aggregate: {
					totalInputTokens: mr.cumulative.totalInputTokens,
					totalOutputTokens: mr.cumulative.totalOutputTokens,
					totalCost: mr.cumulative.totalCost,
					totalDurationMs: mr.cumulative.totalDurationMs,
					averageAgentsPerRound:
						rounds.reduce((s, r) => s + r.respondingAgentCount, 0) /
						rounds.length,
					roundCount: mr.cumulative.roundCount,
				},
				judge: {
					perRound: rounds
						.map((r) => r.judge)
						.filter((j): j is JudgeEvaluation => j != null),
					aggregate: judgeAggregate,
					usage: judgeUsage,
				},
			};
		}

		return {
			protocolId,
			scenarioName: scenario.name,
			rounds,
			aggregate: {
				totalInputTokens: mr.cumulative.totalInputTokens,
				totalOutputTokens: mr.cumulative.totalOutputTokens,
				totalCost: mr.cumulative.totalCost,
				totalDurationMs: mr.cumulative.totalDurationMs,
				averageAgentsPerRound:
					rounds.reduce((s, r) => s + r.respondingAgentCount, 0) /
					rounds.length,
				roundCount: mr.cumulative.roundCount,
			},
		};
	}

	const rounds: RoundResult[] = [];

	for (let i = 0; i < scenario.rounds.length; i++) {
		const prompt = scenario.rounds[i].prompt;
		const roundStart = performance.now();

		const { results } = await protocol.sendRequest(userId, prompt, chainId);

		const roundDurationMs = performance.now() - roundStart;

		const agents: AgentRoundResult[] = results.map((r) => {
			const inputTokens = r.usage?.inputTokens ?? 0;
			const outputTokens = r.usage?.outputTokens ?? 0;
			const model = r.model ?? MODEL;
			return {
				agentName: r.agentName,
				skills: r.skills,
				responseText: r.response.payload,
				inputTokens,
				outputTokens,
				cost: computeCost(inputTokens, outputTokens, model),
				durationMs: r.durationMs ?? 0,
				model,
			};
		});

		const totalInputTokens = agents.reduce((s, a) => s + a.inputTokens, 0);
		const totalOutputTokens = agents.reduce((s, a) => s + a.outputTokens, 0);
		const totalCost = agents.reduce((s, a) => s + a.cost, 0);

		rounds.push({
			roundIndex: i,
			prompt,
			agents,
			totalInputTokens,
			totalOutputTokens,
			totalCost,
			totalDurationMs: roundDurationMs,
			respondingAgentCount: agents.length,
		});
	}

	const aggregate = {
		totalInputTokens: rounds.reduce((s, r) => s + r.totalInputTokens, 0),
		totalOutputTokens: rounds.reduce((s, r) => s + r.totalOutputTokens, 0),
		totalCost: rounds.reduce((s, r) => s + r.totalCost, 0),
		totalDurationMs: rounds.reduce((s, r) => s + r.totalDurationMs, 0),
		averageAgentsPerRound:
			rounds.reduce((s, r) => s + r.respondingAgentCount, 0) / rounds.length,
		roundCount: rounds.length,
	};

	// Single-round judge evaluation
	if (judgeConfig?.enabled) {
		const roundData = toJudgeRoundData(rounds);
		const judgeResult = await evaluateScenario(roundData, judgeConfig);
		if (rounds.length > 0) {
			rounds[0].judge = judgeResult.aggregate;
		}
		return {
			protocolId,
			scenarioName: scenario.name,
			rounds,
			aggregate,
			judge: judgeResult,
		};
	}

	return {
		protocolId,
		scenarioName: scenario.name,
		rounds,
		aggregate,
	};
}
