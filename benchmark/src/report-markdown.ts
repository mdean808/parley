import type {
	ComparisonReport,
	OverheadMetrics,
	ScenarioComparison,
} from "./comparison.ts";

function fmtNum(n: number): string {
	return n.toLocaleString("en-US");
}

function fmtPct(n: number): string {
	const sign = n >= 0 ? "+" : "";
	return `${sign}${n.toFixed(1)}%`;
}

function generateObservations(
	sc: ScenarioComparison,
	protocolIds: string[],
	baseline: string,
): string[] {
	const obs: string[] = [];

	// Check overhead for each non-baseline protocol
	for (const pid of protocolIds) {
		if (pid === baseline) continue;
		const overhead = sc.protocolOverhead[pid];
		if (overhead && overhead.extraInputPercent > 50) {
			obs.push(
				`${pid} has significant protocol overhead: ${fmtPct(overhead.extraInputPercent)} more input tokens than ${baseline}`,
			);
		}
	}

	// Find highest-scoring protocol
	const scores: [string, number][] = protocolIds.map((pid) => [
		pid,
		sc.results[pid]?.judge?.aggregate.overall ?? 0,
	]);
	const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
	if (best[1] > 0) {
		obs.push(`${best[0]} achieved the highest judge scores for this scenario`);
	}

	// Check agent participation differences
	for (const pid of protocolIds) {
		if (pid === baseline) continue;
		const result = sc.results[pid];
		if (!result || result.error) continue;
		const agentCount = new Set(
			result.rounds.flatMap((r) => r.agents.map((a) => a.agentName)),
		).size;
		if (agentCount < 3) {
			obs.push(
				`${pid} protocol routing filtered to ${agentCount} agent(s), showing skill-based selection`,
			);
		}
	}

	return obs;
}

