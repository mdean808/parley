import { MAX_OUTPUT_TOKENS, MODEL } from "core/config";
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
	ProtocolConfigAudit,
} from "./types.ts";

function buildConfigAudit(
	protocolIds: string[],
	probeComparisons: ProbeComparison[],
): ProtocolConfigAudit[] {
	return protocolIds.map((pid): ProtocolConfigAudit => {
		const observedModels = new Set<string>();
		for (const pc of probeComparisons) {
			const r = pc.results[pid];
			if (!r) continue;
			for (const agent of r.agents) {
				if (agent.model) observedModels.add(agent.model);
			}
		}
		const models = [...observedModels].sort();
		if (pid === "parley" || pid === "simple") {
			return {
				protocolId: pid,
				models,
				maxOutputTokens: MAX_OUTPUT_TOKENS,
				source: "ts-constant",
			};
		}
		if (pid === "a2a" || pid === "crewai") {
			const envBudget = Number(process.env.AGENT_MAX_OUTPUT_TOKENS);
			return {
				protocolId: pid,
				models,
				maxOutputTokens:
					Number.isFinite(envBudget) && envBudget > 0 ? envBudget : 2048,
				source: "external-env",
				notes:
					"External Python server — value reflects AGENT_MAX_OUTPUT_TOKENS (default 2048). Restart servers to apply env changes.",
			};
		}
		if (pid === "claude-code") {
			return {
				protocolId: pid,
				models,
				maxOutputTokens: "unknown",
				source: "cli-default",
				notes:
					"Claude Code CLI uses its own per-turn limits; no max_tokens knob.",
			};
		}
		return {
			protocolId: pid,
			models,
			maxOutputTokens: "unknown",
			source: "unknown",
		};
	});
}

export type ProgressEvent =
	| {
			type: "start";
			probeId: string;
			protocolId: string;
			runIndex: number;
			totalTasks: number;
	  }
	| {
			type: "phase";
			probeId: string;
			protocolId: string;
			runIndex: number;
			phase: string;
	  }
	| {
			type: "complete";
			probeId: string;
			protocolId: string;
			runIndex: number;
			durationMs: number;
			error?: string;
	  };

export interface ComparisonOptions {
	probes?: string[];
	patterns?: InteractionPattern[];
	protocols?: string[];
	judgeConfig?: JudgeConfig;
	concurrency?: number;
	// Number of times to execute each (probe, protocol) pair. Enables mean ± stddev
	// reporting. Defaults to 1 — no behavioral change.
	runs?: number;
	onProgress?: (event: ProgressEvent) => void;
}

// An ineligible result has a single "eligibility" detail with status "na".
// These are probes the protocol structurally cannot attempt (parley-only probes
// for CANCEL cascade, exclusive CLAIM, etc.) — they should not count toward
// pass rates or averages.
function isIneligible(r: ProbeResult): boolean {
	const details = r.assertions.details;
	return (
		details.length === 1 &&
		details[0].name === "eligibility" &&
		details[0].status === "na"
	);
}

function computePatternMetrics(
	firstRuns: ProbeResult[],
	allRuns: ProbeResult[],
	pattern: InteractionPattern,
): PatternMetrics {
	const firstResults = firstRuns.filter(
		(r) => r.pattern === pattern && !isIneligible(r),
	);
	const allResults = allRuns.filter(
		(r) => r.pattern === pattern && !isIneligible(r),
	);
	if (firstResults.length === 0) {
		return {
			pattern,
			assertionPassRate: 0,
			judgePassRate: 0,
			overallPassRate: 0,
			scoreRate: 0,
			scoreRateStdDev: 0,
			interactionScoreRate: 0,
			contentScoreRate: 0,
			avgInteractionScore: 0,
			avgContentScore: 0,
			avgCompositeScore: 0,
			avgCost: 0,
			avgDurationMs: 0,
			probeCount: 0,
			passedCount: 0,
			runs: 0,
		};
	}

	const assertionPassed = firstResults.filter((r) => r.assertions.passed);
	const judged = firstResults.filter((r) => r.judge);
	const judgePassed = judged.filter((r) => r.judge?.pass);
	const overallPassed = firstResults.filter((r) =>
		r.judge ? r.judge.pass : r.assertions.passed,
	);

	// Averages are computed across all runs (not just first) for statistical fidelity.
	const judgedAll = allResults.filter((r) => r.judge);
	const avgInteraction =
		judgedAll.length > 0
			? judgedAll.reduce((s, r) => s + (r.judge?.interactionScore ?? 0), 0) /
				judgedAll.length
			: 0;
	const avgContent =
		judgedAll.length > 0
			? judgedAll.reduce((s, r) => s + (r.judge?.contentScore ?? 0), 0) /
				judgedAll.length
			: 0;
	const compositeSamples = judgedAll.map((r) => r.judge?.compositeScore ?? 0);
	const avgComposite =
		compositeSamples.length > 0
			? compositeSamples.reduce((s, v) => s + v, 0) / compositeSamples.length
			: 0;

	return {
		pattern,
		assertionPassRate: (assertionPassed.length / firstResults.length) * 100,
		judgePassRate:
			judged.length > 0 ? (judgePassed.length / judged.length) * 100 : 0,
		overallPassRate: (overallPassed.length / firstResults.length) * 100,
		scoreRate: avgComposite,
		scoreRateStdDev: sampleStdDev(compositeSamples),
		interactionScoreRate: judgedAll.length > 0 ? (avgInteraction / 3) * 100 : 0,
		contentScoreRate: judgedAll.length > 0 ? (avgContent / 3) * 100 : 0,
		avgInteractionScore: avgInteraction,
		avgContentScore: avgContent,
		avgCompositeScore: avgComposite,
		avgCost:
			allResults.reduce((s, r) => s + r.totalCost, 0) / allResults.length,
		avgDurationMs:
			allResults.reduce((s, r) => s + r.totalDurationMs, 0) / allResults.length,
		probeCount: firstResults.length,
		passedCount: overallPassed.length,
		runs: allResults.length,
	};
}

