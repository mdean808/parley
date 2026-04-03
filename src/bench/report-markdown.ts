import type {
	ComparisonReport,
	OverheadMetrics,
	ScenarioComparison,
} from "./comparison.ts";
import type { ProtocolId } from "./types.ts";

const PROTOCOL_IDS: ProtocolId[] = ["v1", "v2", "simple"];

function fmtNum(n: number): string {
	return n.toLocaleString("en-US");
}

function fmtPct(n: number): string {
	const sign = n >= 0 ? "+" : "";
	return `${sign}${n.toFixed(1)}%`;
}

function generateObservations(sc: ScenarioComparison): string[] {
	const obs: string[] = [];
	const { v1VsSimple, v2VsSimple } = sc.protocolOverhead;

	if (v1VsSimple.extraInputPercent > 50) {
		obs.push(
			`v1 has significant protocol overhead: ${fmtPct(v1VsSimple.extraInputPercent)} more input tokens than simple`,
		);
	}
	if (v2VsSimple.extraInputPercent > 50) {
		obs.push(
			`v2 has significant protocol overhead: ${fmtPct(v2VsSimple.extraInputPercent)} more input tokens than simple`,
		);
	}

	const v1Judge = sc.results.v1?.judge?.aggregate.overall ?? 0;
	const v2Judge = sc.results.v2?.judge?.aggregate.overall ?? 0;
	const simpleJudge = sc.results.simple?.judge?.aggregate.overall ?? 0;

	if (simpleJudge > 0) {
		const simpleRedundancy =
			sc.results.simple?.judge?.aggregate.dimensions.find(
				(d) => d.dimension === "redundancy",
			)?.score ?? 0;
		const v1Redundancy =
			sc.results.v1?.judge?.aggregate.dimensions.find(
				(d) => d.dimension === "redundancy",
			)?.score ?? 0;

		if (simpleRedundancy < v1Redundancy) {
			obs.push(
				"Simple protocol produces more redundant responses across agents",
			);
		}
	}

	if (v2Judge > v1Judge && v2Judge > simpleJudge) {
		obs.push(
			"v2 (tool-use) achieved the highest judge scores for this scenario",
		);
	} else if (v1Judge > v2Judge && v1Judge > simpleJudge) {
		obs.push(
			"v1 (state machine) achieved the highest judge scores for this scenario",
		);
	}

	// Check agent participation differences
	for (const pid of PROTOCOL_IDS) {
		const result = sc.results[pid];
		const agentCount = new Set(
			result.rounds.flatMap((r) => r.agents.map((a) => a.agentName)),
		).size;
		if (pid !== "simple" && agentCount < 3) {
			obs.push(
				`${pid} protocol routing filtered to ${agentCount} agent(s), showing skill-based selection`,
			);
		}
	}

	return obs;
}

