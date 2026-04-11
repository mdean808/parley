import type { ComparisonReport, ScenarioComparison } from "./comparison.ts";

function fmtNum(n: number): string {
	return n.toLocaleString("en-US");
}

function fmtPct(n: number): string {
	return `${n.toFixed(1)}%`;
}

function fmtScore(n: number): string {
	return n.toFixed(1);
}

function fmtPassFail(result: {
	metrics?: { passed: boolean };
	judge?: { aggregate: { qualityScore: number } };
	error?: string;
}): string {
	if (result.error) return "ERR";
	if (!result.metrics) return "—";
	if (result.metrics.passed) {
		const q = result.judge?.aggregate.qualityScore;
		return q ? `PASS (${fmtScore(q)})` : "PASS";
	}
	return "FAIL";
}

function generateObservations(
	sc: ScenarioComparison,
	protocolIds: string[],
): string[] {
	const obs: string[] = [];

	// Find highest-scoring protocol (by quality)
	const scores: [string, number][] = protocolIds
		.filter((pid) => sc.results[pid]?.metrics?.passed)
		.map((pid) => [pid, sc.results[pid]?.judge?.aggregate.qualityScore ?? 0]);
	if (scores.length > 0) {
		const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
		if (best[1] > 0) {
			obs.push(
				`${best[0]} achieved the highest quality score (${fmtScore(best[1])})`,
			);
		}
	}

	// Coordination efficiency comparison
	const efficiencies: [string, number][] = protocolIds
		.filter((pid) => sc.results[pid]?.metrics)
		.map((pid) => [pid, sc.results[pid].metrics?.coordinationEfficiency ?? 0]);
	if (efficiencies.length > 1) {
		const best = efficiencies.reduce((a, b) => (b[1] > a[1] ? b : a));
		const worst = efficiencies.reduce((a, b) => (b[1] < a[1] ? b : a));
		if (best[1] > worst[1] * 2 && worst[1] > 0) {
			obs.push(
				`${best[0]} has ${(best[1] / worst[1]).toFixed(1)}x better coordination efficiency than ${worst[0]}`,
			);
		}
	}

	// Multi-agent contribution
	const contributions: [string, number][] = protocolIds
		.filter((pid) => sc.results[pid]?.metrics)
		.map((pid) => [pid, sc.results[pid].metrics?.multiAgentContribution ?? 0]);
	if (contributions.length > 1) {
		const best = contributions.reduce((a, b) => (b[1] > a[1] ? b : a));
		if (best[1] > 0.6) {
			obs.push(
				`${best[0]} shows strong multi-agent contribution (${best[1].toFixed(2)})`,
			);
		}
	}

	// Agent participation differences
	for (const pid of protocolIds) {
		const result = sc.results[pid];
		if (!result || result.error) continue;
		const agentCount = new Set(
			result.rounds.flatMap((r) => r.agents.map((a) => a.agentName)),
		).size;
		if (agentCount === 1 && result.rounds.length > 0) {
			obs.push(`${pid} used a single agent`);
		}
	}

	return obs;
}

