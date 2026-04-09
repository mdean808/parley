import { MODEL } from "../config.ts";
import { createProtocol, getProtocolIds } from "../factory.ts";
import type { JudgeConfig } from "./judge-types.ts";
import { runScenario } from "./runner.ts";
import {
	loadAllScenarios,
	loadScenario,
	loadScenariosByCategory,
	type Scenario,
} from "./scenarios/index.ts";
import type { ProtocolRunResult, ScenarioConfig } from "./types.ts";

export interface OverheadMetrics {
	extraInputTokens: number;
	extraOutputTokens: number;
	extraInputPercent: number;
	extraOutputPercent: number;
	extraDurationMs: number;
	extraDurationPercent: number;
}

/** Maps non-baseline protocol IDs to their overhead vs the baseline. */
export type ProtocolOverhead = Record<string, OverheadMetrics>;

export interface ScenarioComparison {
	scenario: Scenario;
	results: Record<string, ProtocolRunResult>;
	protocolOverhead: ProtocolOverhead;
}

export interface AggregateComparison {
	avgScores: Record<string, number>;
	avgOverhead: ProtocolOverhead;
	agentParticipation: Record<string, Record<string, number>>;
}

export interface ComparisonReport {
	generatedAt: string;
	model: string;
	protocolIds: string[];
	baseline: string;
	scenarios: ScenarioComparison[];
	aggregate: AggregateComparison;
}

export interface ComparisonOptions {
	scenarios?: string[];
	categories?: string[];
	protocols?: string[];
	baseline?: string;
	model?: string;
	outputDir?: string;
	judgeConfig?: JudgeConfig;
	onProgress?: (msg: string) => void;
}

function computeOverhead(
	protocol: ProtocolRunResult,
	baseline: ProtocolRunResult,
): OverheadMetrics {
	const extraInputTokens =
		protocol.aggregate.totalInputTokens - baseline.aggregate.totalInputTokens;
	const extraOutputTokens =
		protocol.aggregate.totalOutputTokens - baseline.aggregate.totalOutputTokens;
	const extraDurationMs =
		protocol.aggregate.totalDurationMs - baseline.aggregate.totalDurationMs;

	const baseIn = baseline.aggregate.totalInputTokens || 1;
	const baseOut = baseline.aggregate.totalOutputTokens || 1;
	const baseDur = baseline.aggregate.totalDurationMs || 1;

	return {
		extraInputTokens,
		extraOutputTokens,
		extraInputPercent: (extraInputTokens / baseIn) * 100,
		extraOutputPercent: (extraOutputTokens / baseOut) * 100,
		extraDurationMs,
		extraDurationPercent: (extraDurationMs / baseDur) * 100,
	};
}

function toScenarioConfig(s: Scenario): ScenarioConfig {
	return {
		name: s.name,
		topic: s.topic,
		rounds: s.rounds.map((r) => ({ prompt: r.prompt })),
		multiRound: s.multiRound
			? {
					rounds: s.multiRound.rounds,
					followUpInstruction: s.multiRound.followUpInstruction,
					crossAgentContext: s.multiRound.crossAgentContext,
				}
			: undefined,
	};
}

