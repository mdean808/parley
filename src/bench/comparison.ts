import { MODEL } from "../config.ts";
import type { ProtocolId } from "../factory.ts";
import { createProtocol } from "../factory.ts";
import { evaluateScenario } from "./judge.ts";
import type { JudgeConfig } from "./judge-types.ts";
import { runScenario } from "./runner.ts";
import {
	type ComparisonScenario,
	loadAllScenarios,
	loadScenario,
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

export interface ProtocolOverhead {
	v1VsSimple: OverheadMetrics;
	v2VsSimple: OverheadMetrics;
}

export interface ScenarioComparison {
	scenario: ComparisonScenario;
	results: Record<ProtocolId, ProtocolRunResult>;
	protocolOverhead: ProtocolOverhead;
}

export interface AggregateComparison {
	avgScores: Record<ProtocolId, number>;
	avgOverhead: ProtocolOverhead;
	agentParticipation: Record<string, Record<ProtocolId, number>>;
}

export interface ComparisonReport {
	generatedAt: string;
	model: string;
	scenarios: ScenarioComparison[];
	aggregate: AggregateComparison;
}

export interface ComparisonOptions {
	scenarios?: string[];
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

function toScenarioConfig(cs: ComparisonScenario): ScenarioConfig {
	return {
		name: cs.name,
		topic: cs.topic,
		rounds: cs.rounds.map((r) => ({ prompt: r.message })),
	};
}

export async function runComparison(
	options: ComparisonOptions = {},
): Promise<ComparisonReport> {
	const progress = options.onProgress ?? (() => {});
	const protocolIds: ProtocolId[] = ["v1", "v2", "simple"];
	const judgeConfig: JudgeConfig = options.judgeConfig ?? {
		enabled: true,
	};

	// Load scenarios
	const comparisonScenarios: ComparisonScenario[] = options.scenarios
		? options.scenarios.map((id) => loadScenario(id))
		: loadAllScenarios();

	const scenarioComparisons: ScenarioComparison[] = [];

	for (let si = 0; si < comparisonScenarios.length; si++) {
		const cs = comparisonScenarios[si];
		const scenarioConfig = toScenarioConfig(cs);
		const results: Record<string, ProtocolRunResult> = {};

		for (const pid of protocolIds) {
			progress(
				`[${si + 1}/${comparisonScenarios.length}] ${cs.name} -- ${pid}...`,
			);

			const protocol = createProtocol(pid);
			const result = await runScenario(protocol, pid, scenarioConfig);

			// Judge
			if (judgeConfig.enabled) {
				progress(
					`[${si + 1}/${comparisonScenarios.length}] ${cs.name} -- ${pid} judging...`,
				);
				const roundData = result.rounds.map((r) => ({
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
						usage: {
							inputTokens: a.inputTokens,
							outputTokens: a.outputTokens,
						},
						model: a.model,
						durationMs: a.durationMs,
					})),
				}));
				result.judge = await evaluateScenario(roundData, judgeConfig);
			}

			results[pid] = result;
		}

		const protocolOverhead: ProtocolOverhead = {
			v1VsSimple: computeOverhead(results.v1, results.simple),
			v2VsSimple: computeOverhead(results.v2, results.simple),
		};

		scenarioComparisons.push({
			scenario: cs,
			results: results as Record<ProtocolId, ProtocolRunResult>,
			protocolOverhead,
		});
	}

	// Compute aggregate
	const avgScores: Record<ProtocolId, number> = { v1: 0, v2: 0, simple: 0 };
	const agentParticipation: Record<string, Record<ProtocolId, number>> = {};

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
						agentParticipation[agent.agentName] = {
							v1: 0,
							v2: 0,
							simple: 0,
						};
					}
					agentParticipation[agent.agentName][pid]++;
				}
			}
		}

		avgScores[pid] = scoreCount > 0 ? scoreSum / scoreCount : 0;
	}

	// Average overhead across scenarios
	const avgOverhead: ProtocolOverhead = {
		v1VsSimple: averageOverhead(
			scenarioComparisons.map((sc) => sc.protocolOverhead.v1VsSimple),
		),
		v2VsSimple: averageOverhead(
			scenarioComparisons.map((sc) => sc.protocolOverhead.v2VsSimple),
		),
	};

	return {
		generatedAt: new Date().toISOString(),
		model: MODEL,
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