export function generateMarkdownReport(report: ComparisonReport): string {
	const lines: string[] = [];
	const { protocolIds } = report;

	lines.push("# Protocol Comparison Report\n");
	lines.push(`*Run: ${report.generatedAt}*\n`);

	// Executive Summary
	lines.push("## Executive Summary\n");
	const metrics = report.aggregate.protocolMetrics;
	const bestSuccess = Object.entries(metrics).reduce((a, b) =>
		b[1].successRate > a[1].successRate ? b : a,
	);
	lines.push(
		`This report compares ${protocolIds.length} protocol implementation(s) (${protocolIds.join(", ")}) across ${report.scenarios.length} scenarios using model \`${report.model}\`.`,
	);
	if (bestSuccess[1].successRate > 0) {
		lines.push(
			`**${bestSuccess[0]}** achieved the highest success rate of **${fmtPct(bestSuccess[1].successRate)}**.\n`,
		);
	}

	// Methodology
	lines.push("## Methodology\n");
	lines.push(
		`Each scenario was run sequentially through all ${protocolIds.length} protocol implementation(s). ` +
			"Protocols were freshly instantiated per scenario to prevent context leakage. " +
			"An LLM judge evaluated each response on pass/fail task success, quality (1-5), and multi-agent value (1-5).\n",
	);

	// Protocol Comparison (main summary table)
	lines.push("## Protocol Comparison\n");
	lines.push(
		"| Protocol | Success Rate | Avg Quality | Tokens/Success | Latency/Success | Cost/Success | Coord. Efficiency | Multi-Agent |",
	);
	lines.push(
		"|----------|-------------|-------------|----------------|-----------------|--------------|-------------------|-------------|",
	);

	for (const pid of protocolIds) {
		const m = metrics[pid];
		const successLabel = `${m.passedCount}/${m.totalCount} (${fmtPct(m.successRate)})`;
		const quality = m.avgQuality > 0 ? fmtScore(m.avgQuality) : "—";
		const tokPerSuccess =
			m.passedCount > 0 ? fmtNum(Math.round(m.avgTokensPerSuccess)) : "—";
		const latPerSuccess =
			m.passedCount > 0
				? `${(m.avgLatencyPerSuccess / 1000).toFixed(1)}s`
				: "—";
		const costPerSuccess =
			m.passedCount > 0 ? `$${m.avgCostPerSuccess.toFixed(4)}` : "—";
		const coordEff = m.avgCoordinationEfficiency.toFixed(3);
		const multiAgent = m.avgMultiAgentContribution.toFixed(2);

		lines.push(
			`| ${pid} | ${successLabel} | ${quality} | ${tokPerSuccess} | ${latPerSuccess} | ${costPerSuccess} | ${coordEff} | ${multiAgent} |`,
		);
	}
	lines.push("");

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

		// Pass/Fail + Quality table
		const hasJudge = Object.values(sc.results).some((r) => r.judge);
		if (hasJudge || scenarioErrors.length > 0) {
			lines.push("#### Evaluation\n");
			lines.push(`| Protocol | Result | Quality | Multi-Agent Value |`);
			lines.push(`|----------|--------|---------|-------------------|`);

			for (const pid of protocolIds) {
				const r = sc.results[pid];
				if (!r) continue;
				const passFail = fmtPassFail(r);
				const quality = r.judge
					? fmtScore(r.judge.aggregate.qualityScore)
					: "—";
				const multiAgent = r.judge
					? fmtScore(r.judge.aggregate.multiAgentValue)
					: "—";
				lines.push(`| ${pid} | ${passFail} | ${quality} | ${multiAgent} |`);
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
		const observations = generateObservations(sc, protocolIds);
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

	// 1. Success rates
	const sortedBySuccess = Object.entries(metrics).sort(
		(a, b) => b[1].successRate - a[1].successRate,
	);
	if (sortedBySuccess.length > 0) {
		const summaries = sortedBySuccess.map(
			([pid, m]) => `${pid} ${fmtPct(m.successRate)}`,
		);
		lines.push(`${findingNum}. **Success rates:** ${summaries.join(", ")}.`);
		findingNum++;
	}

	// 2. Cost efficiency
	const withCost = Object.entries(metrics).filter(([, m]) => m.passedCount > 0);
	if (withCost.length > 1) {
		const sortedByCost = withCost.sort(
			(a, b) => a[1].avgCostPerSuccess - b[1].avgCostPerSuccess,
		);
		lines.push(
			`${findingNum}. **Cost efficiency:** ${sortedByCost[0][0]} is cheapest at $${sortedByCost[0][1].avgCostPerSuccess.toFixed(4)}/success vs ${sortedByCost[sortedByCost.length - 1][0]} at $${sortedByCost[sortedByCost.length - 1][1].avgCostPerSuccess.toFixed(4)}/success.`,
		);
		findingNum++;
	}

	// 3. Multi-agent contribution
	const sortedByMultiAgent = Object.entries(metrics).sort(
		(a, b) => b[1].avgMultiAgentContribution - a[1].avgMultiAgentContribution,
	);
	if (sortedByMultiAgent.length > 1) {
		lines.push(
			`${findingNum}. **Multi-agent value:** ${sortedByMultiAgent[0][0]} leads with ${sortedByMultiAgent[0][1].avgMultiAgentContribution.toFixed(2)} contribution score vs ${sortedByMultiAgent[sortedByMultiAgent.length - 1][0]} at ${sortedByMultiAgent[sortedByMultiAgent.length - 1][1].avgMultiAgentContribution.toFixed(2)}.`,
		);
		findingNum++;
	}

	// 4. Coordination efficiency
	const sortedByCoord = Object.entries(metrics).sort(
		(a, b) => b[1].avgCoordinationEfficiency - a[1].avgCoordinationEfficiency,
	);
	if (sortedByCoord.length > 1) {
		lines.push(
			`${findingNum}. **Coordination efficiency:** ${sortedByCoord[0][0]} produces the most output per input token (${sortedByCoord[0][1].avgCoordinationEfficiency.toFixed(3)}) vs ${sortedByCoord[sortedByCoord.length - 1][0]} (${sortedByCoord[sortedByCoord.length - 1][1].avgCoordinationEfficiency.toFixed(3)}).`,
		);
	}
	lines.push("");

	// Appendix: Per-Round Judge Progression
	const hasPerRoundJudge = report.scenarios.some((sc) =>
		Object.values(sc.results).some((r) =>
			r?.rounds.some((round) => round.judge),
		),
	);

	if (hasPerRoundJudge) {
		lines.push("## Appendix: Per-Round Judge Progression\n");

		for (const sc of report.scenarios) {
			const anyPerRound = Object.values(sc.results).some((r) =>
				r?.rounds.some((round) => round.judge),
			);
			if (!anyPerRound) continue;

			lines.push(`### ${sc.scenario.name}\n`);
			lines.push("| Protocol | Round | Pass | Quality | Multi-Agent Value |");
			lines.push("|----------|-------|------|---------|-------------------|");

			for (const pid of protocolIds) {
				for (const round of sc.results[pid]?.rounds ?? []) {
					if (!round.judge) continue;
					const pass = round.judge.pass ? "PASS" : "FAIL";
					const quality = fmtScore(round.judge.qualityScore);
					const multiAgent = fmtScore(round.judge.multiAgentValue);
					lines.push(
						`| ${pid} | ${round.roundIndex + 1} | ${pass} | ${quality} | ${multiAgent} |`,
					);
				}
			}
			lines.push("");
		}
	}

	lines.push("---\n*Generated by the protocol comparison benchmark system.*\n");

	return lines.join("\n");
}
