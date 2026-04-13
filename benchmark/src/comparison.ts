import { MODEL } from "core/config";
import {
	createProtocol,
	getProtocolIds,
	getProtocolRegistration,
} from "protocols/factory";
import type { JudgeConfig } from "./judge-types.ts";
import { runPool } from "./pool.ts";
import {
	loadAllProbes,
	loadProbe,
	loadProbesByPattern,
} from "./probes/index.ts";
import { ResultCollector, runProbe } from "./runner.ts";
import type {
	ComparisonReport,
	InteractionPattern,
	PatternMetrics,
	ProbeComparison,
	ProbeConfig,
	ProbeResult,
	ProtocolAggregateMetrics,
} from "./types.ts";

export type ProgressEvent =
	| { type: "start"; probeId: string; protocolId: string; totalTasks: number }
	| { type: "phase"; probeId: string; protocolId: string; phase: string }
	| {
			type: "complete";
			probeId: string;
			protocolId: string;
			durationMs: number;
			error?: string;
	  };

export interface ComparisonOptions {
	probes?: string[];
	patterns?: InteractionPattern[];
	protocols?: string[];
	judgeConfig?: JudgeConfig;
	concurrency?: number;
	onProgress?: (event: ProgressEvent) => void;
}

function computePatternMetrics(
	results: ProbeResult[],
	pattern: InteractionPattern,
): PatternMetrics {
	const patternResults = results.filter((r) => r.pattern === pattern);
	if (patternResults.length === 0) {
		return {
			pattern,
			assertionPassRate: 0,
			judgePassRate: 0,
			overallPassRate: 0,
			avgInteractionScore: 0,
			avgCost: 0,
			probeCount: 0,
			passedCount: 0,
		};
	}

	const assertionPassed = patternResults.filter((r) => r.assertions.passed);
	const judged = patternResults.filter((r) => r.judge);
	const judgePassed = judged.filter((r) => r.judge?.pass);
	const overallPassed = patternResults.filter((r) =>
		r.judge ? r.judge.pass : r.assertions.passed,
	);

	const scoredResults = judged.filter((r) => r.judge);
	const avgScore =
		scoredResults.length > 0
			? scoredResults.reduce(
					(s, r) => s + (r.judge?.interactionScore ?? 0),
					0,
				) / scoredResults.length
			: 0;

	return {
		pattern,
		assertionPassRate: (assertionPassed.length / patternResults.length) * 100,
		judgePassRate:
			judged.length > 0 ? (judgePassed.length / judged.length) * 100 : 0,
		overallPassRate: (overallPassed.length / patternResults.length) * 100,
		avgInteractionScore: avgScore,
		avgCost:
			patternResults.reduce((s, r) => s + r.totalCost, 0) /
			patternResults.length,
		probeCount: patternResults.length,
		passedCount: overallPassed.length,
	};
}

export async function runComparison(
	options: ComparisonOptions = {},
): Promise<ComparisonReport> {
	const progress = options.onProgress ?? (() => {});
	const protocolIds = options.protocols ?? getProtocolIds();
	const judgeConfig: JudgeConfig = options.judgeConfig ?? { enabled: true };

	// Load probes
	let probes: ProbeConfig[];
	if (options.probes) {
		probes = await Promise.all(options.probes.map((id) => loadProbe(id)));
	} else if (options.patterns) {
		const results = await Promise.all(
			options.patterns.map((p) => loadProbesByPattern(p)),
		);
		probes = results.flat();
	} else {
		probes = await loadAllProbes();
	}

	const concurrency = options.concurrency ?? 3;
	const totalTasks = probes.length * protocolIds.length;

	interface TaskResult {
		probeIndex: number;
		protocolId: string;
		result: ProbeResult;
	}

	const tasks = probes.flatMap((probe, pi) =>
		protocolIds.map((pid) => async (): Promise<TaskResult> => {
			progress({
				type: "start",
				probeId: probe.id,
				protocolId: pid,
				totalTasks,
			});
			const taskStart = performance.now();
			try {
				const collector = new ResultCollector();
				const protocol = createProtocol(pid, {
					onMessage: collector.handler,
					onEvent: collector.eventHandler,
				});
				const reg = getProtocolRegistration(pid);
				const result = await runProbe(
					protocol,
					pid,
					probe,
					judgeConfig,
					(phase) =>
						progress({
							type: "phase",
							probeId: probe.id,
							protocolId: pid,
							phase,
						}),
					collector,
					reg?.supportsRouting,
				);
				progress({
					type: "complete",
					probeId: probe.id,
					protocolId: pid,
					durationMs: performance.now() - taskStart,
				});
				return { probeIndex: pi, protocolId: pid, result };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				progress({
					type: "complete",
					probeId: probe.id,
					protocolId: pid,
					durationMs: performance.now() - taskStart,
					error: msg,
				});
				return {
					probeIndex: pi,
					protocolId: pid,
					result: {
						probeId: probe.id,
						protocolId: pid,
						pattern: probe.pattern,
						prompt: probe.prompt,
						agents: [],
						assertions: {
							passed: false,
							details: [
								{
									name: "execution",
									passed: false,
									expected: "no error",
									actual: msg,
								},
							],
						},
						totalInputTokens: 0,
						totalOutputTokens: 0,
						totalCost: 0,
						totalDurationMs: 0,
						error: msg,
					},
				};
			}
		}),
	);

	const taskResults = await runPool(tasks, concurrency);

	// Build probe comparisons
	const probeComparisons: ProbeComparison[] = probes.map((probe, pi) => {
		const results: Record<string, ProbeResult> = {};
		for (const tr of taskResults) {
			if (tr.probeIndex === pi) results[tr.protocolId] = tr.result;
		}
		return { probe, results };
	});

	// Aggregate metrics per protocol
	const protocolMetrics: Record<string, ProtocolAggregateMetrics> = {};
	const allPatterns: InteractionPattern[] = [
		"single-route",
		"selective-route",
		"decline-all",
		"handoff",
		"collaborate",
	];

	for (const pid of protocolIds) {
		const allResults = probeComparisons
			.map((pc) => pc.results[pid])
			.filter((r): r is ProbeResult => r != null);

		const overallPassed = allResults.filter((r) =>
			r.judge ? r.judge.pass : r.assertions.passed,
		);

		const scoredResults = allResults.filter((r) => r.judge);
		const avgScore =
			scoredResults.length > 0
				? scoredResults.reduce(
						(s, r) => s + (r.judge?.interactionScore ?? 0),
						0,
					) / scoredResults.length
				: 0;

		const byPattern: Record<string, PatternMetrics> = {};
		for (const pattern of allPatterns) {
			const patternResults = allResults.filter((r) => r.pattern === pattern);
			if (patternResults.length > 0) {
				byPattern[pattern] = computePatternMetrics(allResults, pattern);
			}
		}

		protocolMetrics[pid] = {
			overallPassRate:
				allResults.length > 0
					? (overallPassed.length / allResults.length) * 100
					: 0,
			avgInteractionScore: avgScore,
			avgCost:
				allResults.length > 0
					? allResults.reduce((s, r) => s + r.totalCost, 0) / allResults.length
					: 0,
			passedCount: overallPassed.length,
			totalCount: allResults.length,
			byPattern,
		};
	}

	return {
		generatedAt: new Date().toISOString(),
		model: MODEL,
		protocolIds,
		probes: probeComparisons,
		aggregate: { protocolMetrics },
	};
}