function sampleStdDev(values: number[]): number {
	if (values.length < 2) return 0;
	const mean = values.reduce((s, v) => s + v, 0) / values.length;
	const variance =
		values.reduce((s, v) => s + (v - mean) * (v - mean), 0) /
		(values.length - 1);
	return Math.sqrt(variance);
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
	const runs = Math.max(1, options.runs ?? 1);
	const totalTasks = probes.length * protocolIds.length * runs;

	interface TaskResult {
		probeIndex: number;
		protocolId: string;
		runIndex: number;
		result: ProbeResult;
	}

	const tasks = probes.flatMap((probe, pi) =>
		protocolIds.flatMap((pid) =>
			Array.from(
				{ length: runs },
				(_, runIndex) => async (): Promise<TaskResult> => {
					progress({
						type: "start",
						probeId: probe.id,
						protocolId: pid,
						runIndex,
						totalTasks,
					});
					const taskStart = performance.now();

					// Skip ineligible (probe, protocol) pairs — report as N/A, not fail.
					if (
						probe.eligibleProtocols &&
						!probe.eligibleProtocols.includes(pid)
					) {
						const ineligibleResult: ProbeResult = {
							probeId: probe.id,
							protocolId: pid,
							pattern: probe.pattern,
							prompt: probe.prompt,
							agents: [],
							assertions: {
								passed: true,
								details: [
									{
										name: "eligibility",
										passed: true,
										status: "na",
										expected: `protocol in [${probe.eligibleProtocols.join(", ")}]`,
										actual: pid,
										reason:
											"probe not applicable to this protocol (structurally ineligible)",
									},
								],
							},
							totalInputTokens: 0,
							totalOutputTokens: 0,
							totalCost: 0,
							totalDurationMs: 0,
						};
						progress({
							type: "complete",
							probeId: probe.id,
							protocolId: pid,
							runIndex,
							durationMs: performance.now() - taskStart,
						});
						return {
							probeIndex: pi,
							protocolId: pid,
							runIndex,
							result: ineligibleResult,
						};
					}

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
									runIndex,
									phase,
								}),
							collector,
							reg?.supportsRouting,
						);
						progress({
							type: "complete",
							probeId: probe.id,
							protocolId: pid,
							runIndex,
							durationMs: performance.now() - taskStart,
						});
						return { probeIndex: pi, protocolId: pid, runIndex, result };
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						progress({
							type: "complete",
							probeId: probe.id,
							protocolId: pid,
							runIndex,
							durationMs: performance.now() - taskStart,
							error: msg,
						});
						return {
							probeIndex: pi,
							protocolId: pid,
							runIndex,
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
											status: "fail",
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
				},
			),
		),
	);

	const taskResults = await runPool(tasks, concurrency);

	// Build probe comparisons (first run → results; all runs → runs when N>1)
	const probeComparisons: ProbeComparison[] = probes.map((probe, pi) => {
		const runsByProto: Record<string, ProbeResult[]> = {};
		for (const tr of taskResults) {
			if (tr.probeIndex !== pi) continue;
			if (!runsByProto[tr.protocolId]) runsByProto[tr.protocolId] = [];
			runsByProto[tr.protocolId][tr.runIndex] = tr.result;
		}
		const results: Record<string, ProbeResult> = {};
		for (const [pid, arr] of Object.entries(runsByProto)) {
			results[pid] = arr[0];
		}
		const comparison: ProbeComparison = { probe, results };
		if (runs > 1) comparison.runs = runsByProto;
		return comparison;
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
		// Exclude ineligible (structurally-skipped) probes from the per-protocol
		// aggregate so they don't inflate pass rates or dilute averages.
		const firstRuns = probeComparisons
			.map((pc) => pc.results[pid])
			.filter((r): r is ProbeResult => r != null && !isIneligible(r));
		const allRuns = probeComparisons
			.flatMap(
				(pc) => pc.runs?.[pid] ?? (pc.results[pid] ? [pc.results[pid]] : []),
			)
			.filter((r): r is ProbeResult => r != null && !isIneligible(r));

		const overallPassed = firstRuns.filter((r) =>
			r.judge ? r.judge.pass : r.assertions.passed,
		);

		// Averages across ALL runs for stability; pass-count from first-run.
		const scoredRuns = allRuns.filter((r) => r.judge);
		const avgInteraction =
			scoredRuns.length > 0
				? scoredRuns.reduce((s, r) => s + (r.judge?.interactionScore ?? 0), 0) /
					scoredRuns.length
				: 0;
		const avgContent =
			scoredRuns.length > 0
				? scoredRuns.reduce((s, r) => s + (r.judge?.contentScore ?? 0), 0) /
					scoredRuns.length
				: 0;
		const compositeSamples = scoredRuns.map(
			(r) => r.judge?.compositeScore ?? 0,
		);
		const avgComposite =
			compositeSamples.length > 0
				? compositeSamples.reduce((s, v) => s + v, 0) / compositeSamples.length
				: 0;
		const scoreStdDev = sampleStdDev(compositeSamples);

		const byPattern: Record<string, PatternMetrics> = {};
		for (const pattern of allPatterns) {
			const patternFirst = firstRuns.filter((r) => r.pattern === pattern);
			if (patternFirst.length > 0) {
				byPattern[pattern] = computePatternMetrics(firstRuns, allRuns, pattern);
			}
		}

		const avgCost =
			allRuns.length > 0
				? allRuns.reduce((s, r) => s + r.totalCost, 0) / allRuns.length
				: 0;
		const avgInput =
			allRuns.length > 0
				? allRuns.reduce((s, r) => s + r.totalInputTokens, 0) / allRuns.length
				: 0;
		const avgOutput =
			allRuns.length > 0
				? allRuns.reduce((s, r) => s + r.totalOutputTokens, 0) / allRuns.length
				: 0;
		const avgTotalTokens = avgInput + avgOutput;

		const wireRuns = allRuns.filter((r) => r.wireEfficiency);
		const avgWireRatio =
			wireRuns.length > 0
				? wireRuns.reduce((s, r) => s + (r.wireEfficiency?.ratio ?? 0), 0) /
					wireRuns.length
				: undefined;
		const avgWireSamples =
			wireRuns.length > 0
				? wireRuns.reduce(
						(s, r) => s + (r.wireEfficiency?.sampleCount ?? 0),
						0,
					) / wireRuns.length
				: undefined;

		const integrityRuns = allRuns.filter((r) => r.integrity);
		const integrityRate =
			integrityRuns.length > 0
				? (integrityRuns.filter((r) => r.integrity?.passed).length /
						integrityRuns.length) *
					100
				: undefined;

		protocolMetrics[pid] = {
			overallPassRate:
				firstRuns.length > 0
					? (overallPassed.length / firstRuns.length) * 100
					: 0,
			scoreRate: avgComposite,
			scoreRateStdDev: scoreStdDev,
			interactionScoreRate:
				scoredRuns.length > 0 ? (avgInteraction / 3) * 100 : 0,
			contentScoreRate: scoredRuns.length > 0 ? (avgContent / 3) * 100 : 0,
			avgInteractionScore: avgInteraction,
			avgContentScore: avgContent,
			avgCompositeScore: avgComposite,
			avgCost,
			avgDurationMs:
				allRuns.length > 0
					? allRuns.reduce((s, r) => s + r.totalDurationMs, 0) / allRuns.length
					: 0,
			avgInputTokens: avgInput,
			avgOutputTokens: avgOutput,
			scorePerKToken:
				avgTotalTokens > 0 ? (avgComposite / avgTotalTokens) * 1000 : 0,
			costEfficiency: avgCost > 0 ? avgComposite / avgCost : 0,
			avgWireRatio,
			avgWireSamples,
			integrityRate,
			passedCount: overallPassed.length,
			totalCount: firstRuns.length,
			runs: allRuns.length,
			byPattern,
		};
	}

	return {
		generatedAt: new Date().toISOString(),
		model: MODEL,
		protocolIds,
		probes: probeComparisons,
		aggregate: { protocolMetrics },
		configAudit: buildConfigAudit(protocolIds, probeComparisons),
	};
}
