import { computeCost } from "../cost.ts";
import type { Protocol } from "../types.ts";
import { concatenateSynthesizer } from "./synthesizers.ts";
import type {
	MultiRoundResult,
	RoundMetrics,
	ScenarioConfig,
} from "./types.ts";

export async function runMultiRound(
	scenario: ScenarioConfig,
	protocol: Protocol,
	userId: string,
	chainId: string,
): Promise<MultiRoundResult> {
	const config = scenario.multiRound as NonNullable<typeof scenario.multiRound>;
	const synthesizer = config.synthesizer ?? concatenateSynthesizer;
	const totalRounds = config.rounds;

	const rounds: RoundMetrics[] = [];
	let stoppedEarly = false;

	for (let i = 0; i < totalRounds; i++) {
		let prompt: string;
		if (i === 0) {
			// First round uses the first scenario round prompt
			prompt = scenario.rounds[0]?.prompt ?? scenario.topic;
		} else {
			// Subsequent rounds use synthesizer to build prompt from previous results
			const prevResults = rounds[i - 1].results;
			prompt = synthesizer(
				i,
				prevResults,
				scenario.rounds[0]?.prompt ?? scenario.topic,
			);
		}

		const roundStart = performance.now();
		const { results } = await protocol.sendRequest(userId, prompt, chainId);
		const roundDurationMs = performance.now() - roundStart;

		const totalInputTokens = results.reduce(
			(s, r) => s + (r.usage?.inputTokens ?? 0),
			0,
		);
		const totalOutputTokens = results.reduce(
			(s, r) => s + (r.usage?.outputTokens ?? 0),
			0,
		);
		const model = results[0]?.model ?? "";
		const cost = computeCost(totalInputTokens, totalOutputTokens, model);

		rounds.push({
			roundIndex: i,
			prompt,
			results,
			totalInputTokens,
			totalOutputTokens,
			totalDurationMs: roundDurationMs,
			cost,
		});

		// Check stop condition
		if (config.stopCondition?.(i, results)) {
			stoppedEarly = true;
			break;
		}
	}

	return {
		scenarioName: scenario.name,
		protocol: "unknown",
		rounds,
		cumulative: {
			totalInputTokens: rounds.reduce((s, r) => s + r.totalInputTokens, 0),
			totalOutputTokens: rounds.reduce((s, r) => s + r.totalOutputTokens, 0),
			totalDurationMs: rounds.reduce((s, r) => s + r.totalDurationMs, 0),
			totalCost: rounds.reduce((s, r) => s + r.cost, 0),
			roundCount: rounds.length,
			stoppedEarly,
		},
	};
}
