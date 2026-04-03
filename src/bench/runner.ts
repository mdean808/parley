import { MODEL } from "../config.ts";
import { computeCost } from "../cost.ts";
import type { Protocol } from "../types.ts";
import { runMultiRound } from "./multi-round.ts";
import type {
	AgentRoundResult,
	ProtocolId,
	ProtocolRunResult,
	RoundResult,
	ScenarioConfig,
} from "./types.ts";

export { runMultiRound } from "./multi-round.ts";

export async function runScenario(
	protocol: Protocol,
	protocolId: ProtocolId,
	scenario: ScenarioConfig,
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

	return {
		protocolId,
		scenarioName: scenario.name,
		rounds,
		aggregate,
	};
}
