import { MODEL } from "core/config";
import { createProtocol, getProtocolIds } from "protocols/factory";
import type { JudgeConfig } from "./judge-types.ts";
import { runPool } from "./pool.ts";
import { ResultCollector, runScenario } from "./runner.ts";
import {
	loadAllScenarios,
	loadScenario,
	loadScenariosByCategory,
	type Scenario,
} from "./scenarios/index.ts";
import type { ProtocolRunResult, ScenarioConfig } from "./types.ts";

export interface ProtocolAggregateMetrics {
	successRate: number;
	avgQuality: number;
	avgTokensPerSuccess: number;
	avgLatencyPerSuccess: number;
	avgCostPerSuccess: number;
	avgCoordinationEfficiency: number;
	avgMultiAgentContribution: number;
	passedCount: number;
	totalCount: number;
}

export interface ScenarioComparison {
	scenario: Scenario;
	results: Record<string, ProtocolRunResult>;
}

export interface AggregateComparison {
	protocolMetrics: Record<string, ProtocolAggregateMetrics>;
	agentParticipation: Record<string, Record<string, number>>;
}

export interface ComparisonReport {
	generatedAt: string;
	model: string;
	protocolIds: string[];
	baseline?: string;
	scenarios: ScenarioComparison[];
	aggregate: AggregateComparison;
}

export type ProgressEvent =
	| {
			type: "start";
			scenarioName: string;
			protocolId: string;
			totalTasks: number;
	  }
	| { type: "phase"; scenarioName: string; protocolId: string; phase: string }
	| {
			type: "complete";
			scenarioName: string;
			protocolId: string;
			durationMs: number;
			error?: string;
	  };

export interface ComparisonOptions {
	scenarios?: string[];
	categories?: string[];
	protocols?: string[];
	baseline?: string;
	model?: string;
	outputDir?: string;
	judgeConfig?: JudgeConfig;
	concurrency?: number;
	onProgress?: (event: ProgressEvent) => void;
}

function toScenarioConfig(s: Scenario): ScenarioConfig {
	return {
		name: s.name,
		topic: s.topic,
		rounds: s.rounds.map((r) => ({
			prompt: r.prompt,
			expectedResponse: r.expectedResponse,
		})),
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
	const judgeConfig: JudgeConfig = options.judgeConfig ?? {
		enabled: true,
	};

	// Load scenarios
	let scenarios: Scenario[];
	if (options.scenarios) {
		scenarios = await Promise.all(
			options.scenarios.map((id) => loadScenario(id)),
		);
	} else if (options.categories) {
		const results = await Promise.all(
			options.categories.map((c) => loadScenariosByCategory(c)),
		);
		scenarios = results.flat();
	} else {
		scenarios = await loadAllScenarios();
	}

	const concurrency = options.concurrency ?? 3;

	interface TaskResult {
		scenarioIndex: number;
		protocolId: string;
		result: ProtocolRunResult;
	}

	const totalTasks = scenarios.length * protocolIds.length;
	const tasks = scenarios.flatMap((scenario, si) =>
		protocolIds.map((pid) => async (): Promise<TaskResult> => {
			const scenarioConfig = toScenarioConfig(scenario);
			progress({
				type: "start",
				scenarioName: scenario.name,
				protocolId: pid,
				totalTasks,
			});
			const taskStart = performance.now();
			try {
				const collector = new ResultCollector();
				const protocol = createProtocol(pid, {
					onMessage: collector.handler,
				});
				const result = await runScenario(
					protocol,
					pid,
					scenarioConfig,
					judgeConfig,
					(phase) =>
						progress({
							type: "phase",
							scenarioName: scenario.name,
							protocolId: pid,
							phase,
						}),
					collector,
				);
				progress({
					type: "complete",
					scenarioName: scenario.name,
					protocolId: pid,
					durationMs: performance.now() - taskStart,
				});
				return { scenarioIndex: si, protocolId: pid, result };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				progress({
					type: "complete",
					scenarioName: scenario.name,
					protocolId: pid,
					durationMs: performance.now() - taskStart,
					error: msg,
				});
				return {
					scenarioIndex: si,
					protocolId: pid,
					result: {
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
						metrics: {
							passed: false,
							tokensPerSuccess: null,
							latencyPerSuccess: null,
							costPerSuccess: null,
							coordinationEfficiency: 0,
							multiAgentContribution: 0,
							participationBalance: 0,
						},
						error: msg,
					},
				};
			}
		}),
	);

	const taskResults = await runPool(tasks, concurrency);

	const scenarioComparisons: ScenarioComparison[] = scenarios.map(
		(scenario, si) => {
			const results: Record<string, ProtocolRunResult> = {};
			for (const tr of taskResults) {
				if (tr.scenarioIndex === si) {
					results[tr.protocolId] = tr.result;
				}
			}
			return { scenario, results };
		},
	);

	// Compute aggregate metrics per protocol
	const protocolMetrics: Record<string, ProtocolAggregateMetrics> = {};
	const agentParticipation: Record<string, Record<string, number>> = {};

	for (const pid of protocolIds) {
		let passedCount = 0;
		let totalCount = 0;
		let qualitySum = 0;
		let qualityCount = 0;
		let tokensSum = 0;
		let latencySum = 0;
		let costSum = 0;
		let coordEffSum = 0;
		let coordEffCount = 0;
		let multiAgentSum = 0;
		let multiAgentCount = 0;

		for (const sc of scenarioComparisons) {
			const result = sc.results[pid];
			if (!result) continue;

			totalCount++;
			const metrics = result.metrics;

			if (metrics?.passed) {
				passedCount++;
				if (metrics.tokensPerSuccess != null)
					tokensSum += metrics.tokensPerSuccess;
				if (metrics.latencyPerSuccess != null)
					latencySum += metrics.latencyPerSuccess;
				if (metrics.costPerSuccess != null) costSum += metrics.costPerSuccess;
			}

			// Quality averaged over passed scenarios with judge data
			if (metrics?.passed && result.judge) {
				qualitySum += result.judge.aggregate.qualityScore;
				qualityCount++;
			}

			// Coordination efficiency and multi-agent contribution averaged over all scenarios
			if (metrics) {
				coordEffSum += metrics.coordinationEfficiency;
				coordEffCount++;
				multiAgentSum += metrics.multiAgentContribution;
				multiAgentCount++;
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

		protocolMetrics[pid] = {
			successRate: totalCount > 0 ? (passedCount / totalCount) * 100 : 0,
			avgQuality: qualityCount > 0 ? qualitySum / qualityCount : 0,
			avgTokensPerSuccess: passedCount > 0 ? tokensSum / passedCount : 0,
			avgLatencyPerSuccess: passedCount > 0 ? latencySum / passedCount : 0,
			avgCostPerSuccess: passedCount > 0 ? costSum / passedCount : 0,
			avgCoordinationEfficiency:
				coordEffCount > 0 ? coordEffSum / coordEffCount : 0,
			avgMultiAgentContribution:
				multiAgentCount > 0 ? multiAgentSum / multiAgentCount : 0,
			passedCount,
			totalCount,
		};
	}

	return {
		generatedAt: new Date().toISOString(),
		model: MODEL,
		protocolIds,
		baseline: options.baseline,
		scenarios: scenarioComparisons,
		aggregate: {
			protocolMetrics,
			agentParticipation,
		},
	};
}