export function generateMarkdownReport(report: ComparisonReport): string {
	const lines: string[] = [];

	lines.push("# Protocol Comparison Report\n");

	// Executive Summary
	lines.push("## Executive Summary\n");
	const best = (
		Object.entries(report.aggregate.avgScores) as [ProtocolId, number][]
	).reduce((a, b) => (b[1] > a[1] ? b : a));
	lines.push(
		`This report compares three protocol implementations (v1 state-machine, v2 tool-use, simple direct) across ${report.scenarios.length} scenarios using model \`${report.model}\`.`,
	);
	if (best[1] > 0) {
		lines.push(
			`**${best[0]}** achieved the highest average judge score of **${best[1].toFixed(1)}/5.0**.\n`,
		);
	}

	// Methodology
	lines.push("## Methodology\n");
	lines.push(
		"Each scenario was run sequentially through all three protocol implementations. " +
			"Protocols were freshly instantiated per scenario to prevent context leakage. " +
			"An LLM judge (separate from the agents) evaluated response quality on 1-5 scales across " +
			"relevance, information density, redundancy, summarization quality, and coherence (multi-round only).\n",
	);

	// Overall Comparison
	lines.push("## Overall Comparison\n");
	lines.push(
		"| Protocol | Input Tok | Output Tok | Cost | Duration | Judge Avg |",
	);
	lines.push(
		"|----------|-----------|------------|------|----------|-----------|",
	);

	for (const pid of PROTOCOL_IDS) {
		let totalIn = 0;
		let totalOut = 0;
		let totalCost = 0;
		let totalDur = 0;
		let judgeSum = 0;
		let judgeCount = 0;

		for (const sc of report.scenarios) {
			const r = sc.results[pid];
			totalIn += r.aggregate.totalInputTokens;
			totalOut += r.aggregate.totalOutputTokens;
			totalCost += r.aggregate.totalCost;
			totalDur += r.aggregate.totalDurationMs;
			if (r.judge) {
				judgeSum += r.judge.aggregate.overall;
				judgeCount++;
			}
		}

		const judgeAvg = judgeCount > 0 ? (judgeSum / judgeCount).toFixed(1) : "—";
		lines.push(
			`| ${pid} | ${fmtNum(totalIn)} | ${fmtNum(totalOut)} | $${totalCost.toFixed(4)} | ${(totalDur / 1000).toFixed(1)}s | ${judgeAvg} |`,
		);
	}
	lines.push("");

	// Protocol Overhead
	lines.push("## Protocol Overhead\n");
	lines.push("| vs Simple | +Input Tok | +Output Tok | +Duration |");
	lines.push("|-----------|-----------|-------------|-----------|");

	function overheadRow(label: string, o: OverheadMetrics): string {
		return `| ${label} | ${fmtNum(Math.round(o.extraInputTokens))} (${fmtPct(o.extraInputPercent)}) | ${fmtNum(Math.round(o.extraOutputTokens))} (${fmtPct(o.extraOutputPercent)}) | ${(o.extraDurationMs / 1000).toFixed(1)}s (${fmtPct(o.extraDurationPercent)}) |`;
	}

	lines.push(overheadRow("v1", report.aggregate.avgOverhead.v1VsSimple));
	lines.push(overheadRow("v2", report.aggregate.avgOverhead.v2VsSimple));
	lines.push("");

	// Scenario Results
	lines.push("## Scenario Results\n");

	for (const sc of report.scenarios) {
		lines.push(`### ${sc.scenario.name}\n`);
		lines.push(`**Topic:** ${sc.scenario.topic}\n`);
		lines.push(`**Rounds:** ${sc.scenario.rounds.length}\n`);

		// Token Usage by Round
		lines.push("#### Token Usage\n");
		lines.push("| Protocol | Round | Input | Output | Duration |");
		lines.push("|----------|-------|-------|--------|----------|");

		for (const pid of PROTOCOL_IDS) {
			const result = sc.results[pid];
			for (const round of result.rounds) {
				lines.push(
					`| ${pid} | ${round.roundIndex + 1} | ${fmtNum(round.totalInputTokens)} | ${fmtNum(round.totalOutputTokens)} | ${(round.totalDurationMs / 1000).toFixed(1)}s |`,
				);
			}
		}
		lines.push("");

		// Judge Scores
		const hasJudge = Object.values(sc.results).some((r) => r.judge);
		if (hasJudge) {
			lines.push("#### Judge Scores\n");
			lines.push("| Dimension | v1 | v2 | simple |");
			lines.push("|-----------|----|----|--------|");

			const allDims = new Set<string>();
			for (const pid of PROTOCOL_IDS) {
				const dims = sc.results[pid]?.judge?.aggregate.dimensions ?? [];
				for (const d of dims) allDims.add(d.dimension);
			}

			for (const dim of allDims) {
				const scores = PROTOCOL_IDS.map((pid) => {
					const d = sc.results[pid]?.judge?.aggregate.dimensions.find(
						(dd) => dd.dimension === dim,
					);
					return d ? String(d.score) : "—";
				});
				lines.push(`| ${dim} | ${scores.join(" | ")} |`);
			}

			// Overall
			const overalls = PROTOCOL_IDS.map((pid) => {
				const o = sc.results[pid]?.judge?.aggregate.overall;
				return o ? o.toFixed(1) : "—";
			});
			lines.push(`| **overall** | ${overalls.join(" | ")} |`);
			lines.push("");
		}

		// Agent Participation
		lines.push("#### Agent Participation\n");
		lines.push("| Agent | v1 | v2 | simple |");
		lines.push("|-------|----|----|--------|");

		const agentNames = new Set<string>();
		for (const pid of PROTOCOL_IDS) {
			for (const round of sc.results[pid].rounds) {
				for (const agent of round.agents) {
					agentNames.add(agent.agentName);
				}
			}
		}

		for (const name of agentNames) {
			const counts = PROTOCOL_IDS.map((pid) => {
				let count = 0;
				for (const round of sc.results[pid].rounds) {
					if (round.agents.some((a) => a.agentName === name)) count++;
				}
				return `${count}/${sc.results[pid].rounds.length}`;
			});
			lines.push(`| ${name} | ${counts.join(" | ")} |`);
		}
		lines.push("");

		// Observations
		const observations = generateObservations(sc);
		if (observations.length > 0) {
			lines.push("#### Notable Observations\n");
			for (const obs of observations) {
				lines.push(`- ${obs}`);
			}
			lines.push("");
		}
	}

	// Agent Analysis
	lines.push("## Agent Analysis\n");
	lines.push("Participation rates across all scenarios:\n");
	lines.push("| Agent | v1 | v2 | simple |");
	lines.push("|-------|----|----|--------|");

	for (const [name, counts] of Object.entries(
		report.aggregate.agentParticipation,
	)) {
		lines.push(`| ${name} | ${counts.v1} | ${counts.v2} | ${counts.simple} |`);
	}
	lines.push("");

	// Key Findings
	lines.push("## Key Findings\n");

	const { v1VsSimple, v2VsSimple } = report.aggregate.avgOverhead;

	lines.push(
		`1. **Protocol overhead:** v1 adds ~${fmtPct(v1VsSimple.extraInputPercent)} input tokens, v2 adds ~${fmtPct(v2VsSimple.extraInputPercent)} input tokens compared to simple.`,
	);

	if (report.aggregate.avgScores.v2 > report.aggregate.avgScores.simple) {
		lines.push(
			`2. **Quality tradeoff:** v2 achieves higher judge scores (${report.aggregate.avgScores.v2.toFixed(1)} vs ${report.aggregate.avgScores.simple.toFixed(1)}) despite higher token cost.`,
		);
	} else {
		lines.push(
			`2. **Quality comparison:** Simple achieved competitive scores (${report.aggregate.avgScores.simple.toFixed(1)}) with lower overhead.`,
		);
	}

	lines.push(
		`3. **Duration impact:** v1 adds ~${(v1VsSimple.extraDurationMs / 1000).toFixed(1)}s, v2 adds ~${(v2VsSimple.extraDurationMs / 1000).toFixed(1)}s average latency per scenario.`,
	);

	lines.push(
		"\n---\n*Generated by the protocol comparison benchmark system.*\n",
	);

	return lines.join("\n");
}