export function generateMarkdownReport(report: ComparisonReport): string {
	const lines: string[] = [];
	const { protocolIds, baseline } = report;
	const nonBaseline = protocolIds.filter((p) => p !== baseline);

	lines.push("# Protocol Comparison Report\n");

	// Executive Summary
	lines.push("## Executive Summary\n");
	const best = Object.entries(report.aggregate.avgScores).reduce((a, b) =>
		b[1] > a[1] ? b : a,
	);
	lines.push(
		`This report compares ${protocolIds.length} protocol implementation(s) (${protocolIds.join(", ")}) across ${report.scenarios.length} scenarios using model \`${report.model}\`. Baseline: **${baseline}**.`,
	);
	if (best[1] > 0) {
		lines.push(
			`**${best[0]}** achieved the highest average judge score of **${best[1].toFixed(1)}/5.0**.\n`,
		);
	}

	// Methodology
	lines.push("## Methodology\n");
	lines.push(
		`Each scenario was run sequentially through all ${protocolIds.length} protocol implementation(s). ` +
			"Protocols were freshly instantiated per scenario to prevent context leakage. " +
			"An LLM judge (separate from the agents) evaluated response quality on 1-5 scales across " +
			"relevance, information density, redundancy, summarization quality, and coherence (multi-round only).\n",
	);

	// Overall Comparison
	lines.push("## Overall Comparison\n");
	lines.push(
		`| Protocol | Input Tok | Output Tok | Cost | Duration | Judge Avg |`,
	);
	lines.push(
		"|----------|-----------|------------|------|----------|-----------|",
	);

	for (const pid of protocolIds) {
		let totalIn = 0;
		let totalOut = 0;
		let totalCost = 0;
		let totalDur = 0;
		let judgeSum = 0;
		let judgeCount = 0;

		for (const sc of report.scenarios) {
			const r = sc.results[pid];
			if (!r) continue;
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
	if (nonBaseline.length > 0) {
		lines.push("## Protocol Overhead\n");
		lines.push(`| vs ${baseline} | +Input Tok | +Output Tok | +Duration |`);
		lines.push("|-----------|-----------|-------------|-----------|");

		function overheadRow(label: string, o: OverheadMetrics): string {
			return `| ${label} | ${fmtNum(Math.round(o.extraInputTokens))} (${fmtPct(o.extraInputPercent)}) | ${fmtNum(Math.round(o.extraOutputTokens))} (${fmtPct(o.extraOutputPercent)}) | ${(o.extraDurationMs / 1000).toFixed(1)}s (${fmtPct(o.extraDurationPercent)}) |`;
		}

		for (const pid of nonBaseline) {
			const overhead = report.aggregate.avgOverhead[pid];
			if (overhead) {
				lines.push(overheadRow(pid, overhead));
			}
		}
		lines.push("");
	}

	// Scenario Results
	lines.push("## Scenario Results\n");

	for (const sc of report.scenarios) {
		lines.push(`### ${sc.scenario.name}\n`);
		lines.push(`**Topic:** ${sc.scenario.topic}\n`);
		lines.push(`**Rounds:** ${sc.scenario.rounds.length}\n`);

		// Show errors for this scenario
		const scenarioErrors = protocolIds.filter((pid) => sc.results[pid]?.error);
		if (scenarioErrors.length > 0) {
			lines.push("**Errors:**\n");
			for (const pid of scenarioErrors) {
				lines.push(`- **${pid}:** ${sc.results[pid].error}`);
			}
			lines.push("");
		}

		// Token Usage by Round
		lines.push("#### Token Usage\n");
		lines.push("| Protocol | Round | Input | Output | Duration |");
		lines.push("|----------|-------|-------|--------|----------|");

		for (const pid of protocolIds) {
			const result = sc.results[pid];
			if (!result) continue;
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
			lines.push(`| Dimension | ${protocolIds.join(" | ")} |`);
			lines.push(`|-----------|${protocolIds.map(() => "-------").join("|")}|`);

			const allDims = new Set<string>();
			for (const pid of protocolIds) {
				const dims = sc.results[pid]?.judge?.aggregate.dimensions ?? [];
				for (const d of dims) allDims.add(d.dimension);
			}

			for (const dim of allDims) {
				const scores = protocolIds.map((pid) => {
					const d = sc.results[pid]?.judge?.aggregate.dimensions.find(
						(dd) => dd.dimension === dim,
					);
					return d ? String(d.score) : "—";
				});
				lines.push(`| ${dim} | ${scores.join(" | ")} |`);
			}

			// Overall
			const overalls = protocolIds.map((pid) => {
				const o = sc.results[pid]?.judge?.aggregate.overall;
				return o ? o.toFixed(1) : "—";
			});
			lines.push(`| **overall** | ${overalls.join(" | ")} |`);
			lines.push("");
		}

		// Per-Round Judge Progression
		const hasPerRoundJudge = Object.values(sc.results).some((r) =>
			r?.rounds.some((round) => round.judge),
		);
		if (hasPerRoundJudge) {
			lines.push("#### Per-Round Judge Progression\n");

			// Collect all dimensions across all rounds
			const roundDims = new Set<string>();
			for (const pid of protocolIds) {
				for (const round of sc.results[pid]?.rounds ?? []) {
					if (round.judge) {
						for (const d of round.judge.dimensions) {
							roundDims.add(d.dimension);
						}
					}
				}
			}
			const dimList = [...roundDims];

			lines.push(`| Protocol | Round | ${dimList.join(" | ")} | overall |`);
			lines.push(
				`|----------|-------|${dimList.map(() => "-------").join("|")}|---------|`,
			);

			for (const pid of protocolIds) {
				for (const round of sc.results[pid]?.rounds ?? []) {
					if (!round.judge) continue;
					const scores = dimList.map((dim) => {
						const d = round.judge?.dimensions.find(
							(dd) => dd.dimension === dim,
						);
						return d ? String(d.score) : "—";
					});
					lines.push(
						`| ${pid} | ${round.roundIndex + 1} | ${scores.join(" | ")} | ${round.judge.overall.toFixed(1)} |`,
					);
				}
			}
			lines.push("");
		}

		// Agent Participation
		lines.push("#### Agent Participation\n");
		lines.push(`| Agent | ${protocolIds.join(" | ")} |`);
		lines.push(`|-------|${protocolIds.map(() => "-------").join("|")}|`);

		const agentNames = new Set<string>();
		for (const pid of protocolIds) {
			for (const round of sc.results[pid]?.rounds ?? []) {
				for (const agent of round.agents) {
					agentNames.add(agent.agentName);
				}
			}
		}

		for (const name of agentNames) {
			const counts = protocolIds.map((pid) => {
				const rounds = sc.results[pid]?.rounds ?? [];
				let count = 0;
				for (const round of rounds) {
					if (round.agents.some((a) => a.agentName === name)) count++;
				}
				return `${count}/${rounds.length}`;
			});
			lines.push(`| ${name} | ${counts.join(" | ")} |`);
		}
		lines.push("");

		// Observations
		const observations = generateObservations(sc, protocolIds, baseline);
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
	lines.push(`| Agent | ${protocolIds.join(" | ")} |`);
	lines.push(`|-------|${protocolIds.map(() => "-------").join("|")}|`);

	for (const [name, counts] of Object.entries(
		report.aggregate.agentParticipation,
	)) {
		const vals = protocolIds.map((pid) => String(counts[pid] ?? 0));
		lines.push(`| ${name} | ${vals.join(" | ")} |`);
	}
	lines.push("");

	// Key Findings
	lines.push("## Key Findings\n");

	let findingNum = 1;
	for (const pid of nonBaseline) {
		const overhead = report.aggregate.avgOverhead[pid];
		if (!overhead) continue;
		lines.push(
			`${findingNum}. **Protocol overhead (${pid}):** ~${fmtPct(overhead.extraInputPercent)} input tokens, ~${(overhead.extraDurationMs / 1000).toFixed(1)}s latency vs ${baseline}.`,
		);
		findingNum++;
	}

	const sortedScores = Object.entries(report.aggregate.avgScores).sort(
		(a, b) => b[1] - a[1],
	);
	if (sortedScores.length > 1 && sortedScores[0][1] > 0) {
		const [bestPid, bestScore] = sortedScores[0];
		const [worstPid, worstScore] = sortedScores[sortedScores.length - 1];
		if (bestScore > worstScore) {
			lines.push(
				`${findingNum}. **Quality:** ${bestPid} leads with ${bestScore.toFixed(1)} avg judge score vs ${worstPid} at ${worstScore.toFixed(1)}.`,
			);
		} else {
			lines.push(
				`${findingNum}. **Quality:** All protocols scored similarly (${bestScore.toFixed(1)}).`,
			);
		}
	}

	lines.push(
		"\n---\n*Generated by the protocol comparison benchmark system.*\n",
	);

	return lines.join("\n");
}
