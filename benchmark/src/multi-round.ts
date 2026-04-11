import { computeCost } from "core/cost";
import type { Protocol } from "core/types";
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
	const followUp =
		config.followUpInstruction ??
		"Continue the conversation, building on your previous response.";
	const totalRounds = config.rounds;

	const rounds: RoundMetrics[] = [];
	let roundError: string | undefined;

	for (let i = 0; i < totalRounds; i++) {
		let prompt: string;
		if (i === 0) {
			prompt = scenario.rounds[0]?.prompt ?? scenario.topic;
		} else if (config.crossAgentContext) {
			const prevResults = rounds[i - 1].results;
			const agentSummary = prevResults
				.map((r) => `[${r.agentName}]: ${r.response.payload}`)
				.join("\n\n");
			prompt = `Other agents said:\n${agentSummary}\n\n${followUp}`;
		} else {
			prompt = followUp;
		}

		const roundStart = performance.now();
		let results: Awaited<ReturnType<typeof protocol.sendRequest>>["results"];
		try {
			({ results } = await protocol.sendRequest(userId, prompt, chainId));
		} catch (err) {
			roundError = `Round ${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`;
			break;
		}
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
		const costFromResults = results.reduce((s, r) => s + (r.cost ?? 0), 0);
		const cost =
			costFromResults ||
			computeCost(totalInputTokens, totalOutputTokens, model);

		rounds.push({
			roundIndex: i,
			prompt,
			results,
			totalInputTokens,
			totalOutputTokens,
			totalDurationMs: roundDurationMs,
			cost,
		});
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
			stoppedEarly: !!roundError,
			error: roundError,
		},
	};
}