export async function runComparison(
	options: ComparisonOptions = {},
): Promise<ComparisonReport> {
	const progress = options.onProgress ?? (() => {});
	const protocolIds = options.protocols ?? getProtocolIds();
	const baseline = options.baseline ?? protocolIds[0];
	const judgeConfig: JudgeConfig = options.judgeConfig ?? {
		enabled: true,
	};

	// Load scenarios
	let scenarios: Scenario[];
	if (options.scenarios) {
		scenarios = await Promise.all(options.scenarios.map((id) => loadScenario(id)));
	} else if (options.categories) {
		const results = await Promise.all(options.categories.map((c) => loadScenariosByCategory(c)));
		scenarios = results.flat();
	} else {
		scenarios = await loadAllScenarios();
	}

	const scenarioComparisons: ScenarioComparison[] = [];

	for (let si = 0; si < scenarios.length; si++) {
		const scenario = scenarios[si];
		const scenarioConfig = toScenarioConfig(scenario);
		const results: Record<string, ProtocolRunResult> = {};

		for (const pid of protocolIds) {
			progress(`[${si + 1}/${scenarios.length}] ${scenario.name} -- ${pid}...`);

			try {
				const protocol = createProtocol(pid);
				if (judgeConfig.enabled) {
					progress(
						`[${si + 1}/${scenarios.length}] ${scenario.name} -- ${pid} judging...`,
					);
				}
				const result = await runScenario(
					protocol,
					pid,
					scenarioConfig,
					judgeConfig,
				);

				results[pid] = result;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				progress(
					`[${si + 1}/${scenarios.length}] ${scenario.name} -- ${pid} ERROR: ${msg}`,
				);
				results[pid] = {
					protocolId: pid,
					scenarioName: scenarioConfig.name,
					rounds: [],
					aggregate: {
						totalInputTokens: 0,
						totalOutputTokens: 0,
						totalCost: 0,
						totalDurationMs: 0,
						averageAgentsPerRound: 0,
						roundCount: 0,
					},
					error: msg,
				};
			}
		}

		// Compute overhead for each non-baseline protocol (skip if either errored)
		const protocolOverhead: ProtocolOverhead = {};
		for (const pid of protocolIds) {
			if (pid !== baseline && !results[pid].error && !results[baseline].error) {
				protocolOverhead[pid] = computeOverhead(
					results[pid],
					results[baseline],
				);
			}
		}

		scenarioComparisons.push({
			scenario,
			results,
			protocolOverhead,
		});
	}

	// Compute aggregate
	const avgScores: Record<string, number> = {};
	for (const pid of protocolIds) avgScores[pid] = 0;

	const agentParticipation: Record<string, Record<string, number>> = {};

	for (const pid of protocolIds) {
		let scoreSum = 0;
		let scoreCount = 0;

		for (const sc of scenarioComparisons) {
			const result = sc.results[pid];
			if (result.judge) {
				scoreSum += result.judge.aggregate.overall;
				scoreCount++;
			}

			// Track agent participation
			for (const round of result.rounds) {
				for (const agent of round.agents) {
					if (!agentParticipation[agent.agentName]) {
						agentParticipation[agent.agentName] = {};
						for (const p of protocolIds)
							agentParticipation[agent.agentName][p] = 0;
					}
					agentParticipation[agent.agentName][pid]++;
				}
			}
		}

		avgScores[pid] = scoreCount > 0 ? scoreSum / scoreCount : 0;
	}

	// Average overhead across scenarios for each non-baseline protocol
	const avgOverhead: ProtocolOverhead = {};
	for (const pid of protocolIds) {
		if (pid !== baseline) {
			const overheads = scenarioComparisons
				.map((sc) => sc.protocolOverhead[pid])
				.filter((o): o is OverheadMetrics => o != null);
			avgOverhead[pid] = averageOverhead(overheads);
		}
	}

	return {
		generatedAt: new Date().toISOString(),
		model: MODEL,
		protocolIds,
		baseline,
		scenarios: scenarioComparisons,
		aggregate: {
			avgScores,
			avgOverhead,
			agentParticipation,
		},
	};
}

function averageOverhead(overheads: OverheadMetrics[]): OverheadMetrics {
	const n = overheads.length || 1;
	return {
		extraInputTokens: overheads.reduce((s, o) => s + o.extraInputTokens, 0) / n,
		extraOutputTokens:
			overheads.reduce((s, o) => s + o.extraOutputTokens, 0) / n,
		extraInputPercent:
			overheads.reduce((s, o) => s + o.extraInputPercent, 0) / n,
		extraOutputPercent:
			overheads.reduce((s, o) => s + o.extraOutputPercent, 0) / n,
		extraDurationMs: overheads.reduce((s, o) => s + o.extraDurationMs, 0) / n,
		extraDurationPercent:
			overheads.reduce((s, o) => s + o.extraDurationPercent, 0) / n,
	};
}
